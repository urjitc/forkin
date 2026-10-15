import { Agent } from "agents";
import { Effect, Layer, ManagedRuntime, Schedule } from "effect";
import {
  type Environment,
  EnvironmentStatus,
  Verdict,
  type ForkinConfig,
  type Issue,
  type NewIssue,
  type ProjectState,
  type RunningWork,
  type Fix,
  FixStatus,
  type Reproducer,
  type StartedFix,
  type Try,
  TryStatus,
} from "#/domain";
import { Bench } from "./bench";
import {
  OlderSnapshots,
  ProjectChanged,
  buildEnvironment,
  checkAllOnMain,
  checkFix,
  checkIssue,
  runTry,
  startFix,
} from "./check";
import { Git } from "./git";
import { ProjectStore } from "./store";

/** How many of the latest activity events every dashboard receives live. */
const recentActivity = 40;

/** The longest a caller may wait for a result; MCP clients often give up on calls after 60 s. */
export const maxWaitSeconds = 50;

/** Reads `read` every second until `done` holds or `seconds` pass, then returns the latest. */
const waitFor = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  done: (a: A) => boolean,
  seconds: number,
) =>
  seconds <= 0
    ? read
    : read.pipe(
        Effect.repeat({ schedule: Schedule.spaced("1 second"), until: done }),
        Effect.timeoutOrElse({
          duration: `${Math.min(seconds, maxWaitSeconds)} seconds`,
          orElse: () => read,
        }),
      );

/** What every dashboard watching the repo sees, read from the store. */
const currentState = Effect.gen(function* () {
  const store = yield* ProjectStore;
  const issues = yield* store.summaries;

  const environment = yield* store.environment.pipe(
    Effect.map(({ status }) => status),
    Effect.orElseSucceed(() => null),
  );

  const activity = yield* store.activity(null, recentActivity);
  const fixes = yield* store.checkingFixes;
  const tries = yield* store.runningTries;

  const running: ReadonlyArray<RunningWork> = [
    ...(environment && EnvironmentStatus.guards.Building(environment)
      ? [{ what: "build" as const, issue: null, label: environment.step }]
      : []),
    ...issues
      .filter((issue) => Verdict.guards.Checking(issue.verdict))
      .map((issue) => ({
        what: "check" as const,
        issue: issue.number,
        label: "3 runs of its test",
      })),
    ...fixes.map((fix) => ({
      what: "fix" as const,
      issue: fix.issue,
      label: `fix by ${fix.author}`,
    })),
    ...tries.map(() => ({ what: "try" as const, issue: null, label: "a private try" })),
  ];

  return { environment, issues, running, activity };
});

/**
 * One repository on Forkin: one Durable Object per `owner~repo`, so all work on a repo goes through
 * a single actor. Issues, runs and the environment live in its SQLite database; issue summaries and
 * the environment's status are broadcast live to every dashboard watching it. Dashboards only watch:
 * changes come through this class's methods, called from the Worker.
 */
export class Project extends Agent<Env, ProjectState> {
  override initialState: ProjectState = {
    environment: null,
    issues: [],
    running: [],
    activity: [],
  };

  private readonly runtime = (() => {
    const store = ProjectStore.sqlite(this.ctx.storage.sql);
    const broadcast = (state: ProjectState) => this.setState(state);

    const changed = Layer.effect(
      ProjectChanged,
      Effect.gen(function* () {
        const store = yield* ProjectStore;

        return ProjectChanged.of({
          publish: Effect.map(
            currentState.pipe(Effect.provideService(ProjectStore, store)),
            broadcast,
          ),
        });
      }),
    ).pipe(Layer.provide(store));

    return ManagedRuntime.make(
      Layer.mergeAll(
        store,
        changed,
        Bench.layer(this.env.Bench),
        Git.layer(this.env.ARTIFACTS),
        Layer.succeed(OlderSnapshots, { repo: () => this.repo, building: new Map() }),
      ),
    );
  })();

  /** Issues with a check in flight in this instance. */
  private readonly checking = new Set<number>();

  private readonly publish = ProjectChanged.use((changed) => changed.publish);

