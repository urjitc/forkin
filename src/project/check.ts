import { Cause, Context, DateTime, Effect, Predicate, Schedule, Schema } from "effect";
import {
  EnvironmentStatus,
  FixStatus,
  TryStatus,
  Verdict,
  type ActivityEvent,
  type ForkinConfig,
  type Issue,
  type Reproducer,
  type Run,
  type Snapshot,
} from "#/domain";
import { Bench, LockfileChanged, lockfiles } from "./bench";
import { Git } from "./git";
import { ProjectStore } from "./store";
import { judgeFix } from "./fix-checks";
import { runsPerVerdict, verdictFromRuns } from "./verdict";

/** Tells everyone watching the Project that its issues, environment or activity changed. */
export class ProjectChanged extends Context.Service<
  ProjectChanged,
  { readonly publish: Effect.Effect<void> }
>()("forkin/project/ProjectChanged") {}

/** The repo's snapshot isn't built yet; issues wait as Checking and are checked once it is. */
export class EnvironmentNotReady extends Schema.TaggedError<EnvironmentNotReady>()(
  "EnvironmentNotReady",
  {},
) {}

/** How long one Bench run may take: restore, write the test, run it. */
const runTimeout = "15 minutes";

/** How long publishing an issue's repo may take: create it, restore, commit, push. */
const publishTimeout = "10 minutes";

/** Hard limits, so a stuck task fails visibly instead of keeping the Project busy forever. */
const checkTimeout = "30 minutes";
const buildTimeout = "45 minutes";
const baselineTimeout = "40 minutes";

/** Retries a Bench that was briefly unavailable; every other failure is final. */
const retryUnavailable = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.retry(self, {
    times: 2,
    schedule: Schedule.exponential("2 seconds"),
    while: (error: E) => Predicate.isTagged(error, "BenchUnavailable"),
  });

/** Records an event in the Project's activity and publishes it to every dashboard. */
const note = Effect.fn("note")(function* (
  kind: ActivityEvent["kind"],
  message: string,
  issue: number | null = null,
) {
  const store = yield* ProjectStore;
  const changed = yield* ProjectChanged;

  yield* store.record({ kind, message, issue });
  yield* changed.publish;
});

/** Records any failure, with its full cause, before passing it on. */
const noteFailure =
  (what: string, issue: number | null = null) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    Effect.tapCause(self, (cause) =>
      note("error", `${what} failed: ${Cause.pretty(cause).slice(0, 2000)}`, issue),
    );

const elapsed = (started: number) => `${Math.round((Date.now() - started) / 1000)} s`;

/** Everything checks and builds use, for callbacks that run in the middle of them. */
type CheckServices = ProjectStore | Bench | Git | ProjectChanged | OlderSnapshots;

/**
 * Snapshots for commits whose dependencies differ from the repo's snapshot, built once per lockfile
 * and kept in the store. `building` holds builds in flight, so checks that need the same one share it.
 */
export class OlderSnapshots extends Context.Service<
  OlderSnapshots,
  {
    /** `owner/repo` on GitHub, to clone. */
    readonly repo: () => string;
    readonly building: Map<string, Effect.Effect<Snapshot, OlderSnapshotFailed>>;
  }
>()("forkin/project/OlderSnapshots") {}

/** A snapshot for a commit's older dependencies couldn't be built. */
export class OlderSnapshotFailed extends Schema.TaggedError<OlderSnapshotFailed>()(
  "OlderSnapshotFailed",
  { commit: Schema.String, message: Schema.String },
) {}

