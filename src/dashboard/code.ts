import type { FileDiffOptions, FileOptions } from "@pierre/diffs";

// One set of Pierre options for the server preload and the hydrated components, so they match.

const theme = { dark: "pierre-dark", light: "pierre-light" } as const;

export const diffOptions: FileDiffOptions<undefined, undefined> = {
  theme,
  themeType: "system",
  diffStyle: "unified",
};

export const fileOptions: FileOptions<undefined, undefined> = { theme, themeType: "system" };
