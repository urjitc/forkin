import { createServerFn } from "@tanstack/react-start";
import { getAgentByName } from "agents";
import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { ActivityEvent, Environment, Fix, Issue, ProjectState, projectName } from "#/domain";
import { preloadPatchFiles } from "./files";

// Server functions the dashboard loads from; after the first load it stays live over a WebSocket.

const RepoRef = Schema.toStandardSchemaV1(
  Schema.Struct({ owner: Schema.String, repo: Schema.String }),
);

const IssueRef = Schema.toStandardSchemaV1(
  Schema.Struct({ owner: Schema.String, repo: Schema.String, number: Schema.Int }),
);

// RPC results arrive as disposable stubs; re-encoding yields plain, serializable data.
const plainState = Schema.encodeSync(ProjectState);
const plainIssue = Schema.encodeSync(Schema.NullOr(Issue));
const plainActivity = Schema.encodeSync(Schema.Array(ActivityEvent));
const plainFixes = Schema.encodeSync(Schema.Array(Fix));
const plainEnvironment = Schema.encodeSync(Schema.NullOr(Environment));

const project = (owner: string, repo: string) =>
  getAgentByName(env.Project, projectName(owner, repo));

export const loadProject = createServerFn({ method: "GET" })
  .validator(RepoRef)
  .handler(async ({ data }) => plainState(await (await project(data.owner, data.repo)).snapshot()));

/** The repo's forkin.json, its snapshot, and its recent activity, for the Environment tab. */
export const loadEnvironment = createServerFn({ method: "GET" })
  .validator(RepoRef)
  .handler(async ({ data }) => {
    const stub = await project(data.owner, data.repo);

    return {
      environment: plainEnvironment(await stub.environment()),
      activity: plainActivity(await stub.issueActivity(null)),
    };
  });

export const loadIssue = createServerFn({ method: "GET" })
  .validator(IssueRef)
  .handler(async ({ data }) => {
    const stub = await project(data.owner, data.repo);
    const issue = plainIssue(await stub.getIssue(data.number));
    const activity = plainActivity(await stub.issueActivity(data.number));
    const fixes = plainFixes(await stub.fixesOf(data.number));

    // Pierre renders on the server; the page hydrates the same components from this HTML.
    const files = await preloadPatchFiles(`issue-${data.number}`, issue?.diff ?? "");

    return { issue, activity, fixes, files };
  });

const FixRef = Schema.toStandardSchemaV1(
  Schema.Struct({
    owner: Schema.String,
    repo: Schema.String,
    number: Schema.Int,
    id: Schema.String,
  }),
);

const plainFix = Schema.encodeSync(Schema.NullOr(Fix));

/** One fix: where it stands, its issue's title, and the files it changed. */
export const loadFix = createServerFn({ method: "GET" })
  .validator(FixRef)
  .handler(async ({ data }) => {
    const stub = await project(data.owner, data.repo);
    const fix = plainFix(await stub.getFix(data.id));
    const issue = plainIssue(await stub.getIssue(data.number));
    const patch = fix && (await stub.fixPatch(data.id));

    return {
      fix,
      issueTitle: issue?.title ?? "",
      files: await preloadPatchFiles(`fix-${data.id}`, patch ?? ""),
    };
  });
