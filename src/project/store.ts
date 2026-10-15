import { Context, DateTime, Effect, Layer, Schema } from "effect";
import {
  ActivityEvent,
  Baseline,
  Environment,
  Fix,
  FixStatus,
  Try,
  TryStatus,
  Issue,
  IssueRepo,
  IssueSummary,
  NewIssue,
  Reproducer,
  Run,
  RunOutcome,
  Snapshot,
  Verdict,
} from "#/domain";

// A Project's records in its Durable Object's SQLite database. Rows come back untyped, so every
// read is decoded with the domain schemas before it reaches Forkin's logic.

export class IssueNotFound extends Schema.TaggedError<IssueNotFound>()("IssueNotFound", {
  number: Schema.Int,
}) {}

export class TryNotFound extends Schema.TaggedError<TryNotFound>()("TryNotFound", {
  id: Schema.String,
}) {}

export class FixNotFound extends Schema.TaggedError<FixNotFound>()("FixNotFound", {
  id: Schema.String,
}) {}

export class NotConfigured extends Schema.TaggedError<NotConfigured>()("NotConfigured", {}) {}

export class ProjectStore extends Context.Service<
  ProjectStore,
  {
    setEnvironment(environment: Environment): Effect.Effect<void>;
    readonly environment: Effect.Effect<Environment, NotConfigured>;
    /** Files the issue, or finds the one already filed with the same key. */
    fileIssue(issue: NewIssue): Effect.Effect<{ issue: Issue; created: boolean }>;
    getIssue(number: number): Effect.Effect<Issue, IssueNotFound>;
    setVerdict(number: number, verdict: Verdict): Effect.Effect<void>;
    setDiff(number: number, diff: string): Effect.Effect<void>;
    /** Changes an issue's title or description; fields left out stay as they are. */
    editIssue(
      number: number,
      edit: { title?: string; body?: string; github?: number },
    ): Effect.Effect<void>;
    setRepo(number: number, repo: IssueRepo): Effect.Effect<void>;
    addRun(number: number, run: Run): Effect.Effect<void>;
    readonly summaries: Effect.Effect<ReadonlyArray<IssueSummary>>;
    startTry(reproducer: Reproducer): Effect.Effect<Try>;
    getTry(id: string): Effect.Effect<Try, TryNotFound>;
    setTryStatus(id: string, status: TryStatus): Effect.Effect<void>;
    readonly runningTries: Effect.Effect<ReadonlyArray<string>>;
    addFix(fix: Fix): Effect.Effect<void>;
    getFix(id: string): Effect.Effect<Fix, FixNotFound>;
    setFixStatus(id: string, status: FixStatus): Effect.Effect<void>;
    /** What a fix changed, as the patch its last check read; null before its first check. */
    fixPatch(id: string): Effect.Effect<string | null>;
    setFixPatch(id: string, patch: string): Effect.Effect<void>;
    /** Fixes being checked: to show, and to start again after a restart. */
    readonly checkingFixes: Effect.Effect<ReadonlyArray<Fix>>;
    /** An issue's fixes, newest first. */
    fixesOf(issue: number): Effect.Effect<ReadonlyArray<Fix>>;
    /** The suite's result at an issue's commit with its test, saved by the first fix checked. */
    suiteBefore(issue: number, commit: string): Effect.Effect<Baseline | null>;
    saveSuiteBefore(issue: number, commit: string, baseline: Baseline): Effect.Effect<void>;
    /** A snapshot built for older dependencies, by the `git ls-tree` of their lockfiles. */
    snapshotFor(lockfiles: string): Effect.Effect<Snapshot | null>;
    saveSnapshot(lockfiles: string, snapshot: Snapshot): Effect.Effect<void>;
    record(event: Omit<ActivityEvent, "at">): Effect.Effect<void>;
    /** Newest first; all of the repo's activity, or one issue's. */
    activity(issue: number | null, limit: number): Effect.Effect<ReadonlyArray<ActivityEvent>>;
  }
>()("forkin/project/ProjectStore") {
  static readonly sqlite = (sql: SqlStorage) =>
    Layer.sync(ProjectStore, () => {
      migrate(sql);

      return ProjectStore.of(makeStore(sql));
    });
}

