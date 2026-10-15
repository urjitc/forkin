import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { getAgentByName } from "agents";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { projectName } from "#/domain";
import { maxWaitSeconds } from "#/project/project";

// Forkin's MCP server: the same operations as the HTTP API, as tools for agents without a shell.
// Stateless; every call goes to the repo's Project, which holds all state. Calls that run tests
// wait up to 50 s, under the 60 s many MCP clients allow, and say how to pick the work up again.

const instructions = `Forkin verifies bug reports with failing tests, so maintainers get issues that are proven, not claimed.

To report a bug: write a test that fails because of it, at a commit of the repo. Run it with try_test first: Forkin runs it 3 times in a sandbox and files nothing. Only when the verdict is Reproduced (it failed all 3 runs), file it with file_issue, which runs the same check in public.

To fix an issue: list_fixes shows every attempt so far and why rejected ones failed; get_fix_patch shows what any attempt changed, so learn from them first. start_fix gives you a fork of the issue's repo to push to, or of another attempt's fork with builtOn to continue its work; push your fix, then check_fix runs the issue's test, the suite, and makes sure the test wasn't edited. Only proven fixes reach the maintainers.

Repos are "owner/repo" on GitHub. A test belongs to a target from the repo's forkin.json (for example "node"); its path is from the repo root. Calls that run tests wait up to ${maxWaitSeconds} s; if the work is still running, call get_try or get_issue later.`;

/** A tool's input, validated by Effect Schema and described to clients as JSON Schema. */
const input = <S extends Schema.ConstraintDecoder<unknown> & Schema.Constraint>(schema: S) =>
  Schema.toStandardJSONSchemaV1(Schema.toStandardSchemaV1(schema));

const Repo = Schema.String.check(Schema.isPattern(/^[^/\s]+\/[^/\s]+$/)).annotate({
  description: 'The repository on GitHub, as "owner/repo"',
});

/** A failing test: where it lives, what it says, and where it should fail. */
const Reproducer = {
  path: Schema.String.annotate({ description: "The test file's path from the repo root" }),
  source: Schema.String.annotate({ description: "The test file's full contents" }),
  target: Schema.String.annotate({
    description: 'The target in the repo\'s forkin.json that runs it, like "node"',
  }),
  commit: Schema.String.annotate({ description: "The commit the test should fail on" }),
};

const Test = { repo: Repo, ...Reproducer };

const projectOf = (repo: string) => {
  const [owner = "", name = ""] = repo.split("/");

  return getAgentByName(env.Project, projectName(owner, name));
};

const json = <A>(value: A): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

const notFound = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