/** The snapshot for dependencies listed as `lockfiles`, building it at `commit` the first time. */
const olderSnapshot = Effect.fn("olderSnapshot")(function* (
  config: ForkinConfig,
  commit: string,
  lockfiles: string,
) {
  const store = yield* ProjectStore;
  const bench = yield* Bench;
  const git = yield* Git;
  const { repo, building } = yield* OlderSnapshots;
  const saved = yield* store.snapshotFor(lockfiles);

  if (saved) return saved;

  const inFlight = building.get(lockfiles);

  if (inFlight) return yield* inFlight;

  const at = commit.slice(0, 7);

  const build = Effect.gen(function* () {
    yield* note(
      "build",
      `${at} has different dependencies than main, so building a snapshot at it`,
    );

    const mirror = yield* git.mirror(repo());

    const snapshot = yield* bench
      .build({ repo: repo(), mirror, ref: commit, config, onStep: () => Effect.void })
      .pipe(retryUnavailable, Effect.timeout(buildTimeout));

    yield* store.saveSnapshot(lockfiles, snapshot);
    yield* note(
      "build",
      `Snapshot for ${at}'s dependencies ready after ${Math.round(snapshot.seconds)} s`,
    );

    return snapshot;
  }).pipe(
    Effect.mapError(({ message }) => new OlderSnapshotFailed({ commit, message })),
    Effect.tapError(({ message }) =>
      note("error", `Building a snapshot at ${at} failed: ${message}`),
    ),
    Effect.ensuring(Effect.sync(() => building.delete(lockfiles))),
  );

  // Shared with checks that arrive while it builds, so it carries the services it needs.
  const services = yield* Effect.context<ProjectStore | Bench | Git | ProjectChanged>();
  const shared = yield* Effect.cached(build.pipe(Effect.provideContext(services)));

  building.set(lockfiles, shared);

  return yield* shared;
});

/**
 * Runs `use` on the repo's snapshot, and again on a snapshot built for the reproducer's commit
 * when that commit's dependencies differ, so tests filed against older code still run.
 */
const onSnapshotFor = <A, E, R>(
  snapshot: Snapshot,
  config: ForkinConfig,
  use: (snapshot: Snapshot) => Effect.Effect<A, E, R>,
) =>
  use(snapshot).pipe(
    Effect.catchIf(
      (error): error is E & LockfileChanged & { lockfiles: string } =>
        error instanceof LockfileChanged && error.lockfiles !== undefined,
      ({ commit, lockfiles }) => olderSnapshot(config, commit, lockfiles).pipe(Effect.flatMap(use)),
    ),
  );

/**
 * Brings the repo's snapshot to `ref`, then takes a baseline per target. With a ready snapshot
 * `from`, it only fetches and rebuilds; a lockfile change, or no snapshot yet, means a full build
 * from forkin.json. Every step lands in the activity log, and the snapshot is marked ready before
 * the baselines run.
 */
