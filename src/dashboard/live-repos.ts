/** The real repositories Forkin runs on in public: on the landing page and in the repo switcher. */
export const liveRepos = [
  {
    owner: "thinkex-oss",
    repo: "thinkex",
    name: "ThinkEx",
    about: "Urjit's open source app. The whole loop, with the GitHub App installed.",
    avatar: "https://github.com/ThinkEx-OSS.png?size=64",
  },
  {
    owner: "cloudflare",
    repo: "agents",
    name: "Cloudflare Agents SDK",
    about: "A large real repo, read-only. Urjit's own past bugs, reproduced.",
    avatar: "https://github.com/cloudflare.png?size=64",
  },
] as const;

export type LiveRepo = (typeof liveRepos)[number];