  /** `owner/repo` on GitHub, from this Durable Object's `owner~repo` name. */
  private get repo() {
    return this.name.replace("~", "/");
  }

  /** A restart abandons checks, tries and fix checks in flight; start again the ones still running. */
  override async onStart() {
    const { issues, tries, fixes } = await this.runtime.runPromise(
      ProjectStore.use((store) =>
        Effect.all({
          issues: store.summaries,
          tries: store.runningTries,
          fixes: store.checkingFixes,
        }),
      ),
    );

    await Promise.all([
      ...issues
        .filter((issue) => Verdict.guards.Checking(issue.verdict))
        .map((issue) => this.schedule(0, "runCheck", { number: issue.number })),
      ...tries.map((id) => this.schedule(0, "runTry", { id })),
      ...fixes.map(({ id }) => this.schedule(0, "runFixCheck", { id })),
    ]);
  }

  override shouldConnectionBeReadonly() {
    return true;
  }

  /** Sets the repo's forkin.json and builds its snapshot at `ref` in the background. */
  async configure(config: ForkinConfig, ref: string) {
    await this.runtime.runPromise(
      ProjectStore.use((store) =>
        store.setEnvironment({
          config,
          status: EnvironmentStatus.cases.Building.make({ commit: ref, step: "Queued" }),
        }),
      ).pipe(Effect.andThen(this.publish)),
    );
    await this.schedule(0, "runBuild", { ref, refresh: false });
  }

  /**
   * The repo's default branch moved to `commit`, for example on a push. Brings the snapshot to it
   * and runs every Reproduced issue's test there, to find the ones a change has fixed. False when
   * the repo isn't set up on Forkin.
   */
  async sync(commit: string): Promise<boolean> {
    const configured = await this.runtime.runPromise(
      ProjectStore.use((store) => store.environment).pipe(
        Effect.as(true),
        Effect.catchTag("NotConfigured", () => Effect.succeed(false)),
      ),
    );

    if (configured) await this.schedule(0, "runBuild", { ref: commit, refresh: true });

    return configured;
  }

  /**
   * Scheduled by `configure` and `sync`. Once the snapshot is ready, checks every issue still
   * waiting; after a sync, also runs the Reproduced ones on the new commit. Scheduled tasks run one
   * at a time, so this starts the work and returns; the same for `runCheck`.
   */
  async runBuild({ ref, refresh }: { ref: string; refresh: boolean }) {
    const { config, from } = await this.runtime.runPromise(
      ProjectStore.use((store) => store.environment).pipe(
        Effect.map(({ config, status }) => ({
          config,
          from: refresh && EnvironmentStatus.guards.Ready(status) ? status.snapshot : null,
        })),
      ),
    );

    const checkWaiting = ProjectStore.use((store) => store.summaries).pipe(
      Effect.flatMap((issues) =>
        Effect.forEach(
          issues.filter((issue) => Verdict.guards.Checking(issue.verdict)),
          (issue) => Effect.promise(() => this.schedule(0, "runCheck", { number: issue.number })),
          { discard: true },
        ),
      ),
    );

    void this.keepAliveWhile(() =>
      this.runtime.runPromise(
        buildEnvironment(this.repo, ref, config, from, (snapshot) =>
          refresh ? checkWaiting.pipe(Effect.andThen(checkAllOnMain(snapshot))) : checkWaiting,
        ).pipe(Effect.catch((error) => Effect.logError("Building the environment failed", error))),
      ),
    );
  }

  /**
   * Files an issue and, when it has a failing test, schedules the check; filing again with the same
   * key returns the first issue. Waits up to `waitSeconds` for the verdict.
   */
  async fileIssue(newIssue: NewIssue, waitSeconds = 0): Promise<Issue> {
    const { issue, created } = await this.runtime.runPromise(
      ProjectStore.use((store) => store.fileIssue(newIssue)).pipe(Effect.tap(() => this.publish)),
    );

    if (created && issue.reproducer) await this.schedule(0, "runCheck", { number: issue.number });

    return (await this.getIssue(issue.number, waitSeconds)) ?? issue;
  }

