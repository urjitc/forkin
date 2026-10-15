import { Context, Effect, Layer, Schema } from "effect";

// Forkin's git lives on Artifacts: a mirror of each repo, and a repo per issue holding its failing
// test as one commit, with the evidence as a git note. Repo names use `--` between parts, since
// GitHub owners can't contain it and Artifacts names can't contain `/`.

export class GitUnavailable extends Schema.TaggedError<GitUnavailable>()("GitUnavailable", {
  operation: Schema.String,
  message: Schema.String,
}) {}

/** Where a sandbox can push, with a short-lived write token for it. */
export type Remote = { name: string; remote: string; token: string };

export class Git extends Context.Service<
  Git,
  {
    /**
     * The repo's Artifacts mirror, imported from GitHub the first time. Artifacts can't pull from
     * GitHub later, so every snapshot build pushes the new commits to it.
     */
    mirror(repo: string): Effect.Effect<Remote, GitUnavailable>;
    /** The Artifacts repo for an issue's failing test, with a write token; created on the first check. */
    issueRepo(repo: string, issue: number): Effect.Effect<Remote, GitUnavailable>;
    /**
     * A fork for one fix, with a write token for its agent: of the issue's repo, or of another fix's
     * fork when it builds on that attempt.
     */
    forkIssue(
      repo: string,
      issue: number,
      fix: string,
      builtOn?: string,
    ): Effect.Effect<Remote, GitUnavailable>;
    /** A short-lived token for an existing repo. */
    token(name: string, scope: "read" | "write"): Effect.Effect<Remote, GitUnavailable>;
  }
>()("forkin/project/Git") {
  static readonly layer = (artifacts: Artifacts) => Layer.succeed(Git, Git.of(makeGit(artifacts)));
}

const repoName = (repo: string) => repo.replace("/", "--");

const issueRepoName = (repo: string, issue: number) => `${repoName(repo)}--issue-${issue}`;

const fixRepoName = (repo: string, issue: number, fix: string) =>
  `${issueRepoName(repo, issue)}--fix-${fix}`;

/** Outlives the slowest snapshot build, or agent's fix, the token is handed to. */
const tokenTtl = 2 * 60 * 60;

const makeGit = (artifacts: Artifacts): Git["Service"] => {
  const attempt = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new GitUnavailable({ operation, message: String(cause) }),
    });

  const exists = (name: string) =>
    attempt("get", () => artifacts.get(name)).pipe(
      Effect.map((repo) => {
        repo[Symbol.dispose]();

        return true;
      }),
      Effect.orElseSucceed(() => false),
    );

  /** The repo's remote with a fresh token. */
  const token = (name: string, scope: "read" | "write") =>
    Effect.acquireUseRelease(
      attempt("get", () => artifacts.get(name)),
      (repo) =>
        Effect.all({
          info: attempt("info", () => repo.info()),
          token: attempt("createToken", () => repo.createToken(scope, tokenTtl)),
        }),
      (repo) => Effect.sync(() => repo[Symbol.dispose]()),
    ).pipe(
      Effect.map(({ info, token }) => ({ name, remote: info.remote, token: token.plaintext })),
    );

  return {
    mirror: Effect.fn("Git.mirror")(function* (repo: string) {
      const name = repoName(repo);

      if (!(yield* exists(name))) {
        yield* attempt("import", () =>
          artifacts.import({
            source: { url: `https://github.com/${repo}.git` },
            target: { name, opts: { description: `Mirror of github.com/${repo}` } },
          }),
        );
      }

      return yield* token(name, "write");
    }),

    issueRepo: Effect.fn("Git.issueRepo")(function* (repo: string, issue: number) {
      const name = issueRepoName(repo, issue);

      // A re-check force-pushes its newer evidence over the old. Deleting and creating the repo
      // again fails: Artifacts still reports the name as taken just after a delete.
      if (yield* exists(name)) return yield* token(name, "write");

      const { remote, token: write } = yield* attempt("create", () =>
        artifacts.create(name, {
          setDefaultBranch: "main",
          description: `${repo} issue #${issue}`,
        }),
      );

      return { name, remote, token: write };
    }),

    forkIssue: Effect.fn("Git.forkIssue")(function* (
      repo: string,
      issue: number,
      fix: string,
      builtOn?: string,
    ) {
      const name = fixRepoName(repo, issue, fix);
      const source = builtOn ? fixRepoName(repo, issue, builtOn) : issueRepoName(repo, issue);

      yield* Effect.acquireUseRelease(
        attempt("get", () => artifacts.get(source)),
        (source) =>
          attempt("fork", () =>
            source.fork(name, { description: `Fix ${fix} for ${repo} issue #${issue}` }),
          ),
        (source) => Effect.sync(() => source[Symbol.dispose]()),
      );

      return yield* token(name, "write");
    }),

    token: (name, scope) => token(name, scope),
  };
};
