import { parsePatchFiles, type ChangeTypes } from "@pierre/diffs";
import { preloadFileDiff } from "@pierre/diffs/ssr";
import type { GitStatus } from "@pierre/trees";
import { preloadFileTree } from "@pierre/trees/ssr";
import { diffOptions } from "./code";

/** How a file changed, in the words the file tree colours by. */
const statusOf: Record<ChangeTypes, GitStatus> = {
  new: "added",
  deleted: "deleted",
  change: "modified",
  "rename-pure": "renamed",
  "rename-changed": "renamed",
};

/** The file tree's options, shared by the server render and the hydrated tree so they match. */
export const treeOptions = (
  id: string,
  files: ReadonlyArray<{ path: string; status: GitStatus }>,
) => ({
  id,
  paths: files.map(({ path }) => path),
  gitStatus: files.map(({ path, status }) => ({ path, status })),
  initialExpansion: "open" as const,
  flattenEmptyDirectories: false,
});

/**
 * Splits a patch into its files and renders each, plus a tree of them, the way GitHub lays out
 * "Files changed". `id` names the tree, so the server render and the page agree on it.
 */
export const preloadPatchFiles = async (id: string, patch: string) => {
  const files = await Promise.all(
    parsePatchFiles(patch)
      .flatMap(({ files }) => files)
      .map(async (fileDiff) => {
        const { prerenderedHTML } = await preloadFileDiff({ fileDiff, options: diffOptions });

        return {
          path: fileDiff.name,
          status: statusOf[fileDiff.type],
          fileDiff,
          html: prerenderedHTML,
          additions: fileDiff.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
          deletions: fileDiff.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
        };
      }),
  );

  const { shadowHtml } = preloadFileTree(treeOptions(id, files));

  return { id, files, treeHtml: shadowHtml };
};

/** A patch ready for the Files view: its files, rendered, and its tree. */
export type PatchFiles = Awaited<ReturnType<typeof preloadPatchFiles>>;
