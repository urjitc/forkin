#!/usr/bin/env node
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { execFileSync } from "node:child_process";
import { Config, Console, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { ForkinApi } from "#/api/definition";
import {
  FixStatus,
  ForkinConfig,
  TryStatus,
  Verdict,
  type Fix,
  type Issue,
  type Try,
} from "#/domain";

// The `forkin` CLI, for coding agents and people: a thin client over Forkin's HTTP API. Every
// command prints JSON on stdout (indented on a terminal, compact for agents), and the exit code
// says how it went, so an agent can branch on it without parsing.

/** A result that isn't a success, though nothing went wrong: the test didn't reproduce, or is still running. */
class Outcome extends Schema.TaggedError<Outcome>()("Outcome", {
  reason: Schema.Literals(["DidNotReproduce", "StillRunning", "TryFailed", "FixRejected"]),
  message: Schema.String,
}) {}

/** Exit codes an agent can branch on; anything not listed exits 1. */
const exitCodes = new Map([
  ["DidNotReproduce", 5],
  ["FixRejected", 6],
  ["StillRunning", 8],
  ["Unauthorized", 3],
  ["MissingToken", 3],
  ["NotFound", 4],
]);

/** Prints a failure as JSON on stderr and sets the exit code for it. */
const report = (error: { _tag: string; message: string }) => {
  const code = error instanceof Outcome ? error.reason : error._tag;

  return Console.error(JSON.stringify({ error: { code, message: error.message } })).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = exitCodes.get(code) ?? 1;
      }),
    ),
  );
};

class MissingToken extends Schema.TaggedError<MissingToken>()("MissingToken", {
  message: Schema.String,
}) {}

class UnreadableTest extends Schema.TaggedError<UnreadableTest>()("UnreadableTest", {
  message: Schema.String,
}) {}

const print = <A>(value: A) =>
  Console.log(JSON.stringify(value, null, process.stdout.isTTY ? 2 : undefined));

const client = Effect.gen(function* () {
  const url = yield* Config.String("FORKIN_URL").pipe(
    Config.withDefault("https://forkin.urjit.me"),
  );

  const token = yield* Config.Redacted("FORKIN_TOKEN").pipe(
    Effect.mapError(() => new MissingToken({ message: "Set FORKIN_TOKEN to your Forkin token." })),
  );

  return yield* HttpApiClient.make(ForkinApi, {
    baseUrl: url,
    transformClient: HttpClient.mapRequest(HttpClientRequest.bearerToken(Redacted.value(token))),
  });
});

const repoArg = Argument.String("owner/repo").pipe(
  Argument.withDescription("The repository on GitHub, like thinkex-oss/thinkex"),
  Argument.mapTryCatch(
    (value) => {
      const [owner, repo, ...rest] = value.split("/");

      if (!owner || !repo || rest.length > 0) throw new Error("owner/repo");

      return { owner, repo };
    },
    () => "owner/repo, like thinkex-oss/thinkex",
  ),
);

/** How long a command waits for tests to finish. */
const waiting = {
  noWait: Flag.Boolean("no-wait").pipe(
    Flag.withDescription("Answer at once with where the work stands, instead of waiting"),
    Flag.withDefault(false),
  ),
  timeout: Flag.Int("timeout").pipe(
    Flag.withDescription("Most seconds to keep waiting after the first answer"),
    Flag.withDefault(300),
  ),
};

/** The longest the server holds one call open; the CLI asks again until the work is done. */
const serverWait = 50;

/**
 * Starts or reads some work, then asks again while it's `running`, each call waiting up to 50 s on
 * the server, until it's done or `timeout` seconds pass. With --no-wait, answers at once.
 */
const keepWaiting = <A, E, R>(
  flags: { noWait: boolean; timeout: number },
  first: (query: { wait: number }) => Effect.Effect<A, E, R>,
  again: (latest: A, query: { wait: number }) => Effect.Effect<A, E, R>,
  running: (latest: A) => boolean,
) =>
  flags.noWait
    ? first({ wait: 0 })
    : first({ wait: serverWait }).pipe(
        Effect.filterOrElse(
          (latest) => !running(latest),
          (latest) =>
            again(latest, { wait: serverWait }).pipe(
              Effect.repeat({ until: (next) => !running(next) }),
              Effect.timeoutOrElse({
                duration: `${flags.timeout} seconds`,
                orElse: () => again(latest, { wait: 0 }),
              }),
            ),
        ),
      );

