import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { loadFix } from "#/dashboard/data";
import { FilesView } from "#/dashboard/files-view";
import { FixSummary } from "#/dashboard/fixes";
import { useReloadOnProjectChange } from "#/dashboard/live";
import { box } from "#/dashboard/ui";

export const Route = createFileRoute("/$owner/$repo/issues/$number_/fixes/$id")({
  loader: async ({ params }) => {
    const loaded = await loadFix({
      data: { ...params, number: Number(params.number) },
    });

    if (!loaded.fix) throw notFound();

    return { fix: loaded.fix, issueTitle: loaded.issueTitle, files: loaded.files };
  },
  component: FixPage,
});

// One agent's attempt at an issue, laid out like a pull request: who made it, what Forkin's checks
// found, and every file it changed.
function FixPage() {
  const { owner, repo, number } = Route.useParams();
  const { fix, issueTitle, files } = Route.useLoaderData();

  useReloadOnProjectChange(owner, repo);

  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">
        Fix by {fix.author} <span className="text-muted-foreground">for #{number}</span>
      </h1>
      <p className="mt-2 text-muted-foreground">
        <Link
          to="/$owner/$repo/issues/$number"
          params={{ owner, repo, number }}
          search={{ tab: "fixes" }}
        >
          {issueTitle}
        </Link>
      </p>

      <div className={`${box} mt-6 px-4 py-3`}>
        <FixSummary fix={fix} />
      </div>

      <div className="mt-8">
        <FilesView patch={files} />
      </div>
    </>
  );
}
