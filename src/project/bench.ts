import { Context, DateTime, Effect, Layer, Schema } from "effect";
import type { BenchBox, ShellResult } from "#/bench/bench-box";
import type { Baseline, ForkinConfig, Reproducer, Run, Snapshot, Target } from "#/domain";
import type { Remote } from "./git";
import { readVitestReport } from "./vitest-report";

// A Bench is a sandbox container. Forkin builds one snapshot per repo from its forkin.json (clone,
// install, build, warm up, all online), then runs every test from that snapshot with the network off.

export class BenchUnavailable extends Schema.TaggedError<BenchUnavailable>()("BenchUnavailable", {
  operation: Schema.String,
  message: Schema.String,
}) {}

/** A setup step in forkin.json failed while building the snapshot. */
export class SetupFailed extends Schema.TaggedError<SetupFailed>()("SetupFailed", {
  step: Schema.String,
  output: Schema.String,
}) {}

/** The reproducer's commit isn't in the snapshot's clone; the snapshot needs rebuilding. */
export class CommitUnavailable extends Schema.TaggedError<CommitUnavailable>()(
  "CommitUnavailable",
  { wanted: Schema.String, snapshotHas: Schema.String },
) {}

/** The reproducer's commit has different dependencies than the snapshot installed. */
export class LockfileChanged extends Schema.TaggedError<LockfileChanged>()("LockfileChanged", {
  commit: Schema.String,
  snapshotHas: Schema.String,
  /** The commit's lockfiles, as `git ls-tree` lists them: the same for commits with the same dependencies. */
  lockfiles: Schema.optionalKey(Schema.String),
}) {}

/** The reproducer names a target the config doesn't define, or sits outside its folder. */
export class TestOutsideTarget extends Schema.TaggedError<TestOutsideTarget>()(
  "TestOutsideTarget",
  { target: Schema.String, path: Schema.String },
) {}

/** A fix's patch doesn't apply to the issue's commit with its test. */
export class PatchDoesNotApply extends Schema.TaggedError<PatchDoesNotApply>()(
  "PatchDoesNotApply",
  { output: Schema.String },
) {}

export type RunError =
  | BenchUnavailable
  | CommitUnavailable
  | LockfileChanged
  | TestOutsideTarget
  | PatchDoesNotApply;

export type RunRequest = {
  config: ForkinConfig;
  snapshot: Snapshot;
  reproducer: Reproducer;
  /** A fix to apply on top of the test, as a patch from `fetchFix`. */
  patch?: string;
  /** Prefixes this run's sandbox names, to find them in Cloudflare's logs. */
  runId: string;
};

/** A fix's code, read from its fork. */
export type FixPatch = {
  /** The fork's head. */
  head: string;
  /** The issue's commit, under the test commit the fork started from. */
  commit: string;
  /** What the fix changed since the fork started, as a binary-safe patch. */
  patch: string;
  /** Every file the fix touched. */
  files: ReadonlyArray<string>;
};

export type BuildRequest = {
  /** `owner/repo` on GitHub. */
  repo: string;
  /** The repo's mirror on Artifacts, which the build brings up to date. */
  mirror: Remote;
  /** A commit, or a branch to build its tip. */
  ref: string;
  config: ForkinConfig;
  /** Reports progress, for the dashboard. */
  onStep: (step: string) => Effect.Effect<void>;
};

export type RefreshRequest = {
  /** The ready snapshot to bring forward. */
  snapshot: Snapshot;
  mirror: Remote;
  /** The commit, or branch, to move to. */
  ref: string;
  config: ForkinConfig;
  onStep: (step: string) => Effect.Effect<void>;
};

export type PublishRequest = {
  snapshot: Snapshot;
  reproducer: Reproducer;
  /** The full commit the runs resolved the reproducer's commit to. */
  commit: string;
  /** The commit message: the issue's number and title. */
  message: string;
  author: string;
  /** The evidence, stored as a git note on the commit. */
  note: string;
  /** The issue's empty Artifacts repo. */
  target: Remote;
};