const checking = (issue: Issue) => Verdict.guards.Checking(issue.verdict);
const tryRunning = (tried: Try) => TryStatus.guards.Running(tried.status);

/** The failing test, read from a file in the clone the command runs in. */
const testFlags = {
  test: Flag.String("test").pipe(
    Flag.withDescription("The failing test file, as a path from the repo root"),
  ),
  target: Flag.String("target").pipe(
    Flag.withDescription("Which target in the repo's forkin.json runs it, like node or workers"),
  ),
  commit: Flag.String("commit").pipe(
    Flag.withDescription("The commit the test should fail on; defaults to HEAD of this clone"),
    Flag.optional,
  ),
};

const readReproducer = (flags: { test: string; target: string; commit: Option.Option<string> }) =>
  Effect.try({
    try: () => ({
      target: flags.target,
      path: flags.test,
      source: execFileSync("cat", [flags.test], { encoding: "utf8" }),
      commit: Option.getOrElse(flags.commit, () =>
        execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      ),
    }),
    catch: (error) => new UnreadableTest({ message: String(error) }),
  });

/** Why a verdict isn't a success; null when it is one. */
const verdictProblem = Verdict.match({
  Reproduced: () => null,
  Unverified: () => null,
  Checking: () => new Outcome({ reason: "StillRunning", message: "Still checking" }),
  AlreadyFixed: () => new Outcome({ reason: "DidNotReproduce", message: "Already fixed" }),
  CouldntReproduce: () =>
    new Outcome({ reason: "DidNotReproduce", message: "The test didn't fail every run" }),
  BrokenTest: () =>
    new Outcome({ reason: "DidNotReproduce", message: "The test crashed before it ran" }),
});

/** Fails with the exit code a verdict stands for, after its JSON is printed. */
const verdictOutcome = (verdict: Verdict) => {
  const problem = verdictProblem(verdict);

  return problem ? Effect.fail(problem) : Effect.void;
};

const issueOutcome = (issue: Issue) =>
  print(issue).pipe(Effect.andThen(verdictOutcome(issue.verdict)));

const tryOutcome = (tried: Try) =>
  print(tried).pipe(
    Effect.andThen(
      TryStatus.match(tried.status, {
        Running: () =>
          Effect.fail(new Outcome({ reason: "StillRunning", message: "Still running" })),
        Done: ({ verdict }) => verdictOutcome(verdict),
        Failed: ({ message }) => Effect.fail(new Outcome({ reason: "TryFailed", message })),
      }),
    ),
  );

const repoGet = Command.make("get", { repo: repoArg }, ({ repo }) =>
  client.pipe(
    Effect.flatMap((api) => api.repos.get({ params: repo })),
    Effect.flatMap(print),
  ),
).pipe(Command.withDescription("The repo's environment, issues and recent activity"));

const repoConfigure = Command.make(
  "configure",
  {
    repo: repoArg,
    config: Flag.FileSchema("config", Schema.fromJsonString(ForkinConfig)).pipe(
      Flag.withDescription("The repo's forkin.json"),
    ),
    ref: Flag.String("ref").pipe(
      Flag.withDescription("The commit or branch to build the snapshot from"),
      Flag.withDefault("main"),
    ),
  },
  ({ repo, config, ref }) =>
    client.pipe(
      Effect.flatMap((api) => api.repos.configure({ params: repo, payload: { config, ref } })),
      Effect.andThen(print({ building: `${repo.owner}/${repo.repo} at ${ref}` })),
    ),
).pipe(Command.withDescription("Sets the repo's forkin.json and rebuilds its snapshot"));

const repoSync = Command.make(
  "sync",
  {
    repo: repoArg,
    ref: Flag.String("ref").pipe(
      Flag.withDescription("The default branch's new commit, or a branch for its tip"),
      Flag.withDefault("main"),
    ),
  },
  ({ repo, ref }) =>
    client.pipe(
      Effect.flatMap((api) => api.repos.sync({ params: repo, payload: { ref } })),
      Effect.andThen(print({ syncing: `${repo.owner}/${repo.repo} at ${ref}` })),
    ),
).pipe(
  Command.withDescription(
    "Moves the repo's snapshot to its latest commit and checks open issues there; the GitHub App does this on every push",
  ),
);

