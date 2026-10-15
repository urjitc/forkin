import { useRouter } from "@tanstack/react-router";
import { useAgent } from "agents/react";
import { Option, Schema } from "effect";
import { useState } from "react";
import { ProjectState, projectName } from "#/domain";

const decodeState = Schema.decodeUnknownOption(ProjectState);

const agentOf = (owner: string, repo: string) => ({
  agent: "project",
  name: projectName(owner, repo),
});

/** A repo's issue summaries, starting from the server-rendered state and kept live from its Project. */
export function useLiveProject(owner: string, repo: string, initial: ProjectState) {
  const [state, setState] = useState(initial);

  useAgent({
    ...agentOf(owner, repo),
    onStateUpdate: (next) => Option.map(decodeState(next), setState),
  });

  return state;
}

/** Reloads the current page's data whenever the repo's Project changes. */
export function useReloadOnProjectChange(owner: string, repo: string) {
  const router = useRouter();

  useAgent({ ...agentOf(owner, repo), onStateUpdate: () => void router.invalidate() });
}