export class Bench extends Context.Service<
  Bench,
  {
    run(request: RunRequest): Effect.Effect<{ run: Run; diff: string }, RunError>;
    /** Runs the test's whole target suite, at its commit with the test and any patch, offline. */
    suite(request: RunRequest): Effect.Effect<Run, RunError>;
    /**
     * Reads a fix from its fork as a patch on the commit the fork started at. Runs only git, online;
     * the fix's code runs later, offline.
     */
    fetchFix(fork: Remote, base: string): Effect.Effect<FixPatch, BenchUnavailable | SetupFailed>;
    /** Adds `note` to `commit` under refs/notes/forkin in `target`, and pushes it. */
    addNote(
      target: Remote,
      commit: string,
      note: string,
    ): Effect.Effect<void, BenchUnavailable | SetupFailed>;
    /** Clones, installs and warms up, then saves the snapshot. Baselines are taken separately. */
    build(request: BuildRequest): Effect.Effect<Snapshot, BenchUnavailable | SetupFailed>;
    /**
     * Moves a snapshot to a newer commit without reinstalling: fetch, check out, build, save. Fails
     * with `LockfileChanged` when the dependencies differ, which needs a full build instead.
     */
    refresh(
      request: RefreshRequest,
    ): Effect.Effect<Snapshot, BenchUnavailable | SetupFailed | LockfileChanged>;
    /** Runs a target's whole suite on the snapshot, offline. */
    baseline(snapshot: Snapshot, target: Target): Effect.Effect<Baseline, BenchUnavailable>;
    /**
     * Pushes an issue's failing test as one commit on top of its commit, with the evidence as a git
     * note, to the issue's repo. Returns the new commit.
     */
    publish(request: PublishRequest): Effect.Effect<string, BenchUnavailable | SetupFailed>;
  }
>()("forkin/project/Bench") {
  static readonly layer = (boxes: DurableObjectNamespace<BenchBox>) =>
    Layer.succeed(Bench, Bench.of(makeBench(boxes)));
}

/** Where the repo lives inside every Bench. */
const root = "/workspace/repo";
const reportFile = "/tmp/forkin-report.json";
const patchFile = "/tmp/forkin-fix.patch";
const testLog = "/tmp/forkin-test.log";
export const lockfiles = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"];
const setupTimeout = 1200;
const testTimeout = 600;

/** A whole suite can take much longer than one test file. */
const suiteTimeout = 1800;

/** Extra time a sandbox command gets beyond the timeout inside it, to report what happened. */
const margin = 30;

/** Git configuration for one command that authenticates to Artifacts without storing the token. */
const auth = (token: string) => `-c ${quote(`http.extraHeader=Authorization: Bearer ${token}`)}`;

// Single-quotes a value for bash.
const quote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

const tail = (text: string) => text.slice(-4000);

/** A test's path relative to its target, or null when it lies outside it. A target at `.` is the repo root. */
const fileInTarget = (target: Target, path: string) =>
  target.path === "."
    ? path
    : path.startsWith(`${target.path}/`)
      ? path.slice(target.path.length + 1)
      : null;

/** Runs a bash command, stopped after `seconds` (two minutes when omitted). */
type Shell = (cmd: string, seconds?: number) => Effect.Effect<ShellResult, BenchUnavailable>;

/** What Forkin can do with a running sandbox. */
type BoxOps = {
  sh: Shell;
  writeFile: (path: string, content: string) => Effect.Effect<void, BenchUnavailable>;
  snapshot: () => Effect.Effect<{ id: string }, BenchUnavailable>;
};