const issueList = Command.make("list", { repo: repoArg }, ({ repo }) =>
  client.pipe(
    Effect.flatMap((api) => api.issues.list({ params: repo })),
    Effect.flatMap(print),
  ),
).pipe(Command.withDescription("The repo's issues with their verdicts"));

const githubFlag = Flag.Int("github").pipe(
  Flag.withDescription("The same bug's issue number on GitHub"),
  Flag.optional,
);

const issueNumber = Argument.Int("number").pipe(Argument.withDescription("The issue's number"));

const issueGet = Command.make(
  "get",
  { repo: repoArg, number: issueNumber, ...waiting },
  ({ repo, number, ...flags }) =>
    client.pipe(
      Effect.flatMap((api) => {
        const get = (query: { wait: number }) =>
          api.issues.get({ params: { ...repo, number }, query });

        return keepWaiting(
          flags,
          get,
          (_, query) => get(query),
          ({ issue }) => checking(issue),
        );
      }),
      Effect.flatMap(({ issue, activity }) =>
        print({ issue, activity }).pipe(Effect.andThen(verdictOutcome(issue.verdict))),
      ),
    ),
).pipe(Command.withDescription("An issue with its test, runs, Artifacts repo and activity"));

const issueCreate = Command.make(
  "create",
  {
    repo: repoArg,
    title: Flag.String("title").pipe(Flag.withDescription("What's wrong, in one line")),
    body: Flag.String("body").pipe(
      Flag.withDescription("What's wrong and how it shows, in your words; Markdown is fine"),
      Flag.optional,
    ),
    github: githubFlag,
    author: Flag.String("author").pipe(Flag.withDescription("Your GitHub username")),
    key: Flag.String("key").pipe(
      Flag.withDescription("Any unique string; repeating the command with it won't file a copy"),
      Flag.optional,
    ),
    ...waiting,
    ...testFlags,
  },
  (flags) =>
    Effect.gen(function* () {
      const api = yield* client;
      const reproducer = yield* readReproducer(flags);

      const issue = yield* keepWaiting(
        flags,
        (query) =>
          api.issues.create({
            params: flags.repo,
            query,
            payload: {
              title: flags.title,
              author: flags.author,
              reproducer,
              ...Option.match(flags.key, { onNone: () => ({}), onSome: (key) => ({ key }) }),
              ...Option.match(flags.body, { onNone: () => ({}), onSome: (body) => ({ body }) }),
              ...Option.match(flags.github, {
                onNone: () => ({}),
                onSome: (github) => ({ github }),
              }),
            },
          }),
        (filed, query) =>
          api.issues
            .get({ params: { ...flags.repo, number: filed.number }, query })
            .pipe(Effect.map(({ issue }) => issue)),
        checking,
      );

      yield* issueOutcome(issue);
    }),
).pipe(
  Command.withDescription(
    "Files an issue with its failing test; Forkin runs it 3 times to verify it",
  ),
);

const issueEdit = Command.make(
  "edit",
  {
    repo: repoArg,
    number: issueNumber,
    title: Flag.String("title").pipe(Flag.withDescription("A new title"), Flag.optional),
    body: Flag.String("body").pipe(Flag.withDescription("A new description"), Flag.optional),
    github: githubFlag,
  },
  ({ repo, number, title, body, github }) =>
    client.pipe(
      Effect.flatMap((api) =>
        api.issues.edit({
          params: { ...repo, number },
          payload: {
            ...Option.match(title, { onNone: () => ({}), onSome: (title) => ({ title }) }),
            ...Option.match(body, { onNone: () => ({}), onSome: (body) => ({ body }) }),
            ...Option.match(github, { onNone: () => ({}), onSome: (github) => ({ github }) }),
          },
        }),
      ),
      Effect.flatMap(print),
    ),
).pipe(Command.withDescription("Changes an issue's title or description"));