export const buildEnvironment = Effect.fn("buildEnvironment")(function* (
  repo: string,
  ref: string,
  config: ForkinConfig,
  from: Snapshot | null,
  /** Runs once the snapshot is ready, before the baselines. */
  onReady: (snapshot: Snapshot) => Effect.Effect<void, never, CheckServices>,
) {
  const store = yield* ProjectStore;
  const bench = yield* Bench;
  const git = yield* Git;
  const changed = yield* ProjectChanged;
  const started = Date.now();

  const setStatus = (status: EnvironmentStatus) =>
    store.setEnvironment({ config, status }).pipe(Effect.andThen(changed.publish));

  const noteStep = (step: string) =>
    store
      .record({ kind: "build", message: step, issue: null })
      .pipe(Effect.andThen(changed.publish));

  yield* note(
    "build",
    from
      ? `Moving the snapshot of ${repo} from ${from.commit.slice(0, 7)} to ${ref}`
      : `Building the snapshot of ${repo} at ${ref}`,
  );

  const mirror = yield* git.mirror(repo).pipe(
    Effect.tapError(({ message }) =>
      setStatus(EnvironmentStatus.cases.Failed.make({ commit: ref, message })),
    ),
    noteFailure("Mirroring the repo on Artifacts"),
  );

  const onStep = (step: string) =>
    setStatus(EnvironmentStatus.cases.Building.make({ commit: ref, step })).pipe(
      Effect.andThen(noteStep(step)),
    );

  const fullBuild = bench.build({ repo, mirror, ref, config, onStep });

  const produced = from
    ? bench
        .refresh({ snapshot: from, mirror, ref, config, onStep })
        .pipe(
          Effect.catchTag("LockfileChanged", ({ commit }) =>
            note(
              "build",
              `Dependencies changed at ${commit.slice(0, 7)}, so building from scratch`,
            ).pipe(Effect.andThen(fullBuild)),
          ),
        )
    : fullBuild;

  const snapshot = yield* produced.pipe(
    retryUnavailable,
    Effect.timeout(buildTimeout),
    Effect.tapErrorTag("SetupFailed", ({ step, output }) =>
      setStatus(
        EnvironmentStatus.cases.Failed.make({
          commit: ref,
          message: `${step} failed:\n${output}`,
        }),
      ),
    ),
    Effect.tapErrorTag("BenchUnavailable", ({ message }) =>
      setStatus(EnvironmentStatus.cases.Failed.make({ commit: ref, message })),
    ),
    noteFailure("Building the snapshot"),
  );

  yield* setStatus(EnvironmentStatus.cases.Ready.make({ snapshot }));
  yield* note(
    "build",
    `Snapshot ready at ${snapshot.commit.slice(0, 7)} after ${elapsed(started)}`,
  );

  const baselines = Effect.forEach(
    Object.entries(config.targets),
    ([name, target]) =>
      Effect.gen(function* () {
        const baselineStarted = Date.now();

        yield* note("baseline", `Running the whole ${name} suite for its baseline`);

        const baseline = yield* bench
          .baseline(snapshot, target)
          .pipe(Effect.timeout(baselineTimeout), noteFailure(`The ${name} baseline`));

        yield* note(
          "baseline",
          baseline.outcome === "broken"
            ? `The ${name} suite couldn't run (${elapsed(baselineStarted)})`
            : `${name} baseline: ${baseline.passed} passed, ${baseline.failed} failed in ${elapsed(baselineStarted)}`,
        );

        const { status } = yield* store.environment;

        if (!EnvironmentStatus.guards.Ready(status) || status.snapshot.id !== snapshot.id) return;

        const baselines = { ...status.snapshot.baselines, [name]: baseline };

        yield* setStatus(
          EnvironmentStatus.cases.Ready.make({ snapshot: { ...status.snapshot, baselines } }),
        );
      }).pipe(Effect.ignore),
    { concurrency: "unbounded", discard: true },
  );

  // Issues are checked on the new snapshot while the baselines run.
  yield* Effect.all([onReady(snapshot), baselines], { concurrency: "unbounded", discard: true });

  return snapshot;
});

/**
 * Runs a reproducer `runsPerVerdict` times in parallel on the ready snapshot, each on its own Bench,
 * and returns the runs with the verdict they support. `onRun` sees each run as it lands.
 */
const runReproducer = Effect.fn("runReproducer")(function* <R>(
  reproducer: Reproducer,
  /** Prefixes the runs' sandbox names. */
  runId: string,
  onRun: (attempt: number, result: { run: Run; diff: string }) => Effect.Effect<void, never, R>,
) {
  const store = yield* ProjectStore;
  const bench = yield* Bench;
  const { config, status } = yield* store.environment;

  if (!EnvironmentStatus.guards.Ready(status)) return yield* new EnvironmentNotReady({});

  const { results, snapshot } = yield* onSnapshotFor(status.snapshot, config, (snapshot) =>
    Effect.forEach(
      Array.from({ length: runsPerVerdict }, (_, attempt) => attempt),
      (attempt) =>
        bench.run({ config, snapshot, reproducer, runId: `${runId}-${attempt}` }).pipe(
          Effect.timeout(runTimeout),
          retryUnavailable,
          Effect.tap((result) => onRun(attempt, result)),
        ),
      { concurrency: runsPerVerdict },
    ).pipe(
      Effect.timeout(checkTimeout),
      Effect.map((results) => ({ results, snapshot })),
    ),
  );

  const runs = results.map(({ run }) => run);

  return { results, runs, verdict: verdictFromRuns(runs), snapshot };
});

