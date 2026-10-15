// Creates Forkin's GitHub App with GitHub's manifest flow and stores its credentials as Worker
// secrets, without printing them. Run `node scripts/create-github-app.ts`, open the printed URL,
// press Create on GitHub, then install the App on the repos Forkin should watch.
//
// Options: FORKIN_URL (default https://forkin.urjit.me) and APP_NAME (default Forkin).

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";

const forkinUrl = process.env.FORKIN_URL ?? "https://forkin.urjit.me";
const appName = process.env.APP_NAME ?? "Forkin";
const port = 3999;
const state = randomBytes(16).toString("hex");

// What the App may do: read code and receive pushes now; label and comment on issues and open pull
// requests for approved fixes later.
const manifest = {
  name: appName,
  url: forkinUrl,
  description:
    "Verified issues: every bug arrives with a failing test, proven before anyone reviews it.",
  hook_attributes: { url: `${forkinUrl}/github/webhook` },
  redirect_url: `http://localhost:${port}/created`,
  public: true,
  default_permissions: {
    contents: "write",
    issues: "write",
    pull_requests: "write",
    metadata: "read",
  },
  default_events: ["push", "issues", "issue_comment"],
};

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

const page = (body: string) =>
  `<!doctype html><meta charset="utf-8"><title>Forkin GitHub App</title><body style="font:16px system-ui;max-width:40rem;margin:4rem auto">${body}</body>`;

/** Stores one Worker secret by piping it to wrangler, so it never reaches the terminal. */
const putSecret = (name: string, value: string) => {
  const result = spawnSync("pnpm", ["exec", "wrangler", "secret", "put", name], {
    input: value,
    stdio: ["pipe", "ignore", "inherit"],
  });

  if (result.status !== 0) throw new Error(`wrangler secret put ${name} failed`);
};

type Conversion = {
  id: number;
  slug: string;
  html_url: string;
  pem: string;
  webhook_secret: string;
  client_id: string;
  client_secret: string;
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://localhost:${port}`);

  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html" }).end(
      page(`<p>Creating the <b>${escape(appName)}</b> GitHub App for ${escape(forkinUrl)}…</p>
<form id="create" method="post" action="https://github.com/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}">
<button>Continue to GitHub</button></form>
<script>document.getElementById("create").submit()</script>`),
    );

    return;
  }

  if (url.pathname !== "/created" || url.searchParams.get("state") !== state) {
    response.writeHead(404).end();

    return;
  }

  try {
    const conversion = await fetch(
      `https://api.github.com/app-manifests/${url.searchParams.get("code")}/conversions`,
      { method: "POST", headers: { accept: "application/vnd.github+json" } },
    );

    if (!conversion.ok) throw new Error(`GitHub answered ${conversion.status}`);

    const app: Conversion = await conversion.json();

    putSecret("GITHUB_APP_ID", String(app.id));
    putSecret("GITHUB_PRIVATE_KEY", app.pem);
    putSecret("GITHUB_WEBHOOK_SECRET", app.webhook_secret);
    putSecret("GITHUB_CLIENT_ID", app.client_id);
    putSecret("GITHUB_CLIENT_SECRET", app.client_secret);

    const install = `${app.html_url}/installations/new`;

    response.writeHead(200, { "content-type": "text/html" }).end(
      page(`<p>Created <b>${escape(app.slug)}</b> and stored its credentials as Worker secrets.</p>
<p><a href="${install}">Install it on your repos</a> to finish.</p>`),
    );
    console.log(`Created ${app.slug}. Install it: ${install}`);
  } catch (error) {
    response
      .writeHead(500, { "content-type": "text/html" })
      .end(page(`<p>Failed: ${escape(String(error))}</p>`));
    console.error(error);
  }

  server.close();
});

server.listen(port, () => console.log(`Open http://localhost:${port} to create the GitHub App`));