  /** Starts a try of a reproducer, files nothing, and waits up to `waitSeconds` for it to end. */
  async startTry(reproducer: Reproducer, waitSeconds = 0): Promise<Try> {
    const started = await this.runtime.runPromise(
      ProjectStore.use((store) => store.startTry(reproducer)),
    );

    await this.schedule(0, "runTry", { id: started.id });

    return (await this.getTry(started.id, waitSeconds)) ?? started;
  }

  /** Scheduled by `startTry`; like `runCheck`, it starts the work and returns. */
  async runTry({ id }: { id: string }) {
    void this.keepAliveWhile(() =>
      this.runtime.runPromise(
        runTry(id).pipe(Effect.catch((error) => Effect.logError(`Try ${id} failed`, error))),
      ),
    );
  }

  /**
   * Starts a fix to an issue for `author`: a fork of the issue's Artifacts repo and a token to push
   * to it. `refused` says why not, when the issue has no checked test yet.
   */
  async startFix(
    number: number,
    author: string,
    builtOn?: string,
  ): Promise<{ started: StartedFix | null; refused: string | null }> {
    const refused = (reason: string) => Effect.succeed({ started: null, refused: reason });

    return this.runtime.runPromise(
      startFix(this.repo, number, author, builtOn).pipe(
        Effect.map((started) => ({ started, refused: null })),
        Effect.catchTags({
          IssueNotFound: () => refused(`Issue #${number} doesn't exist.`),
          FixNotFound: () => refused(`Fix ${builtOn} doesn't exist.`),
          IssueNotForkable: ({ message }) => refused(message),
          GitUnavailable: ({ message }) => refused(`Artifacts couldn't fork the issue: ${message}`),
        }),
      ),
    );
  }

  /** A fresh write token for a fix's fork; null when there's no such fix. */
  async fixToken(id: string): Promise<{ remote: string; token: string } | null> {
    return this.runtime.runPromise(
      ProjectStore.use((store) => store.getFix(id)).pipe(
        Effect.flatMap((fix) => Git.use((git) => git.token(fix.fork.name, "write"))),
        Effect.map(({ remote, token }) => ({ remote, token })),
        Effect.catchTag("FixNotFound", () => Effect.succeed(null)),
      ),
    );
  }

  /** Checks a fix at its fork's head, waiting up to `waitSeconds` for the result. */
  async checkFix(id: string, waitSeconds = 0): Promise<Fix | null> {
    const found = await this.runtime.runPromise(
      ProjectStore.use((store) =>
        store.getFix(id).pipe(
          Effect.andThen(store.setFixStatus(id, FixStatus.cases.Checking.make({ commit: null }))),
          Effect.andThen(this.publish),
          Effect.as(true),
          Effect.catchTag("FixNotFound", () => Effect.succeed(false)),
        ),
      ),
    );

    if (found) await this.schedule(0, "runFixCheck", { id });

    return this.getFix(id, waitSeconds);
  }

  /** Scheduled by `checkFix`; like `runCheck`, it starts the work and returns. */
  async runFixCheck({ id }: { id: string }) {
    void this.keepAliveWhile(() =>
      this.runtime.runPromise(
        checkFix(id).pipe(
          // Forkin failed, not the fix: the fix goes back to Open for its agent to ask again.
          Effect.catch((error) =>
            ProjectStore.use((store) =>
              store.setFixStatus(id, FixStatus.cases.Open.make({})).pipe(
                Effect.andThen(
                  store.record({
                    kind: "error",
                    message: `Checking fix ${id} failed: ${JSON.stringify(error)}`,
                    issue: null,
                  }),
                ),
              ),
            ).pipe(Effect.andThen(this.publish)),
          ),
        ),
      ),
    );
  }

  /** A fix, waiting up to `waitSeconds` while it's checked; null when there's no such fix. */
  async getFix(id: string, waitSeconds = 0): Promise<Fix | null> {
    return this.runtime.runPromise(
      waitFor(
        ProjectStore.use((store) => store.getFix(id)),
        (fix) => !FixStatus.guards.Checking(fix.status),
        waitSeconds,
      ).pipe(Effect.catchTag("FixNotFound", () => Effect.succeed(null))),
    );
  }

  /** What a fix changed, as a patch; null before its first check. */
  async fixPatch(id: string): Promise<string | null> {
    return this.runtime.runPromise(ProjectStore.use((store) => store.fixPatch(id)));
  }

