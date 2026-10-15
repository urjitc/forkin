import handler from "@tanstack/react-start/server-entry";
import { routeAgentRequest } from "agents";
import { handleApi } from "#/api/server";
import { handleGitHubWebhook } from "#/github/webhook";
import { handleMcp } from "#/mcp/server";

export { BenchBox } from "#/bench/bench-box";

export { Project } from "#/project/project";

/** The MCP server takes the same token as the API until GitHub login exists. */
const authorized = (request: Request, env: Env) =>
  Boolean(env.API_TOKEN) && request.headers.get("authorization") === `Bearer ${env.API_TOKEN}`;

// /api goes to the API, /mcp to the MCP server, /github/webhook to the GitHub App's events, live
// dashboard connections to the Projects; everything else is the app.
export default {
  async fetch(request, env, ctx) {
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
