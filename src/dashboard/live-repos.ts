/** The real repositories Forkin runs on in public: on the landing page and in the repo switcher. */
export const liveRepos = [
  {
    owner: "thinkex-oss",
    repo: "thinkex",
    name: "ThinkEx",
    about: "An open source study app. Real open bugs, and past ones confirmed fixed on main.",
    avatar: "https://github.com/ThinkEx-OSS.png?size=64",
  },
  {
    owner: "cloudflare",
    repo: "agents",
    name: "Cloudflare Agents SDK",
    about:
      "Cloudflare's Agents SDK. Real reported bugs, each reproduced at the commit it was reported against.",
    avatar: "https://github.com/cloudflare.png?size=64",
  },
] as const;

export type LiveRepo = (typeof liveRepos)[number];
