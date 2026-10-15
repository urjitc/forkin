import { FileDiff } from "@pierre/diffs/react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { diffOptions } from "./code";
import { treeOptions, type PatchFiles } from "./files";

const anchor = (path: string) => `file-${path.replaceAll(/[^a-zA-Z0-9]+/g, "-")}`;

/** Each row of the file tree is this tall, so the tree is sized to its contents. */
const rowHeight = 30;

/** A patch as GitHub shows "Files changed": a summary and a file tree, then each file's diff. */
export function FilesView({ patch }: { patch: PatchFiles }) {
  const { id, files, treeHtml } = patch;

  const { model } = useFileTree({
    ...treeOptions(id, files),
    onSelectionChange: ([path]) => {
      if (path) document.getElementById(anchor(path))?.scrollIntoView({ behavior: "smooth" });
    },
  });

  if (files.length === 0) return <p className="text-muted-foreground">No files changed.</p>;

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  // One row per file and per folder on the way to it, capped so a big fix scrolls inside the tree.
  const folders = new Set(
    files.flatMap(({ path }) =>
      path
        .split("/")
        .slice(0, -1)
        .map((_, depth, parts) => parts.slice(0, depth + 1).join("/")),
    ),
  );

  const treeHeight = Math.min((files.length + folders.size) * rowHeight + rowHeight, 600);

  return (
    <>
      <p className="mb-4 text-sm">
        {files.length} {files.length === 1 ? "file" : "files"} changed{" "}
        <span className="font-mono text-xs whitespace-nowrap">
          <span className="text-add">+{additions}</span>{" "}
          <span className="text-del">−{deletions}</span>
        </span>
      </p>
      <div className={files.length > 1 ? "grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]" : ""}>
        {/* One file needs no tree: its diff's header already names it. */}
        {files.length > 1 && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <FileTree
              model={model}
              preloadedData={{ id, shadowHtml: treeHtml }}
              style={{ height: `${treeHeight}px` }}
            />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-4">
          {files.map((file) => (
            <section
              key={file.path}
              id={anchor(file.path)}
              className="scroll-mt-4 overflow-hidden rounded-md border"
            >
              <FileDiff
                fileDiff={file.fileDiff}
                options={diffOptions}
                prerenderedHTML={file.html}
              />
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
