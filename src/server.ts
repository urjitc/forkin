import handler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";
import { handleApi } from "#/api/server";
import { handleGitHubWebhook } from "#/github/webhook";
import { handleMcp } from "#/mcp/server";
import { Option, Schema } from "effect";

export { BenchBox } from "#/bench/bench-box";

export { Project } from "#/project/project";

/** The MCP server takes the same token as the API until GitHub login exists. */
const authorized = (request: Request, env: Env) =>
  Boolean(env.API_TOKEN) && request.headers.get("authorization") === `Bearer ${env.API_TOKEN}`;

/** A token anyone may use to try Forkin on ThinkEx; published in the README for judges. */
const demoToken = "forkin-demo";
const demoRepo = "thinkex-oss/thinkex";

/** The part of an MCP message that names a repo: a tool call's `repo` argument. */
const McpMessage = Schema.Struct({
  params: Schema.optional(
    Schema.Struct({
      arguments: Schema.optional(Schema.Struct({ repo: Schema.optional(Schema.String) })),
    }),
  ),
});

const decodeMcpBody = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Union([McpMessage, Schema.Array(McpMessage)])),
);

/** Whether every MCP tool call in a request body names only the demo repo. */
const mcpOnDemoRepo = (body: string) =>
  body === "" ||
  Option.match(decodeMcpBody(body), {
    onNone: () => false,
    onSome: (decoded) =>
      (Array.isArray(decoded) ? decoded : [decoded]).every(({ params }) => {
        const repo = params?.arguments?.repo;

        return repo === undefined || repo.toLowerCase() === demoRepo;
      }),
  });

/**
 * Lets the demo token through as the real one, but only to ThinkEx and not to the endpoints that
 * change a repo's setup. Other requests pass unchanged; null means the demo token isn't allowed.
 */
const throughDemo = async (request: Request, env: Env) => {
  if (request.headers.get("authorization") !== `Bearer ${demoToken}`) return request;

  const { pathname } = new URL(request.url);

  const allowed =
    pathname === "/mcp"
      ? mcpOnDemoRepo(await request.clone().text())
      : pathname.toLowerCase().startsWith(`/api/${demoRepo}/`) &&
        !/\/(config|sync|restart|reset)$/.test(pathname);

  if (!allowed) return null;

  const headers = new Headers(request.headers);

  headers.set("authorization", `Bearer ${env.API_TOKEN}`);

  return new Request(request, { headers });
};

// /api goes to the API, /mcp to the MCP server, /github/webhook to the GitHub App's events, live
// dashboard connections to the Projects; everything else is the app.
export default {
  async fetch(incoming, env, ctx) {
    const request = await throughDemo(incoming, env);

    if (!request) {
      return Response.json(
        { error: "The demo token works only on thinkex-oss/thinkex, and can't change its setup." },
        { status: 403 },
      );
    }

    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/")) return handleApi(request);

    if (pathname === "/github/webhook" && request.method === "POST") {
      return handleGitHubWebhook(request, env);
    }

    if (pathname === "/mcp") {
      return authorized(request, env)
        ? handleMcp(request, env, ctx)
        : Response.json(
            { error: "Pass a valid Forkin token as a Bearer token." },
            { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
          );
    }

    return (await routeAgentRequest(request, env)) ?? handler.fetch(request);
  },
} satisfies ExportedHandler<Env>;