/**
 * Runs a try started by `ProjectStore.startTry`, as a check would, and records how it ended. Tries
 * leave no activity: contributors' agents use them privately, to make sure a test fails
 * `runsPerVerdict` times out of `runsPerVerdict` before filing it.
 */
export const runTry = Effect.fn("runTry")(function* (id: string) {
  const store = yield* ProjectStore;
  const { reproducer } = yield* store.getTry(id);

  const failed = (message: string) => Effect.succeed(TryStatus.cases.Failed.make({ message }));

  const status = yield* runReproducer(reproducer, `try-${id.slice(0, 8)}`, () => Effect.void).pipe(
    Effect.map(({ results, verdict }) =>
      TryStatus.cases.Done.make({
        verdict,
        runs: results.map(({ run }) => run),
        diff: results[0]?.diff ?? "",
      }),
    ),
    // Each reason says what to change, since an agent reads it to decide what to do next.
    Effect.catchTags({
      EnvironmentNotReady: () =>
        failed("The repo's snapshot isn't built yet; try again once it's ready."),
      NotConfigured: () => failed("This repo isn't set up on Forkin yet: it needs a forkin.json."),
      CommitUnavailable: ({ wanted, snapshotHas }) =>
        failed(`Commit ${wanted} isn't in Forkin's copy of the repo (built at ${snapshotHas}).`),
      LockfileChanged: ({ commit, snapshotHas }) =>
        failed(
          `Commit ${commit} has different dependencies than the snapshot at ${snapshotHas}; use a commit with the same lockfile.`,
        ),
      TestOutsideTarget: ({ target, path }) =>
        failed(`${path} isn't inside target "${target}", or that target doesn't exist.`),
      BenchUnavailable: ({ message }) => failed(`The sandbox failed: ${message}`),
    }),
    Effect.catch((error) => failed(`The runs took too long: ${error.message}`)),
  );

  yield* store.setTryStatus(id, status);
});

/**
 * Runs an issue's reproducer and records the verdict the runs support. Each run is saved and
 * published as it lands, and the first run's diff becomes the issue's. A failure that isn't a run
 * (the Bench, the commit, the dependencies) leaves the issue Unverified.
 */
export const checkIssue = Effect.fn("checkIssue")(function* (repo: string, number: number) {
  const store = yield* ProjectStore;
  const changed = yield* ProjectChanged;

  const issue = yield* store.getIssue(number);
  const reproducer = issue.reproducer;

  if (!reproducer) return issue.verdict;

  const { status } = yield* store.environment;

  if (!EnvironmentStatus.guards.Ready(status)) {
    yield* note("run", "Waiting for the snapshot before checking", number);

    return yield* new EnvironmentNotReady({});
  }

  yield* store.setVerdict(number, Verdict.cases.Checking.make({}));
  yield* note("run", `Running the test ${runsPerVerdict} times in parallel`, number);

  const started = Date.now();

  const { runs, verdict, snapshot } = yield* runReproducer(
    reproducer,
    String(number),
    (attempt, { run, diff }) =>
      store
        .addRun(number, run)
        .pipe(
          Effect.andThen(attempt === 0 ? store.setDiff(number, diff) : Effect.void),
          Effect.andThen(
            note(
              "run",
              `Run ${attempt + 1}: ${run.outcome} (${run.failed} failed, ${run.passed} passed); test ${Math.round(run.seconds)} s, total ${elapsed(started)}`,
              number,
            ),
          ),
        ),
  ).pipe(
    Effect.tapError(() =>
      store
        .setVerdict(number, Verdict.cases.Unverified.make({}))
        .pipe(Effect.andThen(changed.publish)),
    ),
    noteFailure("The check", number),
  );

  yield* store.setVerdict(number, verdict);
  yield* note("verdict", `Verdict: ${verdict._tag}`, number);

  // The verdict stands on its own; a repo that fails to publish is only noted.
  yield* publishIssue(repo, issue, reproducer, verdict, runs, snapshot).pipe(Effect.ignore);

  return verdict;
});