  /** An issue's fixes, newest first. */
  async fixesOf(number: number): Promise<ReadonlyArray<Fix>> {
    return this.runtime.runPromise(ProjectStore.use((store) => store.fixesOf(number)));
  }

  /** A try, waiting up to `waitSeconds` while it runs; null when there's no such try. */
  async getTry(id: string, waitSeconds = 0): Promise<Try | null> {
    return this.runtime.runPromise(
      waitFor(
        ProjectStore.use((store) => store.getTry(id)),
        (tried) => !TryStatus.guards.Running(tried.status),
        waitSeconds,
      ).pipe(Effect.catchTag("TryNotFound", () => Effect.succeed(null))),
    );
  }

  /** Scheduled by `fileIssue` and `runBuild`; survives the Durable Object restarting. */
  async runCheck({ number }: { number: number }) {
    // One check per issue at a time; a second request while one runs would only duplicate it.
    if (this.checking.has(number)) return;

    this.checking.add(number);

    void this.keepAliveWhile(() =>
      this.runtime.runPromise(
        checkIssue(this.repo, number).pipe(
          Effect.catchTag("EnvironmentNotReady", () => Effect.void),
          Effect.catch((error) => Effect.logError(`Check of issue ${number} failed`, error)),
          Effect.ensuring(Effect.sync(() => this.checking.delete(number))),
        ),
      ),
    );
  }

  /** Changes an issue's title or description; null when there's no such issue. */
  async editIssue(
    number: number,
    edit: { title?: string; body?: string; github?: number },
  ): Promise<Issue | null> {
    await this.runtime.runPromise(
      ProjectStore.use((store) => store.editIssue(number, edit)).pipe(Effect.andThen(this.publish)),
    );

    return this.getIssue(number);
  }

  /** Runs an issue's reproducer again at its commit, waiting up to `waitSeconds`. */
  async recheck(number: number, waitSeconds = 0): Promise<Issue | null> {
    // Marked before the check starts, so a caller waiting on it doesn't read the old verdict.
    const checkable = await this.runtime.runPromise(
      ProjectStore.use((store) =>
        store.getIssue(number).pipe(
          Effect.flatMap(({ reproducer }) =>
            reproducer
              ? store
                  .setVerdict(number, Verdict.cases.Checking.make({}))
                  .pipe(Effect.andThen(this.publish), Effect.as(true))
              : Effect.succeed(false),
          ),
          Effect.catchTag("IssueNotFound", () => Effect.succeed(false)),
        ),
      ),
    );

    if (checkable) await this.schedule(0, "runCheck", { number });

    return this.getIssue(number, waitSeconds);
  }

  /** One issue's activity, or the whole repo's with null; newest first. */
  async issueActivity(number: number | null) {
    return this.runtime.runPromise(ProjectStore.use((store) => store.activity(number, 200)));
  }

  /** Restarts this Durable Object, abandoning any work in flight. For a Project stuck on a task. */
  restart() {
    this.ctx.abort("Restarted through the API");
  }

  /** Deletes the repo's whole store and alarms, so it starts again unconfigured. */
  async reset() {
    await this.destroy();
  }

  /** An issue, waiting up to `waitSeconds` while it's being checked; null when there's no such issue. */
  async getIssue(number: number, waitSeconds = 0): Promise<Issue | null> {
    return this.runtime.runPromise(
      waitFor(
        ProjectStore.use((store) => store.getIssue(number)),
        (issue) => !Verdict.guards.Checking(issue.verdict),
        waitSeconds,
      ).pipe(Effect.catchTag("IssueNotFound", () => Effect.succeed(null))),
    );
  }

  /** The repo's forkin.json and where its snapshot stands; null before it's set up. */
  async environment(): Promise<Environment | null> {
    return this.runtime.runPromise(
      ProjectStore.use((store) => store.environment).pipe(
        Effect.catchTag("NotConfigured", () => Effect.succeed(null)),
      ),
    );
  }

  /** The current state, read without broadcasting it. */
  async snapshot(): Promise<ProjectState> {
    return this.runtime.runPromise(currentState);
  }
}