/** Schema changes in order; the `schema_version` table records how many have run. */
const migrations: ReadonlyArray<string> = [
  `CREATE TABLE environment (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
   CREATE TABLE issues (
     number INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     author TEXT NOT NULL,
     opened_at TEXT NOT NULL,
     verdict TEXT NOT NULL,
     reproducer TEXT
   );
   CREATE TABLE runs (
     issue INTEGER NOT NULL REFERENCES issues(number),
     commit_sha TEXT NOT NULL,
     outcome TEXT NOT NULL,
     passed INTEGER NOT NULL,
     failed INTEGER NOT NULL,
     seconds REAL NOT NULL,
     at TEXT NOT NULL
   );`,
  // forkin.json replaces the hand-written environment; the old row no longer decodes.
  `DELETE FROM environment;
   ALTER TABLE issues ADD COLUMN diff TEXT;
   ALTER TABLE runs ADD COLUMN failed_tests TEXT NOT NULL DEFAULT '[]';`,
  `CREATE TABLE activity (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     at TEXT NOT NULL,
     issue INTEGER,
     kind TEXT NOT NULL,
     message TEXT NOT NULL
   );`,
  `ALTER TABLE issues ADD COLUMN repo TEXT;`,
  `ALTER TABLE issues ADD COLUMN client_key TEXT;
   CREATE UNIQUE INDEX issues_client_key ON issues (client_key);
   CREATE TABLE tries (
     id TEXT PRIMARY KEY,
     reproducer TEXT NOT NULL,
     started_at TEXT NOT NULL,
     status TEXT NOT NULL
   );`,
  `CREATE TABLE fixes (
     id TEXT PRIMARY KEY,
     issue INTEGER NOT NULL REFERENCES issues(number),
     author TEXT NOT NULL,
     fork TEXT NOT NULL,
     started_at TEXT NOT NULL,
     status TEXT NOT NULL
   );
   CREATE TABLE suites_before (
     issue INTEGER NOT NULL REFERENCES issues(number),
     commit_sha TEXT NOT NULL,
     baseline TEXT NOT NULL,
     PRIMARY KEY (issue, commit_sha)
   );`,
  `ALTER TABLE issues ADD COLUMN body TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE fixes ADD COLUMN patch TEXT;`,
  `ALTER TABLE issues ADD COLUMN github INTEGER;`,
  `CREATE TABLE snapshots (lockfiles TEXT PRIMARY KEY, json TEXT NOT NULL);`,
  `ALTER TABLE fixes ADD COLUMN built_on TEXT;`,
];