/**
 * Publishes the issue as its own Artifacts repo: the failing test as one commit on top of the commit
 * it was checked at, with the verdict and its runs as a `forkin` git note.
 */
const publishIssue = Effect.fn("publishIssue")(
  function* (
    repo: string,
    issue: Issue,
    reproducer: Reproducer,
    verdict: Verdict,
    runs: ReadonlyArray<Run>,
    snapshot: Snapshot,
  ) {
    const store = yield* ProjectStore;
    const bench = yield* Bench;
    const git = yield* Git;
    const [first] = runs;

    if (!first) return;

    const target = yield* git.issueRepo(repo, issue.number);
    const checkedAt = DateTime.formatIso(yield* DateTime.now);

    const evidence = JSON.stringify(
      {
        verdict,
        runs,
        snapshot: { id: snapshot.id, commit: snapshot.commit },
        checkedAt,
      },
      null,
      2,
    );

    const commit = yield* bench
      .publish({
        snapshot,
        reproducer,
        commit: first.commit,
        message: `#${issue.number} ${issue.title}`,
        author: issue.author,
        note: evidence,
        target,
      })
      .pipe(retryUnavailable, Effect.timeout(publishTimeout));

    yield* store.setRepo(issue.number, { name: target.name, remote: target.remote, commit });
    yield* note(
      "publish",
      `Published to Artifacts as ${target.name} at ${commit.slice(0, 7)}`,
      issue.number,
    );
  },
  (self, _repo, issue) => noteFailure("Publishing to Artifacts", issue.number)(self),
);

/**
 * Runs a Reproduced issue's test on the commit `snapshot` was built at, normally main after a push.
 * Passing every run means a change since fixed the bug, so the issue becomes Already fixed; failing
 * every run means it's still there. The runs join the issue's evidence either way.
 */
export const checkOnMain = Effect.fn("checkOnMain")(function* (number: number, snapshot: Snapshot) {
  const store = yield* ProjectStore;
  const changed = yield* ProjectChanged;
  const { reproducer, verdict } = yield* store.getIssue(number);

  if (!reproducer || !Verdict.guards.Reproduced(verdict)) return;

  const at = snapshot.commit.slice(0, 7);

  yield* note("run", `Running the test on main at ${at}`, number);

  const { runs } = yield* runReproducer(
    { ...reproducer, commit: snapshot.commit },
    `${number}-main`,
    (_, { run }) => store.addRun(number, run).pipe(Effect.andThen(changed.publish)),
  );

  const failed = runs.filter((run) => run.outcome === "fail").length;

  if (runs.every((run) => run.outcome === "pass")) {
    yield* store.setVerdict(number, Verdict.cases.AlreadyFixed.make({ commit: snapshot.commit }));
    yield* note("verdict", `Already fixed: the test passes on main at ${at}`, number);
  } else if (failed === runs.length) {
    yield* note("verdict", `Still fails on main at ${at}`, number);
  } else {
    yield* note(
      "verdict",
      `On main at ${at} the test failed ${failed} of ${runs.length} runs, so it stays Reproduced`,
      number,
    );
  }
});

/** Runs every Reproduced issue's test on `snapshot`, a few issues at a time. */
export const checkAllOnMain = Effect.fn("checkAllOnMain")(function* (snapshot: Snapshot) {
  const store = yield* ProjectStore;
  const issues = yield* store.summaries;

  yield* Effect.forEach(
    issues.filter((issue) => Verdict.guards.Reproduced(issue.verdict) && issue.hasTest),
    (issue) =>
      checkOnMain(issue.number, snapshot).pipe(
        noteFailure("Checking on main", issue.number),
        Effect.ignore,
      ),
    { concurrency: 2, discard: true },
  );
});

