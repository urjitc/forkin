import { createFileRoute } from "@tanstack/react-router";
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
  component: Landing,
});