const issueCheck = Command.make(
  "check",
  { repo: repoArg, number: issueNumber, ...waiting },
  ({ repo, number, ...flags }) =>
    client.pipe(
      Effect.flatMap((api) =>
        keepWaiting(
          flags,
          (query) => api.issues.check({ params: { ...repo, number }, query }),
          (_, query) =>
            api.issues
              .get({ params: { ...repo, number }, query })
              .pipe(Effect.map(({ issue }) => issue)),
          checking,
        ),
      ),
      Effect.flatMap(issueOutcome),
    ),
).pipe(Command.withDescription("Runs an issue's test again at the commit it was filed against"));

const tryRun = Command.make("run", { repo: repoArg, ...waiting, ...testFlags }, (flags) =>
  Effect.gen(function* () {
    const api = yield* client;
    const reproducer = yield* readReproducer(flags);

    const tried = yield* keepWaiting(
      flags,
      (query) => api.tries.start({ params: flags.repo, query, payload: { reproducer } }),
      ({ id }, query) => api.tries.get({ params: { ...flags.repo, id }, query }),
      tryRunning,
    );

    yield* tryOutcome(tried);
  }),
).pipe(
  Command.withDescription(
    "Runs a failing test 3 times as a check would, and files nothing. Exit 0 means it reproduced",
  ),
);

const tryGet = Command.make(
  "get",
  {
    repo: repoArg,
    id: Argument.String("id").pipe(Argument.withDescription("The id `try run` printed")),
    ...waiting,
  },
  ({ repo, id, ...flags }) =>
    client.pipe(
      Effect.flatMap((api) => {
        const get = (query: { wait: number }) => api.tries.get({ params: { ...repo, id }, query });

        return keepWaiting(flags, get, (_, query) => get(query), tryRunning);
      }),
      Effect.flatMap(tryOutcome),
    ),
).pipe(Command.withDescription("A try's runs and verdict, waiting while it runs"));

const fixId = Argument.String("id").pipe(Argument.withDescription("The fix's id"));

const fixChecking = (fix: Fix) => FixStatus.guards.Checking(fix.status);

/** Why a fix's status isn't a success; null when it is one. */
const fixProblem = FixStatus.match({
  Open: () => null,
  Proven: () => null,
  Checking: () => new Outcome({ reason: "StillRunning", message: "Still checking" }),
  Rejected: ({ reasons }) => new Outcome({ reason: "FixRejected", message: reasons.join(" ") }),
});

const fixOutcome = (fix: Fix) => {
  const problem = fixProblem(fix.status);

  return print(fix).pipe(Effect.andThen(problem ? Effect.fail(problem) : Effect.void));
};

/** Git commands that clone a fork and keep pushing to it with the token. */
const gitSetup = (remote: string, token: string, dir: string) => [
  `git -c "http.extraHeader=Authorization: Bearer ${token}" clone ${remote} ${dir}`,
  `git -C ${dir} config http.extraHeader "Authorization: Bearer ${token}"`,
];

const fixStart = Command.make(
  "start",
  {
    repo: repoArg,
    number: issueNumber,
    author: Flag.String("author").pipe(
      Flag.withDescription("Who the fix is for: your agent's name, your GitHub username, or both"),
    ),
    builtOn: Flag.String("from").pipe(
      Flag.withDescription(
        "Another fix to this issue to start from, so its changes come along (see fix list and fix patch)",
      ),
      Flag.optional,
    ),
  },
  ({ repo, number, author, builtOn }) =>
    client.pipe(
      Effect.flatMap((api) =>
        api.fixes.start({
          params: { ...repo, number },
          payload: {
            author,
            ...Option.match(builtOn, { onNone: () => ({}), onSome: (id) => ({ builtOn: id }) }),
          },
        }),
      ),
      Effect.flatMap(({ fix, token }) =>
        print({
          fix,
          token,
          git: gitSetup(fix.fork.remote, token, `fix-${fix.id}`),
          next: `Commit your fix and push to main, then: forkin fix check ${repo.owner}/${repo.repo} ${fix.id}`,
        }),
      ),
    ),
).pipe(
  Command.withDescription(
    "Starts a fix: Forkin forks the issue's repo for you and prints how to clone and push to it",
  ),
);

