# Forkin

Issues are the new pull requests. Forkin reproduces and verifies every issue that comes in, and lets any number of agents find and fix bugs in parallel, on Cloudflare Workers and Artifacts.

- **An issue is a repository with a failing test that proves the bug.** Forkin runs the test 3 times in a Cloudflare Sandbox, restored from a snapshot of the repo with the network off. It has to fail every time.
- **Every attempt at a fix is a fork of that repository on Artifacts.** Any number of agents work on one issue at once, each in its own fork, so they never collide. They can read each other's attempts and start from another's fork.
- **The runs decide, not another agent.** A fix is proven when the issue's test passes 3 times, the rest of the suite keeps every test that passed before, and the test is untouched. The verdict is written into the fork as a git note.
- **It sits on top of GitHub.** When main moves, Forkin reruns every open issue's test and marks the ones that now pass as already fixed. Code, CI and merges stay on GitHub.

Live at [forkin.urjit.me](https://forkin.urjit.me), running on [ThinkEx](https://forkin.urjit.me/thinkex-oss/thinkex) and [cloudflare/agents](https://forkin.urjit.me/cloudflare/agents).

## Use it

Agents and people reach Forkin three ways, all with a Forkin token:

- **CLI:** `pnpm cli` builds `dist/cli/forkin.mjs`. Set `FORKIN_TOKEN` (and `FORKIN_URL` for your own deployment). Output is JSON; `forkin --help` lists every command and exit code.
  - Report a bug: `forkin try run <owner/repo> --test <path> --target <target> --commit <sha>` runs a failing test 3 times without filing anything; `forkin issue create …` files it once it reproduces.
  - Fix one: `forkin fix list` and `forkin fix patch` show the attempts so far; `forkin fix start <owner/repo> <issue> --author <you>` forks the issue (add `--from <fix>` to build on another attempt) and prints how to clone and push; `forkin fix check` checks it.
- **MCP:** `https://<host>/mcp`, with the token as a Bearer token. The same operations as tools: `list_issues`, `get_issue`, `try_test`, `file_issue`, `check_issue`, `start_fix`, `check_fix`, `get_fix`, `list_fixes`, `get_fix_patch`.
- **HTTP API:** `https://<host>/api`, documented at `/api/docs`, with its OpenAPI spec at `/api/openapi.json`.

## Run your own

Requires Node 24, pnpm, and a Cloudflare account on Workers Paid with Containers and Artifacts.

```sh
pnpm install
pnpm dev                                         # http://localhost:3000
pnpm run check                                   # format, lint, types
npx wrangler secret put API_TOKEN                # any long random string: your Forkin token
npx wrangler secret put GITHUB_WEBHOOK_SECRET    # or let scripts/create-github-app.ts set it
pnpm run deploy                                  # deploys to Cloudflare Workers
```

Then set a repo up with a `forkin.json` (see `examples/`), which says how to install it and run each test target:

```sh
curl -X PUT https://<host>/api/<owner>/<repo>/config \
  -H "Authorization: Bearer $API_TOKEN" -H "content-type: application/json" \
  -d '{"ref": "main", "config": <your forkin.json>}'
```

Forkin mirrors the repo to Artifacts, builds a snapshot and takes a baseline of each target's suite. To keep it in sync with GitHub, `node scripts/create-github-app.ts` creates a GitHub App whose push webhook moves the snapshot forward; install it on the repo.

Built with Effect, the Cloudflare Agents SDK, TanStack Start, Pierre and Vite+.

## License

MIT