/** An issue can take fixes once its test is published as an Artifacts repo to fork. */
export class IssueNotForkable extends Schema.TaggedError<IssueNotForkable>()("IssueNotForkable", {
  message: Schema.String,
}) {}

/**
 * Starts a fix: forks the issue's Artifacts repo for one agent and hands back the fork with a write
 * token. Any number of fixes can run on one issue, each in its own fork.
 */
export const startFix = Effect.fn("startFix")(function* (
  repo: string,
  number: number,
  author: string,
  /** Another fix to this issue to start from, so its changes come along. */
  builtOn?: string,
) {
  const store = yield* ProjectStore;
  const git = yield* Git;
  const changed = yield* ProjectChanged;
  const issue = yield* store.getIssue(number);

  if (!issue.repo || !issue.reproducer) {
    return yield* new IssueNotForkable({
      message: `Issue #${number} has no checked test to fix yet.`,
    });
  }

  if (builtOn) {
    const parent = yield* store.getFix(builtOn);

    if (parent.issue !== number) {
      return yield* new IssueNotForkable({
        message: `Fix ${builtOn} is for issue #${parent.issue}, not #${number}.`,
      });
    }
  }

  const id = crypto.randomUUID().slice(0, 8);
  const fork = yield* git.forkIssue(repo, number, id, builtOn);

  const fix = {
    id,
    issue: number,
    author,
    fork: { name: fork.name, remote: fork.remote, base: issue.repo.commit },
    startedAt: DateTime.formatIso(yield* DateTime.now),
    status: FixStatus.cases.Open.make({}),
    builtOn,
  };

  yield* store.addFix(fix);
  yield* note(
    "fix",
    builtOn
      ? `Fix ${id} started by ${author}, building on fix ${builtOn}`
      : `Fix ${id} started by ${author}`,
    number,
  );
  yield* changed.publish;

  return { fix, token: fork.token };
});

/**
 * Checks a fix at its fork's head: the issue's original test must pass every run, the target's
 * suite must hold against the same suite at the issue's commit, and the test must be untouched.
 * The fix's code arrives as a patch read by a git-only sandbox, then runs offline. The result is
 * saved on the fix and written to the fork as a `forkin` git note.
 */
