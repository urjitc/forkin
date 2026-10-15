import { Link, createFileRoute } from "@tanstack/react-router";
import { loadProject } from "#/dashboard/data";
import { useLiveProject } from "#/dashboard/live";
import {
  ForkIcon,
  RunningElsewhere,
  VerdictIcon,
  VerdictLabel,
  ago,
  box,
  verdictLabel,
  verdictOrder,
} from "#/dashboard/ui";
import type { Verdict } from "#/domain";
import { cn } from "#/lib/utils";

type Filter = Verdict["_tag"] | "all";

/** The verdict filter in the URL; absent means all issues. */
type IssuesSearch = { verdict?: Filter | undefined };

const filters: ReadonlyArray<Filter> = ["all", ...verdictOrder];

export const Route = createFileRoute("/$owner/$repo/")({
  validateSearch: (search): IssuesSearch => ({
    verdict: filters.find((f) => f === search.verdict),
  }),
  loader: ({ params }) => loadProject({ data: params }),
  component: Issues,
});

// The repository's issues, as GitHub lists them, strongest evidence first and live from its Project.
function Issues() {
  const { owner, repo } = Route.useParams();
  const { verdict = "all" } = Route.useSearch();
  const { issues, running } = useLiveProject(owner, repo, Route.useLoaderData());

  const shown = issues
    .filter((i) => verdict === "all" || i.verdict._tag === verdict)
    .toSorted(
      (a, b) =>
        verdictOrder.indexOf(a.verdict._tag) - verdictOrder.indexOf(b.verdict._tag) ||
        b.number - a.number,
    );

  const count = (f: Filter) =>
    f === "all" ? issues.length : issues.filter((i) => i.verdict._tag === f).length;

  // Verdicts no issue has are left out.
  const visibleFilters = filters.filter((f) => f === "all" || count(f) > 0);

  const busy = (number: number) => running.filter((work) => work.issue === number);

  return (
    <>
      <h1 className="mb-4 text-2xl font-semibold">Issues</h1>
      <RunningElsewhere running={running} />

      <div className={box}>
        <nav
          aria-label="Filter by verdict"
          className="flex flex-wrap gap-x-5 gap-y-1 rounded-t-md border-b bg-muted/40 px-4 py-3 text-sm"
        >
          {visibleFilters.map((f) => (
            <Link
              data-tab
              key={f}
              to="."
              search={{ verdict: f === "all" ? undefined : f }}
              className={cn(
                "text-muted-foreground hover:text-foreground",
                f === verdict && "font-semibold text-foreground",
              )}
            >
              {f === "all" ? "All" : verdictLabel[f]} {count(f)}
            </Link>
          ))}
        </nav>

        {issues.length === 0 ? (
          <p className="px-4 py-12 text-center text-muted-foreground">No issues yet.</p>
        ) : (
          <ul className="divide-y">
            {shown.map((i) => (
              <li key={i.number}>
                <Link
                  data-row
                  className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  to="/$owner/$repo/issues/$number"
                  params={{ owner, repo, number: String(i.number) }}
                >
                  <span className="pt-1">
                    <VerdictIcon verdict={i.verdict} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold">{i.title}</span>
                      <VerdictLabel verdict={i.verdict} />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      #{i.number} · {i.author} opened {ago(i.openedAt)}
                      {busy(i.number).map((work, index) => (
                        <span key={index} className="text-brand-ink">
                          {" "}
                          · {work.what === "fix" ? `checking a ${work.label}` : "checking its test"}
                        </span>
                      ))}
                    </span>
                  </span>
                  {i.fixes.total > 0 && (
                    <span
                      className="flex shrink-0 items-center gap-1 pt-1 text-sm text-muted-foreground"
                      title={`${i.fixes.total} fixes, ${i.fixes.proven} proven`}
                    >
                      <ForkIcon />
                      {i.fixes.total}
                      {i.fixes.proven > 0 && (
                        <span className="text-add">· {i.fixes.proven} proven</span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
