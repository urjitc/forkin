import { getAgentByName } from "agents";
import { Option, Schema } from "effect";
import { projectName } from "#/domain";
import { signedByGitHub } from "./signature";

// GitHub App webhooks. A push to a repo's default branch moves its Project to the new commit, so
// open issues are checked against the latest code. Every delivery is verified with the App's secret.

const Push = Schema.Struct({
  ref: Schema.String,
  after: Schema.String,
  deleted: Schema.Boolean,
  repository: Schema.Struct({ full_name: Schema.String, default_branch: Schema.String }),
});

const decodePush = Schema.decodeUnknownOption(Schema.fromJsonString(Push));

export const handleGitHubWebhook = async (request: Request, env: Env) => {
  const body = await request.text();

  if (
    !(await signedByGitHub(
      body,
      request.headers.get("x-hub-signature-256"),
      env.GITHUB_WEBHOOK_SECRET,
    ))
  ) {
    return Response.json({ error: "Bad signature" }, { status: 401 });
  }

  if (request.headers.get("x-github-event") !== "push") return new Response(null, { status: 204 });

  const push = decodePush(body);

  if (Option.isNone(push)) return Response.json({ error: "Not a push payload" }, { status: 400 });

  const { ref, after, deleted, repository } = push.value;

  if (deleted || ref !== `refs/heads/${repository.default_branch}`) {
    return Response.json({ ignored: `${ref} isn't the default branch` });
  }

  const [owner = "", repo = ""] = repository.full_name.split("/");
  const project = await getAgentByName(env.Project, projectName(owner, repo));

  return (await project.sync(after))
    ? Response.json({ syncing: `${repository.full_name} at ${after}` }, { status: 202 })
    : Response.json({ ignored: `${repository.full_name} isn't set up on Forkin` });
};