export const checkFix = Effect.fn("checkFix")(
  function* (id: string) {
    const store = yield* ProjectStore;
    const bench = yield* Bench;
    const git = yield* Git;
    const changed = yield* ProjectChanged;
    const fix = yield* store.getFix(id);
    const issue = yield* store.getIssue(fix.issue);
    const reproducer = issue.reproducer;
    const { config, status } = yield* store.environment;

    if (!reproducer) return;

    if (!EnvironmentStatus.guards.Ready(status)) return yield* new EnvironmentNotReady({});

    const setStatus = (next: FixStatus) =>
      store.setFixStatus(id, next).pipe(Effect.andThen(changed.publish));

    const reject = (commit: string, reasons: ReadonlyArray<string>) =>
      setStatus(FixStatus.cases.Rejected.make({ commit, reasons, checks: null })).pipe(
        Effect.andThen(note("fix", `Fix ${id} rejected: ${reasons.join(" ")}`, fix.issue)),
      );

    const fork = yield* git.token(fix.fork.name, "read");
    const fetched = yield* bench.fetchFix(fork, fix.fork.base).pipe(retryUnavailable);

    yield* store.setFixPatch(id, fetched.patch);

    if (fetched.head === fix.fork.base) {
      return yield* reject(fetched.head, ["Nothing has been pushed to the fork yet."]);
    }

    yield* setStatus(FixStatus.cases.Checking.make({ commit: fetched.head }));
    yield* note(
      "fix",
      `Checking fix ${id} at ${fetched.head.slice(0, 7)}: ${fetched.files.length} files changed`,
      fix.issue,
    );

    const changedLockfile = fetched.files.find((file) =>
      lockfiles.includes(file.split("/").at(-1) ?? ""),
    );

    if (changedLockfile) {
      return yield* reject(fetched.head, [
        `The fix changes ${changedLockfile}; fixes that change dependencies aren't supported yet.`,
      ]);
    }

    const { before, testRuns, suite } = yield* onSnapshotFor(status.snapshot, config, (snapshot) =>
      Effect.gen(function* () {
        const request = {
          config,
          snapshot,
          reproducer: { ...reproducer, commit: fetched.commit },
        };

        // The suite at the issue's commit with its test, the yardstick for every fix to this issue.
        const saved = yield* store.suiteBefore(fix.issue, fetched.commit);

        const before =
          saved ??
          (yield* bench.suite({ ...request, runId: `${fix.issue}-before` }).pipe(
            retryUnavailable,
            Effect.map(({ outcome, passed, failed, failedTests, seconds }) => ({
              outcome,
              passed,
              failed,
              failedTests,
              seconds,
            })),
            Effect.tap((baseline) => store.saveSuiteBefore(fix.issue, fetched.commit, baseline)),
          ));

        const withFix = { ...request, patch: fetched.patch };

        return yield* Effect.all(
          {
            before: Effect.succeed(before),
            testRuns: Effect.forEach(
              Array.from({ length: runsPerVerdict }, (_, attempt) => attempt),
              (attempt) =>
                bench.run({ ...withFix, runId: `fix-${id}-${attempt}` }).pipe(
                  Effect.timeout(runTimeout),
                  retryUnavailable,
                  Effect.map(({ run }) => run),
                ),
              { concurrency: runsPerVerdict },
            ),
            suite: bench.suite({ ...withFix, runId: `fix-${id}` }).pipe(retryUnavailable),
          },
          { concurrency: "unbounded" },
        );
      }),
    );

    const { checks, reasons } = judgeFix({
      testRuns,
      suite,
      before,
      testUntouched: !fetched.files.includes(reproducer.path),
    });

    const verdict =
      reasons.length === 0
        ? FixStatus.cases.Proven.make({ commit: fetched.head, checks })
        : FixStatus.cases.Rejected.make({ commit: fetched.head, reasons, checks });

    yield* setStatus(verdict);
    yield* note(
      "fix",
      reasons.length === 0
        ? `Fix ${id} proven at ${fetched.head.slice(0, 7)}: the test passes, the suite holds`
        : `Fix ${id} rejected: ${reasons.join(" ")}`,
      fix.issue,
    );

    // The evidence travels with the fork; a failure to write it is only noted.
    const evidence = JSON.stringify({ fix: id, issue: fix.issue, verdict }, null, 2);

    yield* git.token(fix.fork.name, "write").pipe(
      Effect.flatMap((target) => bench.addNote(target, fetched.head, evidence)),
      noteFailure(`Writing fix ${id}'s evidence note`, fix.issue),
      Effect.ignore,
    );
  },
  (self, id) =>
    self.pipe(
      Effect.catchTag("PatchDoesNotApply", ({ output }) =>
        ProjectStore.use((store) => store.getFix(id)).pipe(
          Effect.flatMap((fix) =>
            ProjectStore.use((store) =>
              store.setFixStatus(
                id,
                FixStatus.cases.Rejected.make({
                  commit:
                    (FixStatus.guards.Checking(fix.status) ? fix.status.commit : null) ??
                    fix.fork.base,
                  reasons: [`The fix doesn't apply to the issue's commit: ${output}`],
                  checks: null,
                }),
              ),
            ),
          ),
          Effect.andThen(ProjectChanged.use((changed) => changed.publish)),
        ),
      ),
    ),
);
