import { Schema } from "effect";

// Forkin's domain: what a Project stores, what a Bench reports, and what the dashboard renders.

/** A package or test project inside a repo. `path` is relative to the repo root. */
export const Target = Schema.Struct({
  path: Schema.String,
  /** The test command, run from `path`; Forkin appends the test file and its reporter flags. */
  test: Schema.String,
});

export type Target = typeof Target.Type;

/** `forkin.json`: how to install a repo and run its tests. Lives in the repo, written by its maintainer's agent. */
export const ForkinConfig = Schema.Struct({
  /** Runs once with the network on, from the repo root. */
  install: Schema.String,
  /** Runs after install, network on; for repos whose tests need built packages. */
  build: Schema.optionalKey(Schema.String),
  targets: Schema.Record(Schema.String, Target),
});

export type ForkinConfig = typeof ForkinConfig.Type;

/** How one run of a test ended. `broken` means it crashed before any test could run. */
export const RunOutcome = Schema.Literals(["fail", "pass", "broken"]);

export type RunOutcome = typeof RunOutcome.Type;

/** What a target's whole suite does on the snapshot's commit, offline. Fixes are measured against it. */
export const Baseline = Schema.Struct({
  /** `broken` means the suite couldn't run at all, so there is no baseline to compare against. */
  outcome: RunOutcome,
  passed: Schema.Int,
  failed: Schema.Int,
  failedTests: Schema.Array(Schema.String),
  seconds: Schema.Finite,
});

export type Baseline = typeof Baseline.Type;

/** A saved sandbox with the repo cloned and installed at `commit`. */
export const Snapshot = Schema.Struct({
  id: Schema.String,
  commit: Schema.String,
  builtAt: Schema.String,
  /** Seconds to clone, install, build and warm up. */
  seconds: Schema.Finite,
  baselines: Schema.Record(Schema.String, Baseline),
});

export type Snapshot = typeof Snapshot.Type;

export const EnvironmentStatus = Schema.TaggedUnion({
  Building: { commit: Schema.String, step: Schema.String },
  Ready: { snapshot: Snapshot },
  Failed: { commit: Schema.String, message: Schema.String },
});

export type EnvironmentStatus = typeof EnvironmentStatus.Type;

/** A repo's config and the state of the sandbox snapshot built from it. */
export const Environment = Schema.Struct({
  config: ForkinConfig,
  status: EnvironmentStatus,
});

export type Environment = typeof Environment.Type;

/** A failing test that proves an issue: a file in the repo's own framework, at a commit. */
export const Reproducer = Schema.Struct({
  target: Schema.String,
  /** Path from the repo root. */
  path: Schema.String,
  source: Schema.String,
  commit: Schema.String,
});

export type Reproducer = typeof Reproducer.Type;

/** One run of a test on a Bench. */
export const Run = Schema.Struct({
  commit: Schema.String,
  outcome: RunOutcome,
  passed: Schema.Int,
  failed: Schema.Int,
  seconds: Schema.Finite,
  /** Names of the tests that failed, so a maintainer sees what broke without reading code. */
  failedTests: Schema.Array(Schema.String),
  /** ISO timestamp of when the run finished. */
  at: Schema.String,
  /** The end of the test runner's output, when the test crashed before reporting, to show why. */
  log: Schema.optional(Schema.String),
});

export type Run = typeof Run.Type;

/** Triage result for an issue. A Reproduced test stays provisional until a fix makes it pass. */
export const Verdict = Schema.TaggedUnion({
  Unverified: {},
  Checking: {},
  Reproduced: {},
  CouldntReproduce: { failedRuns: Schema.Int, totalRuns: Schema.Int },
  BrokenTest: {},
  AlreadyFixed: { commit: Schema.String },
});

export type Verdict = typeof Verdict.Type;

/** The issue's own Artifacts repo: its failing test as one commit, with the evidence as a git note. */
export const IssueRepo = Schema.Struct({
  name: Schema.String,
  remote: Schema.String,
  commit: Schema.String,
});

export type IssueRepo = typeof IssueRepo.Type;

/** An issue with everything known about it. */
export const Issue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  /** The reporter's description; empty when they gave none. */
  body: Schema.String,
  /** The same bug's issue number on GitHub, when it has one. */
  github: Schema.NullOr(Schema.Int),
  author: Schema.String,
  openedAt: Schema.String,
  verdict: Verdict,
  reproducer: Schema.NullOr(Reproducer),
  /** What the reproducer changed in the repo at its commit, as a unified diff. Set by the first run. */
  diff: Schema.NullOr(Schema.String),
  /** Published after each check that reached a verdict. */
  repo: Schema.NullOr(IssueRepo),
  /** Runs of the reproducer, newest first. */
  runs: Schema.Array(Run),
});

export type Issue = typeof Issue.Type;

/** What a fix's checks found. Each check either holds or says why not, in a sentence. */
export const FixChecks = Schema.Struct({
  /** The issue's original test, run `runsPerVerdict` times on the fix. */
  test: Schema.Struct({ passed: Schema.Boolean, runs: Schema.Array(Run) }),
  /** The target's whole suite on the fix, against the same suite at the issue's commit. */
  suite: Schema.Struct({
    holds: Schema.Boolean,
    run: Run,
    before: Baseline,
    /** Tests that passed at the issue's commit and fail with the fix. */
    newlyFailing: Schema.Array(Schema.String),
  }),
  /** The fix leaves the failing test itself alone. */
  testUntouched: Schema.Boolean,
});