const migrate = (sql: SqlStorage) => {
  sql.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`);

  const [row] = sql.exec<{ version: number }>(`SELECT version FROM schema_version`).toArray();

  // Projects created before versioning already ran the first migration's tables.
  const hasTables =
    sql.exec(`SELECT 1 FROM sqlite_master WHERE name = 'issues'`).toArray().length > 0;

  const applied = row?.version ?? (hasTables ? 1 : 0);

  migrations.slice(applied).forEach((migration) => sql.exec(migration));
  sql.exec(`DELETE FROM schema_version`);
  sql.exec(`INSERT INTO schema_version (version) VALUES (?)`, migrations.length);
};

const IssueRow = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  body: Schema.String,
  github: Schema.NullOr(Schema.Int),
  author: Schema.String,
  opened_at: Schema.String,
  verdict: Schema.fromJsonString(Verdict),
  reproducer: Schema.NullOr(Schema.fromJsonString(Reproducer)),
  diff: Schema.NullOr(Schema.String),
  repo: Schema.NullOr(Schema.fromJsonString(IssueRepo)),
  client_key: Schema.NullOr(Schema.String),
});

const RunRow = Schema.Struct({
  commit_sha: Schema.String,
  outcome: RunOutcome,
  passed: Schema.Int,
  failed: Schema.Int,
  failed_tests: Schema.fromJsonString(Schema.Array(Schema.String)),
  seconds: Schema.Finite,
  at: Schema.String,
});

const TryRow = Schema.Struct({
  id: Schema.String,
  reproducer: Schema.fromJsonString(Reproducer),
  started_at: Schema.String,
  status: Schema.fromJsonString(TryStatus),
});

const decodeTryRows = Schema.decodeUnknownSync(Schema.Array(TryRow));
const encodeTryStatus = Schema.encodeSync(Schema.fromJsonString(TryStatus));

const FixRow = Schema.Struct({
  id: Schema.String,
  issue: Schema.Int,
  author: Schema.String,
  fork: Schema.fromJsonString(Fix.fields.fork),
  started_at: Schema.String,
  status: Schema.fromJsonString(FixStatus),
  built_on: Schema.NullOr(Schema.String),
});

const decodeFixRows = Schema.decodeUnknownSync(Schema.Array(FixRow));
const encodeFixStatus = Schema.encodeSync(Schema.fromJsonString(FixStatus));
const encodeFork = Schema.encodeSync(Schema.fromJsonString(Fix.fields.fork));
const BaselineJson = Schema.fromJsonString(Baseline);

const decodeBaselineRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ baseline: BaselineJson })),
);

const encodeBaseline = Schema.encodeSync(BaselineJson);
const SnapshotJson = Schema.fromJsonString(Snapshot);

const decodeSnapshotRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ json: SnapshotJson })),
);

const encodeSnapshot = Schema.encodeSync(SnapshotJson);

const decodePatchRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ patch: Schema.NullOr(Schema.String) })),
);

const decodeFixCounts = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ issue: Schema.Int, total: Schema.Int, proven: Schema.Int })),
);

const toFix = ({ started_at, built_on, ...row }: typeof FixRow.Type): Fix => ({
  ...row,
  startedAt: started_at,
  builtOn: built_on ?? undefined,
});

const decodeActivityRows = Schema.decodeUnknownSync(Schema.Array(ActivityEvent));

const EnvironmentRow = Schema.Struct({ json: Schema.fromJsonString(Environment) });

// Rows that fail to decode mean the database and the code disagree: a bug, not a recoverable error.
const decodeIssueRows = Schema.decodeUnknownSync(Schema.Array(IssueRow));
const decodeRunRows = Schema.decodeUnknownSync(Schema.Array(RunRow));
const decodeEnvironmentRows = Schema.decodeUnknownSync(Schema.Array(EnvironmentRow));
const encodeVerdict = Schema.encodeSync(Schema.fromJsonString(Verdict));
const encodeReproducer = Schema.encodeSync(Schema.fromJsonString(Reproducer));
const encodeIssueRepo = Schema.encodeSync(Schema.fromJsonString(IssueRepo));
const encodeEnvironment = Schema.encodeSync(Schema.fromJsonString(Environment));
const encodeNames = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

const makeStore = (sql: SqlStorage): ProjectStore["Service"] => {
  const issueRows = (where: string, ...bindings: Array<SqlStorageValue>) =>
    decodeIssueRows(
      sql.exec(`SELECT * FROM issues ${where} ORDER BY number DESC`, ...bindings).toArray(),
    );

  const runsOf = (number: number): ReadonlyArray<Run> =>
    decodeRunRows(
      sql.exec(`SELECT * FROM runs WHERE issue = ? ORDER BY at DESC`, number).toArray(),
    ).map(({ commit_sha, failed_tests, ...run }) => ({
      commit: commit_sha,
      failedTests: failed_tests,
      ...run,
    }));

  const toIssue = (row: typeof IssueRow.Type): Issue => ({
    number: row.number,
    title: row.title,
    body: row.body,
    github: row.github,
    author: row.author,
    openedAt: row.opened_at,
    verdict: row.verdict,
    reproducer: row.reproducer,
    diff: row.diff,
    repo: row.repo,
    runs: runsOf(row.number),
  });

  const getIssue = Effect.fn("ProjectStore.getIssue")(function* (number: number) {
    const [row] = issueRows("WHERE number = ?", number);

    if (!row) return yield* new IssueNotFound({ number });

    return toIssue(row);
  });

  return {
    setEnvironment: Effect.fn("ProjectStore.setEnvironment")((environment) =>
      Effect.sync(() => {
        sql.exec(
          `INSERT INTO environment (id, json) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET json = excluded.json`,
          encodeEnvironment(environment),
        );
      }),
    ),

    environment: Effect.suspend(() => {
      const [row] = decodeEnvironmentRows(sql.exec(`SELECT json FROM environment`).toArray());

      return row ? Effect.succeed(row.json) : Effect.fail(new NotConfigured({}));
    }),

    fileIssue: Effect.fn("ProjectStore.fileIssue")(function* (issue) {
      const [existing] = issue.key ? issueRows("WHERE client_key = ?", issue.key) : [];

      if (existing) return { issue: toIssue(existing), created: false };

      const openedAt = DateTime.formatIso(yield* DateTime.now);

      const verdict = issue.reproducer
        ? Verdict.cases.Checking.make({})
        : Verdict.cases.Unverified.make({});

      const { number } = sql
        .exec<{ number: number }>(
          `INSERT INTO issues (number, title, body, github, author, opened_at, verdict, reproducer, client_key)
           VALUES ((SELECT COALESCE(MAX(number), 0) + 1 FROM issues), ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING number`,
          issue.title,
          issue.body ?? "",
          issue.github ?? null,
          issue.author,
          openedAt,
          encodeVerdict(verdict),
          issue.reproducer ? encodeReproducer(issue.reproducer) : null,
          issue.key ?? null,
        )
        .one();

      return { issue: yield* getIssue(number).pipe(Effect.orDie), created: true };
    }),

    startTry: Effect.fn("ProjectStore.startTry")(function* (reproducer) {
      const tried = {
        id: crypto.randomUUID(),
        reproducer,
        startedAt: DateTime.formatIso(yield* DateTime.now),
        status: TryStatus.cases.Running.make({}),
      };

      sql.exec(
        `INSERT INTO tries (id, reproducer, started_at, status) VALUES (?, ?, ?, ?)`,
        tried.id,
        encodeReproducer(reproducer),
        tried.startedAt,
        encodeTryStatus(tried.status),
      );

      return tried;
    }),

    getTry: Effect.fn("ProjectStore.getTry")(function* (id) {
      const [row] = decodeTryRows(sql.exec(`SELECT * FROM tries WHERE id = ?`, id).toArray());

      if (!row) return yield* new TryNotFound({ id });

      return {
        id: row.id,
        reproducer: row.reproducer,
        startedAt: row.started_at,
        status: row.status,
      };
    }),

    setTryStatus: Effect.fn("ProjectStore.setTryStatus")((id, status) =>
      Effect.sync(() => {
        sql.exec(`UPDATE tries SET status = ? WHERE id = ?`, encodeTryStatus(status), id);
      }),
    ),

    addFix: Effect.fn("ProjectStore.addFix")((fix) =>
      Effect.sync(() => {
        sql.exec(
          `INSERT INTO fixes (id, issue, author, fork, started_at, status, built_on) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          fix.id,
          fix.issue,
          fix.author,
          encodeFork(fix.fork),
          fix.startedAt,
          encodeFixStatus(fix.status),
          fix.builtOn ?? null,
        );
      }),
    ),

    getFix: Effect.fn("ProjectStore.getFix")(function* (id) {
      const [row] = decodeFixRows(sql.exec(`SELECT * FROM fixes WHERE id = ?`, id).toArray());

      if (!row) return yield* new FixNotFound({ id });

      return toFix(row);
    }),

    setFixStatus: Effect.fn("ProjectStore.setFixStatus")((id, status) =>
      Effect.sync(() => {
        sql.exec(`UPDATE fixes SET status = ? WHERE id = ?`, encodeFixStatus(status), id);
      }),
    ),

    fixPatch: Effect.fn("ProjectStore.fixPatch")((id) =>
      Effect.sync(
        () =>
          decodePatchRows(sql.exec(`SELECT patch FROM fixes WHERE id = ?`, id).toArray())[0]
            ?.patch ?? null,
      ),
    ),

    setFixPatch: Effect.fn("ProjectStore.setFixPatch")((id, patch) =>
      Effect.sync(() => {
        sql.exec(`UPDATE fixes SET patch = ? WHERE id = ?`, patch, id);
      }),
    ),

    checkingFixes: Effect.sync(() =>
      decodeFixRows(sql.exec(`SELECT * FROM fixes`).toArray())
        .filter((row) => FixStatus.guards.Checking(row.status))
        .map(toFix),
    ),

    fixesOf: Effect.fn("ProjectStore.fixesOf")((issue) =>
      Effect.sync(() =>
        decodeFixRows(
          sql.exec(`SELECT * FROM fixes WHERE issue = ? ORDER BY started_at DESC`, issue).toArray(),
        ).map(toFix),
      ),
    ),

    suiteBefore: Effect.fn("ProjectStore.suiteBefore")((issue, commit) =>
      Effect.sync(
        () =>
          decodeBaselineRows(
            sql
              .exec(
                `SELECT baseline FROM suites_before WHERE issue = ? AND commit_sha = ?`,
                issue,
                commit,
              )
              .toArray(),
          )[0]?.baseline ?? null,
      ),
    ),

    saveSuiteBefore: Effect.fn("ProjectStore.saveSuiteBefore")((issue, commit, baseline) =>
      Effect.sync(() => {
        sql.exec(
          `INSERT OR REPLACE INTO suites_before (issue, commit_sha, baseline) VALUES (?, ?, ?)`,
          issue,
          commit,
          encodeBaseline(baseline),
        );
      }),
    ),

    snapshotFor: Effect.fn("ProjectStore.snapshotFor")((lockfiles) =>
      Effect.sync(() => {
        const [row] = decodeSnapshotRows(
          sql.exec(`SELECT json FROM snapshots WHERE lockfiles = ?`, lockfiles).toArray(),
        );

        return row?.json ?? null;
      }),
    ),

    saveSnapshot: Effect.fn("ProjectStore.saveSnapshot")((lockfiles, snapshot) =>
      Effect.sync(() => {
        sql.exec(
          `INSERT OR REPLACE INTO snapshots (lockfiles, json) VALUES (?, ?)`,
          lockfiles,
          encodeSnapshot(snapshot),
        );
      }),
    ),

    runningTries: Effect.sync(() =>
      decodeTryRows(sql.exec(`SELECT * FROM tries`).toArray())
        .filter((row) => TryStatus.guards.Running(row.status))
        .map((row) => row.id),
    ),

    getIssue,

    setVerdict: Effect.fn("ProjectStore.setVerdict")((number, verdict) =>
      Effect.sync(() => {
        sql.exec(`UPDATE issues SET verdict = ? WHERE number = ?`, encodeVerdict(verdict), number);
      }),
    ),

    editIssue: Effect.fn("ProjectStore.editIssue")((number, { title, body, github }) =>
      Effect.sync(() => {
        sql.exec(
          `UPDATE issues SET title = COALESCE(?, title), body = COALESCE(?, body),
             github = COALESCE(?, github) WHERE number = ?`,
          title ?? null,
          body ?? null,
          github ?? null,
          number,
        );
      }),
    ),

    setDiff: Effect.fn("ProjectStore.setDiff")((number, diff) =>
      Effect.sync(() => {
        sql.exec(`UPDATE issues SET diff = ? WHERE number = ?`, diff, number);
      }),
    ),

    setRepo: Effect.fn("ProjectStore.setRepo")((number, repo) =>
      Effect.sync(() => {
        sql.exec(`UPDATE issues SET repo = ? WHERE number = ?`, encodeIssueRepo(repo), number);
      }),
    ),

    addRun: Effect.fn("ProjectStore.addRun")((number, run) =>
      Effect.sync(() => {
        sql.exec(
          `INSERT INTO runs (issue, commit_sha, outcome, passed, failed, failed_tests, seconds, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          number,
          run.commit,
          run.outcome,
          run.passed,
          run.failed,
          encodeNames(run.failedTests),
          run.seconds,
          run.at,
        );
      }),
    ),

    record: Effect.fn("ProjectStore.record")(function* ({ issue, kind, message }) {
      const at = DateTime.formatIso(yield* DateTime.now);

      sql.exec(
        `INSERT INTO activity (at, issue, kind, message) VALUES (?, ?, ?, ?)`,
        at,
        issue,
        kind,
        message,
      );
      yield* Effect.logInfo(message).pipe(Effect.annotateLogs({ issue, kind }));
    }),

    activity: Effect.fn("ProjectStore.activity")((issue, limit) =>
      Effect.sync(() =>
        decodeActivityRows(
          issue === null
            ? sql
                .exec(
                  `SELECT at, issue, kind, message FROM activity ORDER BY id DESC LIMIT ?`,
                  limit,
                )
                .toArray()
            : sql
                .exec(
                  `SELECT at, issue, kind, message FROM activity WHERE issue = ? ORDER BY id DESC LIMIT ?`,
                  issue,
                  limit,
                )
                .toArray(),
        ),
      ),
    ),

    summaries: Effect.sync(() => {
      const counts = new Map(
        decodeFixCounts(
          sql
            .exec(
              `SELECT issue, COUNT(*) AS total,
                 SUM(json_extract(status, '$._tag') = 'Proven') AS proven
               FROM fixes GROUP BY issue`,
            )
            .toArray(),
        ).map(({ issue, total, proven }) => [issue, { total, proven }]),
      );

      return issueRows("").map((row) => ({
        number: row.number,
        title: row.title,
        author: row.author,
        openedAt: row.opened_at,
        verdict: row.verdict,
        hasTest: row.reproducer !== null,
        fixes: counts.get(row.number) ?? { total: 0, proven: 0 },
      }));
    }),
  };
};
