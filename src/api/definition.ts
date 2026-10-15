import { Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
} from "effect/http-api";
import {
  ActivityEvent,
  Fix,
  ForkinConfig,
  Issue,
  IssueSummary,
  NewIssue,
  ProjectState,
  Reproducer,
  StartedFix,
  Try,
} from "#/domain";

// Forkin's HTTP API: the one definition the Worker serves, the CLI calls through a derived client,
// and the MCP tools mirror. Plain data in and out; long work returns at once and is waited on with
// `wait`, so no call has to stay open longer than an MCP client allows.

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** The request is understood but can't be done now; `message` says why and what to do. */
export class Refused extends Schema.TaggedError<Refused>()(
  "Refused",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

/** Checks the caller's token: an API token for now, the caller's GitHub login later. */
export class Authorization extends HttpApiMiddleware.Service<Authorization>()("Authorization", {
  error: Unauthorized,
  security: { token: HttpApiSecurity.bearer },
}) {}

const repo = { owner: Schema.String, repo: Schema.String };

/** Seconds to wait for the work to finish before answering with where it stands; at most 50. */
const wait = { wait: Schema.optionalKey(Schema.Int) };

export const IssueDetail = Schema.Struct({
  issue: Issue,
  /** What happened to the issue, newest first: runs, verdicts, and errors with their causes. */
  activity: Schema.Array(ActivityEvent),
});

const repos = HttpApiGroup.make("repos").add(
  HttpApiEndpoint.get("get", "/:owner/:repo", {
    params: repo,
    success: ProjectState,
    error: NotFound,
  }),
  HttpApiEndpoint.put("configure", "/:owner/:repo/config", {
    params: repo,
    payload: Schema.Struct({
      /** A commit, or a branch to build its tip. */
      ref: Schema.String,
      config: ForkinConfig,
    }),
  }),
  HttpApiEndpoint.post("sync", "/:owner/:repo/sync", {
    params: repo,
    payload: Schema.Struct({
      /** The default branch's new commit, or the branch itself for its tip on GitHub. */
      ref: Schema.String,
    }),
    error: NotFound,
  }),
  HttpApiEndpoint.post("restart", "/:owner/:repo/restart", { params: repo }),
  /** Deletes everything Forkin holds for the repo: issues, fixes, runs and its environment. */
  HttpApiEndpoint.post("reset", "/:owner/:repo/reset", { params: repo }),
);

const issues = HttpApiGroup.make("issues").add(
  HttpApiEndpoint.get("list", "/:owner/:repo/issues", {
    params: repo,
    success: Schema.Array(IssueSummary),
  }),
  HttpApiEndpoint.get("get", "/:owner/:repo/issues/:number", {
    params: { ...repo, number: Schema.Int },
    query: wait,
    success: IssueDetail,
    error: NotFound,
  }),
  HttpApiEndpoint.post("create", "/:owner/:repo/issues", {
    params: repo,
    query: wait,
    payload: NewIssue,
    success: Issue,
  }),
  HttpApiEndpoint.patch("edit", "/:owner/:repo/issues/:number", {
    params: { ...repo, number: Schema.Int },
    payload: Schema.Struct({
      title: Schema.optionalKey(Schema.String),
      body: Schema.optionalKey(Schema.String),
      github: Schema.optionalKey(Schema.Int),
    }),
    success: Issue,
    error: NotFound,
  }),
  HttpApiEndpoint.post("check", "/:owner/:repo/issues/:number/check", {
    params: { ...repo, number: Schema.Int },
    query: wait,
    success: Issue,
    error: NotFound,
  }),
);

const tries = HttpApiGroup.make("tries").add(
  HttpApiEndpoint.post("start", "/:owner/:repo/tries", {
    params: repo,
    query: wait,
    payload: Schema.Struct({ reproducer: Reproducer }),
    success: Try,
  }),
  HttpApiEndpoint.get("get", "/:owner/:repo/tries/:id", {
    params: { ...repo, id: Schema.String },
    query: wait,
    success: Try,
    error: NotFound,
  }),
);

const fixes = HttpApiGroup.make("fixes").add(
  HttpApiEndpoint.post("start", "/:owner/:repo/issues/:number/fixes", {
    params: { ...repo, number: Schema.Int },
    payload: Schema.Struct({
      /** Who the attempt is for: an agent's name, a person, or both. */
      author: Schema.String,
      /** Another fix to this issue to start from, so its changes come along. */
      builtOn: Schema.optionalKey(Schema.String),
    }),
    success: StartedFix,
    error: Refused,
  }),
  HttpApiEndpoint.get("list", "/:owner/:repo/issues/:number/fixes", {
    params: { ...repo, number: Schema.Int },
    success: Schema.Array(Fix),
  }),
  HttpApiEndpoint.get("get", "/:owner/:repo/fixes/:id", {
    params: { ...repo, id: Schema.String },
    query: wait,
    success: Fix,
    error: NotFound,
  }),
  HttpApiEndpoint.post("check", "/:owner/:repo/fixes/:id/check", {
    params: { ...repo, id: Schema.String },
    query: wait,
    success: Fix,
    error: NotFound,
  }),
  HttpApiEndpoint.get("patch", "/:owner/:repo/fixes/:id/patch", {
    params: { ...repo, id: Schema.String },
    success: Schema.Struct({
      /** What the fix changes from the issue's commit, as a git diff; empty before its first check. */
      patch: Schema.String,
    }),
    error: NotFound,
  }),
  HttpApiEndpoint.post("token", "/:owner/:repo/fixes/:id/token", {
    params: { ...repo, id: Schema.String },
    success: Schema.Struct({ remote: Schema.String, token: Schema.String }),
    error: NotFound,
  }),
);

export const ForkinApi = HttpApi.make("forkin")
  .add(repos)
  .add(issues)
  .add(tries)
  .add(fixes)
  .middleware(Authorization)
  .prefix("/api");