const makeBench = (boxes: DurableObjectNamespace<BenchBox>): Bench["Service"] => {
  const unavailable = (operation: string) => (cause: unknown) =>
    new BenchUnavailable({ operation, message: String(cause) });

  /**
   * A fresh sandbox for the length of `use`, destroyed afterwards. Each attempt gets its own, so a
   * retry never lands on a sandbox that hung. Online by default only when built from the image,
   * since tests run offline.
   */
  const withBox = <A, E>(
    kind: string,
    snapshotId: string | null,
    use: (box: BoxOps) => Effect.Effect<A, E>,
    { internet = snapshotId === null }: { internet?: boolean } = {},
  ) =>
    Effect.suspend(() => {
      const name = `${kind}-${crypto.randomUUID()}`;
      const box = boxes.getByName(name);

      const ops: BoxOps = {
        sh: (cmd, seconds) =>
          Effect.tryPromise({ try: () => box.sh(cmd, seconds), catch: unavailable("sh") }),
        writeFile: (path, content) =>
          Effect.tryPromise({
            try: () => box.writeFile(path, content),
            catch: unavailable("writeFile"),
          }),
        snapshot: () =>
          Effect.tryPromise({ try: () => box.snapshot(name), catch: unavailable("snapshot") }),
      };

      return Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => box.boot({ snapshotId, internet }),
          catch: unavailable("boot"),
        }),
        () => use(ops),
        () => Effect.promise(() => box.destroy()).pipe(Effect.ignore),
      );
    });

  /** Runs a target's tests, or one file, with Vitest's JSON reporter and reads the result. */
  const runTests = Effect.fn("Bench.runTests")(function* (
    sh: Shell,
    target: Target,
    file: string | null,
    seconds: number,
  ) {
    const test = yield* sh(
      `cd ${quote(`${root}/${target.path}`)} && rm -f ${reportFile} && timeout ${seconds} bash -c ${quote(`${target.test} ${file ? quote(file) : ""} --reporter=json --outputFile=${reportFile}`)} > ${testLog} 2>&1; cat ${reportFile} 2>/dev/null`,
      seconds + margin,
    );

    const counts = yield* readVitestReport(test.stdout).pipe(
      Effect.orElseSucceed(() => ({
        outcome: "broken" as const,
        passed: 0,
        failed: 0,
        failedTests: [],
      })),
    );

    const log =
      counts.outcome === "broken" ? (yield* sh(`tail -c 4000 ${testLog}`)).stdout : undefined;

    return { ...counts, seconds: test.ms / 1000, log };
  });

  /** Runs a setup command from forkin.json in the repo, failing with its output if it fails. */
  const setupStep = (sh: Shell, onStep: (step: string) => Effect.Effect<void>) =>
    Effect.fn("Bench.setupStep")(function* (label: string, cmd: string) {
      yield* onStep(label);

      const result = yield* sh(
        `cd ${root} && timeout ${setupTimeout} bash -lc ${quote(cmd)} 2>&1`,
        setupTimeout + margin,
      );

      if (result.exitCode !== 0) {
        return yield* new SetupFailed({ step: label, output: tail(result.stdout + result.stderr) });
      }
    });

  /** Pushes every branch, as GitHub has it now, to the Artifacts mirror; only new commits travel. */
  const mirrorPush = (mirror: Remote) =>
    `git ${auth(mirror.token)} push -q --force ${quote(mirror.remote)} 'refs/remotes/origin/*:refs/heads/*' '^refs/remotes/origin/HEAD'`;

  /** Reports each step with the seconds spent so far, so slow steps show on the dashboard. */
  const timedSteps = (report: (step: string) => Effect.Effect<void>) => {
    const started = Date.now();

    return {
      started,
      onStep: (step: string) =>
        report(`${step} (${Math.round((Date.now() - started) / 1000)} s in)`),
    };
  };

  const build = Effect.fn("Bench.build")(function* ({
    repo,
    mirror,
    ref,
    config,
    onStep: report,
  }: BuildRequest) {
    const { started, onStep } = timedSteps(report);

    const { id, commit } = yield* withBox("build", null, ({ sh, snapshot }) =>
      Effect.gen(function* () {
        const step = setupStep(sh, onStep);

        yield* onStep("Clone");

        const clone = yield* sh(
          `git clone -q https://github.com/${repo}.git ${root} 2>&1 && cd ${root} && git checkout -q ${quote(ref)} 2>&1 && git rev-parse HEAD`,
          setupTimeout,
        );

        if (clone.exitCode !== 0) {
          return yield* new SetupFailed({ step: "Clone", output: tail(clone.stdout) });
        }

        yield* step("Mirror", mirrorPush(mirror));

        yield* step("Install", config.install);

        if (config.build) yield* step("Build", config.build);

        // Tools that fetch on first use (like the pnpm copy `vp` downloads) are cached by starting
        // each target's test runner once online, on a filter that matches no tests; offline, those
        // fetches would hang on DNS for about 30 s on every run instead of failing.
        yield* onStep("Warm up");
        yield* Effect.forEach(Object.values(config.targets), (target) =>
          sh(
            `cd ${quote(`${root}/${target.path}`)} && timeout ${testTimeout} bash -c ${quote(`${target.test} forkin-warm-up-matches-nothing --passWithNoTests`)} > /dev/null 2>&1; true`,
            testTimeout + margin,
          ),
        );

        yield* onStep("Snapshot");
        const saved = yield* snapshot();

        return { id: saved.id, commit: clone.stdout.trim().split("\n").at(-1) ?? ref };
      }),
    );

    const seconds = (Date.now() - started) / 1000;
    const builtAt = DateTime.formatIso(yield* DateTime.now);

    return { id, commit, builtAt, seconds, baselines: {} };
  });

  const refresh = Effect.fn("Bench.refresh")(function* ({
    snapshot: from,
    mirror,
    ref,
    config,
    onStep: report,
  }: RefreshRequest) {
    const { started, onStep } = timedSteps(report);

    const { id, commit } = yield* withBox(
      "refresh",
      from.id,
      ({ sh, snapshot }) =>
        Effect.gen(function* () {
          const step = setupStep(sh, onStep);

          yield* onStep("Fetch");

          // A branch resolves to GitHub's tip of it, anything else to a commit.
          const fetched = yield* sh(
            `cd ${root} && git fetch -q origin 2>&1 && commit=$(git rev-parse -q --verify ${quote(`origin/${ref}^{commit}`)} || git rev-parse -q --verify ${quote(`${ref}^{commit}`)}) && git checkout -q -f "$commit" 2>&1 && echo "$commit"`,
            setupTimeout,
          );

          const commit = fetched.stdout.trim().split("\n").at(-1) ?? "";

          if (fetched.exitCode !== 0 || !commit) {
            return yield* new SetupFailed({ step: "Fetch", output: tail(fetched.stdout) });
          }

          const lockfileDiff = yield* sh(
            `cd ${root} && git diff --quiet ${from.commit} ${commit} -- ${lockfiles.join(" ")}`,
          );

          if (lockfileDiff.exitCode !== 0) {
            return yield* new LockfileChanged({ commit, snapshotHas: from.commit });
          }

          yield* step("Mirror", mirrorPush(mirror));

          if (config.build) yield* step("Build", config.build);

          yield* onStep("Snapshot");
          const saved = yield* snapshot();

          return { id: saved.id, commit };
        }),
      { internet: true },
    );

    const seconds = (Date.now() - started) / 1000;
    const builtAt = DateTime.formatIso(yield* DateTime.now);

    return { id, commit, builtAt, seconds, baselines: {} };
  });

  const baseline = Effect.fn("Bench.baseline")(function* (snapshot: Snapshot, target: Target) {
    const { outcome, passed, failed, failedTests, seconds } = yield* withBox(
      "baseline",
      snapshot.id,
      ({ sh }) => runTests(sh, target, null, suiteTimeout),
    );

    return { outcome, passed, failed, failedTests, seconds };
  });

  /**
   * Checks out the reproducer's commit in a sandbox, writes the test and applies any patch. Returns
   * the commit and what the test alone changes there, as a diff.
   */
  const prepare = Effect.fn("Bench.prepare")(function* (
    { sh, writeFile }: BoxOps,
    { config, snapshot, reproducer, patch }: RunRequest,
  ) {
    const resolved = yield* sh(
      `cd ${root} && git rev-parse --verify -q ${quote(`${reproducer.commit}^{commit}`)}`,
    );

    const commit = resolved.stdout.trim();

    if (!commit) {
      return yield* new CommitUnavailable({
        wanted: reproducer.commit,
        snapshotHas: snapshot.commit,
      });
    }

    const lockfileDiff = yield* sh(
      `cd ${root} && git diff --quiet ${snapshot.commit} ${commit} -- ${lockfiles.join(" ")}`,
    );

    if (lockfileDiff.exitCode !== 0) {
      const tree = yield* sh(`cd ${root} && git ls-tree ${commit} -- ${lockfiles.join(" ")}`);

      return yield* new LockfileChanged({
        commit,
        snapshotHas: snapshot.commit,
        lockfiles: tree.stdout.trim(),
      });
    }

    const absolute = `${root}/${reproducer.path}`;

    yield* sh(`cd ${root} && git checkout -q -f ${commit}`);
    yield* writeFile(absolute, reproducer.source);

    const diff = yield* sh(
      `cd ${root} && git add -N ${quote(absolute)} && git diff --no-color -- ${quote(absolute)}`,
    );

    if (patch) {
      yield* writeFile(patchFile, patch);

      const applied = yield* sh(
        `cd ${root} && git apply --binary --whitespace=nowarn ${patchFile} 2>&1`,
      );

      if (applied.exitCode !== 0) {
        return yield* new PatchDoesNotApply({ output: tail(applied.stdout) });
      }

      // Checks always run the original test, whatever the fix did to it.
      yield* writeFile(absolute, reproducer.source);
    }

    // The snapshot's build output is from its own commit. Tests at another commit, or with a fix,
    // need it rebuilt, or a monorepo's tests import its packages as they were at the snapshot.
    if (config.build && (commit !== snapshot.commit || patch)) {
      yield* sh(
        `cd ${root} && timeout ${setupTimeout} bash -lc ${quote(config.build)} > /tmp/forkin-build.log 2>&1`,
        setupTimeout + margin,
      );
    }

    return { commit, diff: diff.stdout };
  });

  /** The reproducer's target, and the test's path inside it. */
  const targetOf = (config: ForkinConfig, reproducer: Reproducer) => {
    const target = config.targets[reproducer.target];
    const file = target && fileInTarget(target, reproducer.path);

    return target && file
      ? Effect.succeed({ target, file })
      : Effect.fail(new TestOutsideTarget({ target: reproducer.target, path: reproducer.path }));
  };

  const asRun = (commit: string, tests: Omit<Run, "commit" | "at">) =>
    DateTime.now.pipe(Effect.map((now) => ({ commit, ...tests, at: DateTime.formatIso(now) })));

  const run = Effect.fn("Bench.run")(function* (request: RunRequest) {
    const { target, file } = yield* targetOf(request.config, request.reproducer);

    return yield* withBox(`run-${request.runId}`, request.snapshot.id, (box) =>
      Effect.gen(function* () {
        const { commit, diff } = yield* prepare(box, request);
        const tests = yield* runTests(box.sh, target, file, testTimeout);

        return { run: yield* asRun(commit, tests), diff };
      }),
    );
  });

  const suite = Effect.fn("Bench.suite")(function* (request: RunRequest) {
    const { target } = yield* targetOf(request.config, request.reproducer);

    return yield* withBox(`suite-${request.runId}`, request.snapshot.id, (box) =>
      Effect.gen(function* () {
        const { commit } = yield* prepare(box, request);

        return yield* asRun(commit, yield* runTests(box.sh, target, null, suiteTimeout));
      }),
    );
  });

  const fetchFix = Effect.fn("Bench.fetchFix")(function* (fork: Remote, base: string) {
    const clone = "/tmp/fix";

    return yield* withBox("fetch", null, ({ sh }) =>
      Effect.gen(function* () {
        const read = Effect.fn("Bench.fetchFix.read")(function* (step: string, cmd: string) {
          const result = yield* sh(`cd ${clone} && ${cmd}`, setupTimeout);

          if (result.exitCode !== 0) {
            return yield* new SetupFailed({ step, output: tail(result.stdout + result.stderr) });
          }

          return result.stdout;
        });

        const cloned = yield* sh(
          `git ${auth(fork.token)} clone -q ${quote(fork.remote)} ${clone} 2>&1`,
          setupTimeout,
        );

        if (cloned.exitCode !== 0) {
          return yield* new SetupFailed({ step: "Clone the fix", output: tail(cloned.stdout) });
        }

        const head = (yield* read("Find the fix", "git rev-parse HEAD")).trim();
        const commit = (yield* read("Find the issue's commit", `git rev-parse ${base}^`)).trim();
        const patch = yield* read("Read the fix", `git diff --binary ${base} ${head}`);
        const files = yield* read("List the fix's files", `git diff --name-only ${base} ${head}`);

        return { head, commit, patch, files: files.split("\n").filter(Boolean) };
      }),
    );
  });

  const addNote = Effect.fn("Bench.addNote")(function* (
    target: Remote,
    commit: string,
    note: string,
  ) {
    const repo = "/tmp/notes";

    yield* withBox("note", null, ({ sh }) =>
      Effect.gen(function* () {
        const result = yield* sh(
          `git init -q ${repo} && cd ${repo} && git config user.name Forkin && git config user.email forkin@users.noreply.github.com && git ${auth(target.token)} fetch -q --depth 1 ${quote(target.remote)} ${commit} 'refs/notes/*:refs/notes/*' 2>&1; git notes --ref=forkin add -f -m ${quote(note)} ${commit} 2>&1 && git ${auth(target.token)} push -q ${quote(target.remote)} refs/notes/forkin 2>&1`,
          setupTimeout,
        );

        if (result.exitCode !== 0) {
          return yield* new SetupFailed({
            step: "Add the evidence note",
            output: tail(result.stdout),
          });
        }
      }),
    );
  });

  const publish = Effect.fn("Bench.publish")(function* ({
    snapshot,
    reproducer,
    commit,
    message,
    author,
    note,
    target,
  }: PublishRequest) {
    const issue = "/tmp/issue";

    // A one-commit repo: the reproducer's commit, fetched shallowly from the snapshot's clone (any
    // commit, not just a branch tip), plus the test. Online, so it can push.
    return yield* withBox(
      "publish",
      snapshot.id,
      ({ sh, writeFile }) =>
        Effect.gen(function* () {
          const run = Effect.fn("Bench.publish.step")(function* (step: string, cmd: string) {
            const result = yield* sh(`${cmd} 2>&1`);

            if (result.exitCode !== 0)
              return yield* new SetupFailed({ step, output: tail(result.stdout) });

            return result.stdout.trim();
          });

          yield* run(
            "Prepare",
            `rm -rf ${issue} && git init -q -b main ${issue} && cd ${issue} && git -c uploadpack.allowAnySHA1InWant=true fetch -q --depth 1 file://${root} ${commit} && git checkout -q -B main FETCH_HEAD`,
          );
          yield* writeFile(`${issue}/${reproducer.path}`, reproducer.source);
          yield* run(
            "Commit",
            `cd ${issue} && git config user.name ${quote(author)} && git config user.email ${quote(`${author}@users.noreply.github.com`)} && git add -A && git commit -q -m ${quote(message)} && git notes --ref=forkin add -m ${quote(note)} HEAD`,
          );

          return yield* run(
            "Push",
            `cd ${issue} && git ${auth(target.token)} push -q -f ${quote(target.remote)} main refs/notes/forkin && git rev-parse HEAD`,
          );
        }),
      { internet: true },
    );
  });

  return { run, suite, fetchFix, addNote, build, refresh, baseline, publish };
};