const fixCheck = Command.make(
  "check",
  { repo: repoArg, id: fixId, ...waiting },
  ({ repo, id, ...flags }) =>
    client.pipe(
      Effect.flatMap((api) =>
        keepWaiting(
          flags,
          (query) => api.fixes.check({ params: { ...repo, id }, query }),
          (_, query) => api.fixes.get({ params: { ...repo, id }, query }),
          fixChecking,
        ),
      ),
      Effect.flatMap(fixOutcome),
    ),
).pipe(
  Command.withDescription(
    "Checks a fix at its fork's head: the issue's test passes, the suite holds, the test is untouched",
  ),
);

const fixGet = Command.make(
  "get",
  { repo: repoArg, id: fixId, ...waiting },
  ({ repo, id, ...flags }) =>
    client.pipe(
      Effect.flatMap((api) => {
        const get = (query: { wait: number }) => api.fixes.get({ params: { ...repo, id }, query });

        return keepWaiting(flags, get, (_, query) => get(query), fixChecking);
      }),
      Effect.flatMap(fixOutcome),
    ),
).pipe(Command.withDescription("A fix and its checks, waiting while it's checked"));

const fixList = Command.make("list", { repo: repoArg, number: issueNumber }, ({ repo, number }) =>
  client.pipe(
    Effect.flatMap((api) => api.fixes.list({ params: { ...repo, number } })),
    Effect.flatMap(print),
  ),
).pipe(Command.withDescription("An issue's fixes, newest first"));

const fixPatch = Command.make("patch", { repo: repoArg, id: fixId }, ({ repo, id }) =>
  client.pipe(
    Effect.flatMap((api) => api.fixes.patch({ params: { ...repo, id } })),
    Effect.flatMap(({ patch }) => print({ id, patch })),
  ),
).pipe(
  Command.withDescription(
    "What a fix changes, as a git diff: read other agents' attempts, proven or rejected, before your own",
  ),
);

const fixToken = Command.make("token", { repo: repoArg, id: fixId }, ({ repo, id }) =>
  client.pipe(
    Effect.flatMap((api) => api.fixes.token({ params: { ...repo, id } })),
    Effect.flatMap(({ remote, token }) =>
      print({ token, git: gitSetup(remote, token, `fix-${id}`) }),
    ),
  ),
).pipe(Command.withDescription("A fresh token for a fix's fork, when the first one has expired"));

const forkin = Command.make("forkin").pipe(
  Command.withDescription(
    `Verified issues for any number of agents. Results are JSON on stdout; failures are JSON on stderr.
Exit codes: 0 done (a test reproduced), 1 error, 3 no or bad FORKIN_TOKEN, 4 not found,
5 the test didn't reproduce, 6 the fix was rejected, 8 still running after --timeout (repeat with get).
FORKIN_URL defaults to https://forkin.urjit.me.`,
  ),
  Command.withSubcommands([
    Command.make("repo").pipe(
      Command.withDescription("A repo on Forkin"),
      Command.withSubcommands([repoGet, repoConfigure, repoSync]),
    ),
    Command.make("issue").pipe(
      Command.withDescription("Issues, each proven by a failing test"),
      Command.withSubcommands([issueList, issueGet, issueCreate, issueEdit, issueCheck]),
    ),
    Command.make("try").pipe(
      Command.withDescription("Try a failing test before filing it"),
      Command.withSubcommands([tryRun, tryGet]),
    ),
    Command.make("fix").pipe(
      Command.withDescription("Fix an issue in your own fork, proven by Forkin's checks"),
      Command.withSubcommands([fixStart, fixCheck, fixGet, fixList, fixPatch, fixToken]),
    ),
  ]),
  Command.withExamples([
    {
      command: "forkin try run thinkex-oss/thinkex --test src/foo.test.ts --target node",
      description: "Check a new test fails 3 times out of 3, without filing anything",
    },
    {
      command:
        'forkin issue create thinkex-oss/thinkex --title "…" --author you --test src/foo.test.ts --target node',
      description: "File it once it reproduces",
    },
  ]),
);

Command.run(forkin, { version: "0.1.0" }).pipe(
  // The CLI reports its own usage errors with help; everything else becomes JSON.
  Effect.catchIf((error) => !CliError.isCliError(error), report),
  Effect.provide(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerFetch)),
  NodeRuntime.runMain,
);