export type FixChecks = typeof FixChecks.Type;

/** Where a fix stands. Only a Proven fix goes to a maintainer. */
export const FixStatus = Schema.TaggedUnion({
  /** Waiting for its agent to push and ask for a check. */
  Open: {},
  /** `commit` is null until the fork has been read. */
  Checking: { commit: Schema.NullOr(Schema.String) },
  Proven: { commit: Schema.String, checks: FixChecks },
  /** At least one check failed; `reasons` say which and why. */
  Rejected: {
    commit: Schema.String,
    reasons: Schema.Array(Schema.String),
    checks: Schema.NullOr(FixChecks),
  },
});

export type FixStatus = typeof FixStatus.Type;

/** One agent's attempt at an issue: a fork of the issue's Artifacts repo that it pushes to. */
export const Fix = Schema.Struct({
  id: Schema.String,
  issue: Schema.Int,
  /** Who the attempt is for: an agent's name, a person, or both. */
  author: Schema.String,
  /** The fork on Artifacts. Cloning and pushing need the token `startFix` hands out. */
  fork: Schema.Struct({
    name: Schema.String,
    remote: Schema.String,
    /** The commit it started at: the issue's commit with its failing test on top. */
    base: Schema.String,
  }),
  startedAt: Schema.String,
  status: FixStatus,
  /** The fix whose fork this one started from, when it built on another attempt. */
  builtOn: Schema.optional(Schema.String),
});

export type Fix = typeof Fix.Type;

/** A started fix and the write token its agent pushes with; tokens last two hours. */
export const StartedFix = Schema.Struct({ fix: Fix, token: Schema.String });

export type StartedFix = typeof StartedFix.Type;

/** What every dashboard watching a repo receives live. Details are fetched per issue. */
export const IssueSummary = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  author: Schema.String,
  openedAt: Schema.String,
  verdict: Verdict,
  hasTest: Schema.Boolean,
  /** Agents' fixes to the issue, and how many of them are proven. */
  fixes: Schema.Struct({ total: Schema.Int, proven: Schema.Int }),
});

export type IssueSummary = typeof IssueSummary.Type;

/** Work a Project has in flight right now, so watchers see what's running at once. */
export const RunningWork = Schema.Struct({
  what: Schema.Literals(["build", "check", "fix", "try"]),
  issue: Schema.NullOr(Schema.Int),
  /** Who it's for, or what it's doing, in a few words. */
  label: Schema.String,
});

export type RunningWork = typeof RunningWork.Type;

/** One thing that happened in a Project, for watching and debugging it live. */
export const ActivityEvent = Schema.Struct({
  at: Schema.String,
  /** The issue it concerns, or null for repo-wide work like building the snapshot. */
  issue: Schema.NullOr(Schema.Int),
  kind: Schema.Literals(["build", "baseline", "run", "verdict", "publish", "fix", "error"]),
  message: Schema.String,
});

export type ActivityEvent = typeof ActivityEvent.Type;

export const ProjectState = Schema.Struct({
  environment: Schema.NullOr(EnvironmentStatus),
  issues: Schema.Array(IssueSummary),
  running: Schema.Array(RunningWork),
  /** The most recent activity, newest first. */
  activity: Schema.Array(ActivityEvent),
});

export type ProjectState = typeof ProjectState.Type;

/** A new issue as filed. */
export const NewIssue = Schema.Struct({
  title: Schema.String,
  /** What's wrong and how it shows, in the reporter's words; plain text or Markdown. */
  body: Schema.optionalKey(Schema.String),
  /** The same bug's issue number on GitHub, when it has one. */
  github: Schema.optionalKey(Schema.Int),
  author: Schema.String,
  reproducer: Schema.optionalKey(Reproducer),
  /** Chosen by the client; filing again with the same key returns the first issue instead of a copy. */
  key: Schema.optionalKey(Schema.String),
});

export type NewIssue = typeof NewIssue.Type;

/** Where a try stands. A try records nothing on the repo; only whoever started it reads it. */
export const TryStatus = Schema.TaggedUnion({
  Running: {},
  Done: { verdict: Verdict, runs: Schema.Array(Run), diff: Schema.String },
  /** Something other than the test went wrong: the Bench, the commit, the dependencies. */
  Failed: { message: Schema.String },
});

export type TryStatus = typeof TryStatus.Type;

/** A reproducer run as a check would run it, without filing an issue. */
export const Try = Schema.Struct({
  id: Schema.String,
  reproducer: Reproducer,
  startedAt: Schema.String,
  status: TryStatus,
});

export type Try = typeof Try.Type;

/**
 * A Project's Durable Object name: `owner/repo` with a `~`, since names become URL path segments.
 * Lowercase, because GitHub names ignore case: its events say `ThinkEx-OSS/thinkex` for the repo
 * people type as `thinkex-oss/thinkex`.
 */
export const projectName = (owner: string, repo: string) =>
  `${owner.toLowerCase()}~${repo.toLowerCase()}`;
