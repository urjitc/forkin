import { createFileRoute } from "@tanstack/react-router";
import { loadLiveRepos } from "#/dashboard/data";
import { Landing } from "#/landing/Landing";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Forkin: issues are the new pull requests" },
      {
        name: "description",
        content:
          "Open source maintainers are drowning in swarms of AI slop. Forkin reproduces and verifies every issue that comes in, and lets any number of agents find and fix bugs in parallel.",
      },
    ],
  }),
  loader: () => loadLiveRepos(),
  component: LandingPage,
});

function LandingPage() {
  return <Landing live={Route.useLoaderData()} />;
}
