import { getAgentByName } from "agents";
import { env } from "cloudflare:workers";
import { Effect, Layer, Redacted } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import { projectName } from "#/domain";
import { maxWaitSeconds } from "#/project/project";
import { Authorization, ForkinApi, NotFound, Refused, Unauthorized } from "./definition";

/** The repo's Project, the Durable Object that owns all of its work. */
const project = ({ owner, repo }: { owner: string; repo: string }) =>
  Effect.promise(() => getAgentByName(env.Project, projectName(owner, repo)));

const waitSeconds = (query: { wait?: number }) => Math.min(query.wait ?? 0, maxWaitSeconds);

/** Turns a Project's "no such thing" (null) into the API's NotFound. */
const found = <A>(what: string, value: A | null) =>
  value === null
    ? Effect.fail(new NotFound({ message: `${what} doesn't exist.` }))
    : Effect.succeed(value);

const AuthorizationLive = Layer.succeed(Authorization, {
  token: (effect, { credential }) =>
    env.API_TOKEN && Redacted.value(credential) === env.API_TOKEN
      ? effect
      : Effect.fail(new Unauthorized({ message: "Pass a valid Forkin token as a Bearer token." })),
});

const ReposLive = HttpApiBuilder.group(ForkinApi, "repos", (handlers) =>
  handlers
    .handle("get", ({ params }) =>
      project(params).pipe(Effect.flatMap((p) => Effect.promise(() => p.snapshot()))),
    )
    .handle("configure", ({ params, payload }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.configure(payload.config, payload.ref))),
      ),
    )
    .handle("sync", ({ params, payload }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.sync(payload.ref))),
        Effect.flatMap((configured) =>
          configured
            ? Effect.void
            : Effect.fail(
                new NotFound({ message: `${params.owner}/${params.repo} isn't set up on Forkin.` }),
              ),
        ),
      ),
    )
    .handle("restart", ({ params }) =>
      project(params).pipe(
        // Aborting the Durable Object also fails this call; the restart has happened either way.
        Effect.flatMap((p) => Effect.promise(() => p.restart().catch(() => undefined))),
      ),
    )
    .handle("reset", ({ params }) =>
      project(params).pipe(
        // Destroying aborts the Durable Object, which fails this call once the storage is gone.
        Effect.flatMap((p) => Effect.promise(() => p.reset().catch(() => undefined))),
      ),
    ),
);

const IssuesLive = HttpApiBuilder.group(ForkinApi, "issues", (handlers) =>
  handlers
    .handle("list", ({ params }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.snapshot())),
        Effect.map(({ issues }) => issues),
      ),
    )
    .handle("get", ({ params, query }) =>
      Effect.gen(function* () {
        const p = yield* project(params);
        const issue = yield* Effect.promise(() => p.getIssue(params.number, waitSeconds(query)));
        const activity = yield* Effect.promise(() => p.issueActivity(params.number));

        return { issue: yield* found(`Issue #${params.number}`, issue), activity };
      }),
    )
    .handle("create", ({ params, query, payload }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.fileIssue(payload, waitSeconds(query)))),
      ),
    )
    .handle("edit", ({ params, payload }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.editIssue(params.number, payload))),
        Effect.flatMap((issue) => found(`Issue #${params.number}`, issue)),
      ),
    )
    .handle("check", ({ params, query }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.recheck(params.number, waitSeconds(query)))),
        Effect.flatMap((issue) => found(`Issue #${params.number}`, issue)),
      ),
    ),
);

const TriesLive = HttpApiBuilder.group(ForkinApi, "tries", (handlers) =>
  handlers
    .handle("start", ({ params, query, payload }) =>
      project(params).pipe(
        Effect.flatMap((p) =>
          Effect.promise(() => p.startTry(payload.reproducer, waitSeconds(query))),
        ),
      ),
    )
    .handle("get", ({ params, query }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.getTry(params.id, waitSeconds(query)))),
        Effect.flatMap((tried) => found(`Try ${params.id}`, tried)),
      ),
    ),
);

const FixesLive = HttpApiBuilder.group(ForkinApi, "fixes", (handlers) =>
  handlers
    .handle("start", ({ params, payload }) =>
      project(params).pipe(
        Effect.flatMap((p) =>
          Effect.promise(() => p.startFix(params.number, payload.author, payload.builtOn)),
        ),
        Effect.flatMap(({ started, refused }) =>
          started
            ? Effect.succeed(started)
            : Effect.fail(new Refused({ message: refused ?? "The fix couldn't start." })),
        ),
      ),
    )
    .handle("list", ({ params }) =>
      project(params).pipe(Effect.flatMap((p) => Effect.promise(() => p.fixesOf(params.number)))),
    )
    .handle("get", ({ params, query }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.getFix(params.id, waitSeconds(query)))),
        Effect.flatMap((fix) => found(`Fix ${params.id}`, fix)),
      ),
    )
    .handle("check", ({ params, query }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.checkFix(params.id, waitSeconds(query)))),
        Effect.flatMap((fix) => found(`Fix ${params.id}`, fix)),
      ),
    )
    .handle("patch", ({ params }) =>
      project(params).pipe(
        Effect.flatMap((p) =>
          Effect.promise(async () =>
            (await p.getFix(params.id)) ? ((await p.fixPatch(params.id)) ?? "") : null,
          ),
        ),
        Effect.flatMap((patch) =>
          patch === null
            ? Effect.fail(new NotFound({ message: `Fix ${params.id} doesn't exist.` }))
            : Effect.succeed({ patch }),
        ),
      ),
    )
    .handle("token", ({ params }) =>
      project(params).pipe(
        Effect.flatMap((p) => Effect.promise(() => p.fixToken(params.id))),
        Effect.flatMap((token) => found(`Fix ${params.id}`, token)),
      ),
    ),
);

const ApiLive = HttpApiBuilder.layer(ForkinApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide([ReposLive, IssuesLive, TriesLive, FixesLive]),
  Layer.provide(AuthorizationLive),
  Layer.provide(HttpApiScalar.layerCdn(ForkinApi, { path: "/api/docs" })),
  Layer.provide(HttpServer.layerServices),
);

/** Serves `/api`: the endpoints, their OpenAPI spec at /api/openapi.json, and docs at /api/docs. */
export const { handler: handleApi } = HttpRouter.toWebHandler(ApiLive);