const createServer = () => {
  const server = new McpServer({ name: "forkin", version: "0.1.0" }, { instructions });

  server.registerTool(
    "list_issues",
    {
      description: "The repo's issues on Forkin, each with its verdict.",
      inputSchema: input(Schema.Struct({ repo: Repo })),
      annotations: { readOnlyHint: true },
    },
    async ({ repo }) => json((await (await projectOf(repo)).snapshot()).issues),
  );

  server.registerTool(
    "get_issue",
    {
      description:
        "One issue: its failing test, every run, its verdict, its Artifacts repo, and what happened to it. Waits while it's being checked.",
      inputSchema: input(Schema.Struct({ repo: Repo, number: Schema.Int })),
      annotations: { readOnlyHint: true },
    },
    async ({ repo, number }) => {
      const project = await projectOf(repo);
      const issue = await project.getIssue(number, maxWaitSeconds);

      if (!issue) return notFound(`Issue #${number} doesn't exist in ${repo}.`);

      return json({ issue, activity: await project.issueActivity(number) });
    },
  );

  server.registerTool(
    "try_test",
    {
      description:
        "Runs a failing test 3 times in a sandbox, as filing would, and files nothing. Use it before file_issue: Reproduced means the test failed every run.",
      inputSchema: input(Schema.Struct(Test)),
      annotations: { readOnlyHint: true },
    },
    async ({ repo, ...reproducer }) =>
      json(await (await projectOf(repo)).startTry(reproducer, maxWaitSeconds)),
  );

  server.registerTool(
    "get_try",
    {
      description: "A try started by try_test, waiting while it runs.",
      inputSchema: input(Schema.Struct({ repo: Repo, id: Schema.String })),
      annotations: { readOnlyHint: true },
    },
    async ({ repo, id }) => {
      const tried = await (await projectOf(repo)).getTry(id, maxWaitSeconds);

      return tried ? json(tried) : notFound(`Try ${id} doesn't exist in ${repo}.`);
    },
  );

  server.registerTool(
    "file_issue",
    {
      description:
        "Files a public issue with its failing test; Forkin checks it with 3 runs and shows the verdict to the maintainers. Try the test with try_test first.",
      inputSchema: input(
        Schema.Struct({
          repo: Repo,
          title: Schema.String.annotate({ description: "What's wrong, in one line" }),
          body: Schema.optionalKey(Schema.String).annotate({
            description: "What's wrong and how it shows, in your words; Markdown is fine",
          }),
          author: Schema.String.annotate({ description: "Your GitHub username" }),
          key: Schema.optionalKey(Schema.String).annotate({
            description: "Any unique string; filing again with it returns the first issue",
          }),
          reproducer: Schema.Struct(Reproducer).annotate({ description: "The failing test" }),
        }),
      ),
      annotations: { idempotentHint: true },
    },
    async ({ repo, ...issue }) =>
      json(await (await projectOf(repo)).fileIssue(issue, maxWaitSeconds)),
  );

  server.registerTool(
    "check_issue",
    {
      description:
        "Runs an issue's test 3 times again at the commit it was filed against. Whether main fixed it is checked on every push to main.",
      inputSchema: input(Schema.Struct({ repo: Repo, number: Schema.Int })),
    },
    async ({ repo, number }) => {
      const issue = await (await projectOf(repo)).recheck(number, maxWaitSeconds);

      return issue ? json(issue) : notFound(`Issue #${number} doesn't exist in ${repo}.`);
    },
  );

  server.registerTool(
    "start_fix",
    {
      description:
        "Starts a fix to an issue: Forkin forks the issue's repo (its code plus the failing test) and returns the fork's git remote with a token, valid 2 hours, to clone and push with. Push your fix to main, then call check_fix.",
      inputSchema: input(
        Schema.Struct({
          repo: Repo,
          number: Schema.Int,
          author: Schema.String.annotate({
            description: "Who the fix is for: your agent's name, your GitHub username, or both",
          }),
          builtOn: Schema.optionalKey(Schema.String).annotate({
            description:
              "Another fix to this issue to start from, so its changes come along; see list_fixes and get_fix_patch",
          }),
        }),
      ),
    },
    async ({ repo, number, author, builtOn }) => {
      const { started, refused } = await (await projectOf(repo)).startFix(number, author, builtOn);

      if (!started) return notFound(refused ?? "The fix couldn't start.");

      return json({
        ...started,
        git: [
          `git -c "http.extraHeader=Authorization: Bearer ${started.token}" clone ${started.fix.fork.remote} fix-${started.fix.id}`,
          `git -C fix-${started.fix.id} config http.extraHeader "Authorization: Bearer ${started.token}"`,
        ],
      });
    },
  );

  server.registerTool(
    "check_fix",
    {
      description:
        "Checks a fix at its fork's head: the issue's original test must pass all 3 runs, the suite must keep every test that passed before, and the test must be untouched. Proven fixes go to the maintainers.",
      inputSchema: input(Schema.Struct({ repo: Repo, id: Schema.String })),
    },
    async ({ repo, id }) => {
      const fix = await (await projectOf(repo)).checkFix(id, maxWaitSeconds);

      return fix ? json(fix) : notFound(`Fix ${id} doesn't exist in ${repo}.`);
    },
  );

  server.registerTool(
    "get_fix",
    {
      description: "A fix and its checks, waiting while it's being checked.",
      inputSchema: input(Schema.Struct({ repo: Repo, id: Schema.String })),
      annotations: { readOnlyHint: true },
    },
    async ({ repo, id }) => {
      const fix = await (await projectOf(repo)).getFix(id, maxWaitSeconds);

      return fix ? json(fix) : notFound(`Fix ${id} doesn't exist in ${repo}.`);
    },
  );

  server.registerTool(
    "get_fix_patch",
    {
      description:
        "What a fix changes, as a git diff. Read other agents' attempts, proven or rejected (with list_fixes for why), before starting your own or building on one with start_fix's builtOn.",
      inputSchema: input(Schema.Struct({ repo: Repo, id: Schema.String })),
      annotations: { readOnlyHint: true },
    },
    async ({ repo, id }) => {
      const project = await projectOf(repo);

      if (!(await project.getFix(id))) return notFound(`Fix ${id} doesn't exist in ${repo}.`);

      const patch = await project.fixPatch(id);

      return {
        content: [{ type: "text", text: patch || "Nothing yet: the fix hasn't been checked." }],
      };
    },
  );

  server.registerTool(
    "list_fixes",
    {
      description: "An issue's fixes, newest first, with where each stands.",
      inputSchema: input(Schema.Struct({ repo: Repo, number: Schema.Int })),
      annotations: { readOnlyHint: true },
    },
    async ({ repo, number }) => json(await (await projectOf(repo)).fixesOf(number)),
  );

  return server;
};

/** Serves the MCP server at /mcp. */
export const handleMcp = createMcpHandler(createServer, {
  route: "/mcp",
  allowedHostnames: ["forkin.urjit.me"],
});
