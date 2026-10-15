import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { Timeline } from "#/dashboard/activity";
import { Markdown } from "#/dashboard/markdown";
import { FixesList } from "#/dashboard/fixes";
import { FilesView } from "#/dashboard/files-view";
import { loadIssue } from "#/dashboard/data";
import { useReloadOnProjectChange } from "#/dashboard/live";
import {
  Avatar,
  CommitLink,
  ForkIcon,
  ForkinAvatar,
  RunResult,
  VerdictPill,
  ago,
  box,
} from "#/dashboard/ui";
import { FixStatus, Verdict, type Run } from "#/domain";
import { cn } from "#/lib/utils";
import { runsPerVerdict } from "#/project/verdict";

const tabs = ["conversation", "fixes", "files", "runs", "timeline"] as const;

type Tab = (typeof tabs)[number];

/** The open tab in the URL; absent means the conversation. */
type IssueSearch = { tab?: Tab | undefined };

export const Route = createFileRoute("/$owner/$repo/issues/$number")({
  validateSearch: (search): IssueSearch => ({
    tab: tabs.find((t) => t === search.tab),
  }),
  loader: async ({ params }) => {
    const loaded = await loadIssue({
      data: { owner: params.owner, repo: params.repo, number: Number(params.number) },
    });

    if (!loaded.issue) throw notFound();

    return {
      issue: loaded.issue,
      activity: loaded.activity,
      fixes: loaded.fixes,
      files: loaded.files,
    };
  },
  component: IssuePage,
});

// One sentence on what the evidence means, so a maintainer doesn't have to read the runs.
const summary = Verdict.match({
  Unverified: () => "No failing test is attached, so nothing has been checked.",
  Checking: () => `Forkin is running the failing test ${runsPerVerdict} times in a sandbox.`,
  Reproduced: () =>
    `The test failed in all ${runsPerVerdict} runs on the commit it was filed against, so the bug is real.`,
  CouldntReproduce: ({ failedRuns, totalRuns }) =>
    failedRuns === 0
      ? "The test passed on the commit it was filed against, so it doesn't show the bug."
      : `The test failed in only ${failedRuns} of ${totalRuns} runs, so it is flaky and doesn't count.`,
  BrokenTest: () => "The test crashed before it ran, so it says nothing about the bug yet.",
  AlreadyFixed: () => "The test passes on main now, so this was fixed.",
});

/** A comment-style card: who said it and when, then what they said. */
function Comment({
  who,
  avatar,
  when,
  children,
}: {
  who: string;
  avatar: React.ReactNode;
  when: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      {avatar}
      <article className={cn(box, "min-w-0 flex-1")}>
        <header className="rounded-t-md border-b bg-muted/40 px-4 py-2.5 text-sm">
          <b className="font-semibold">{who}</b>{" "}
          <span className="text-muted-foreground">commented {ago(when)}</span>
        </header>
        <div className="flex flex-col gap-3 p-4 text-sm">{children}</div>
      </article>
    </div>
  );
}

// One issue, laid out as GitHub lays out a pull request: a header, tabs for the conversation, the
// fixes, the test and the runs, and the facts in a sidebar.
function IssuePage() {
  const { owner, repo } = Route.useParams();
  const { tab = "conversation" } = Route.useSearch();
  const { issue, activity, fixes, files } = Route.useLoaderData();
  const failedTests = issue.runs.find((run) => run.failedTests.length > 0)?.failedTests ?? [];
  const proven = fixes.filter((fix) => FixStatus.guards.Proven(fix.status)).length;
  const checkedAt = issue.runs[0]?.at ?? issue.openedAt;
  const latest = latestCheck(issue.runs);

  useReloadOnProjectChange(owner, repo);

  const tabLabel: Record<Tab, React.ReactNode> = {
    conversation: "Conversation",
    fixes: (
      <>
        Fixes <Count n={fixes.length} />
      </>
    ),
    files: "Files",
    runs: (
      <>
        Runs <Count n={issue.runs.length} />
      </>
    ),
    timeline: "Timeline",
  };

  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">
        {issue.title} <span className="text-muted-foreground">#{issue.number}</span>
      </h1>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <VerdictPill verdict={issue.verdict} />
        {fixes.length > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
            <ForkIcon className="text-muted-foreground" />
            {fixes.length} {fixes.length === 1 ? "fix" : "fixes"}
            {proven > 0 && <span className="text-add">· {proven} proven</span>}
          </span>
        )}
        <span className="text-muted-foreground">
          <b className="font-semibold text-foreground">{issue.author}</b> opened this{" "}
          {ago(issue.openedAt)}
        </span>
      </div>

      <nav className="mt-6 mb-6 flex gap-1 border-b" aria-label="Issue">
        {tabs.map((t) => (
          <Link
            key={t}
            data-tab
            to="."
            search={{ tab: t === "conversation" ? undefined : t }}
            className={cn(
              "-mb-px rounded-t-md border px-4 py-2 text-sm",
              t === tab
                ? "border-border border-b-background bg-background font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tabLabel[t]}
          </Link>
        ))}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {tab === "conversation" && (
            <>
              <Comment
                who={issue.author}
                avatar={<Avatar login={issue.author} />}
                when={issue.openedAt}
              >
                {issue.body ? (
                  <Markdown>{issue.body}</Markdown>
                ) : (
                  <p className="text-muted-foreground italic">No description provided.</p>
                )}
              </Comment>

              {issue.reproducer && (
                <Comment who="forkin" avatar={<ForkinAvatar />} when={checkedAt}>
                  <p>{summary(issue.verdict)}</p>
                  {Verdict.guards.AlreadyFixed(issue.verdict) && (
                    <p className="text-sm">
                      Fixed on main by{" "}
                      <CommitLink owner={owner} repo={repo} sha={issue.verdict.commit} />
                    </p>
                  )}
                  {failedTests.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      <li className="text-muted-foreground">
                        Failing {failedTests.length === 1 ? "test" : "tests"}
                      </li>
                      {failedTests.map((name) => (
                        <li key={name} className="flex gap-2">
                          <span aria-hidden="true" className="text-del">
                            ✕
                          </span>
                          {name}
                        </li>
                      ))}
                    </ul>
                  )}
                </Comment>
              )}
            </>
          )}

          {tab === "fixes" && (
            <FixesList fixes={fixes} issue={{ owner, repo, number: issue.number }} />
          )}

          {tab === "files" && <FilesView patch={files} />}

          {tab === "timeline" &&
            (activity.length > 0 ? (
              <Timeline events={activity} />
            ) : (
              <p className="text-muted-foreground">Nothing yet.</p>
            ))}

          {tab === "runs" &&
            (issue.runs.length > 0 ? (
              <ul className={`${box} divide-y`}>
                {issue.runs.map((run) => (
                  <RunResult
                    key={`${run.at}-${run.seconds}`}
                    run={run}
                    what="The test"
                    repo={{ owner, repo }}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No runs yet.</p>
            ))}
        </div>

        <aside className="flex flex-col gap-5 text-sm">
          {issue.github !== null && (
            <Fact title="GitHub">
              <a href={`https://github.com/${owner}/${repo}/issues/${issue.github}`}>
                #{issue.github}
              </a>
            </Fact>
          )}
          {latest && (
            <Fact title="Last checked">
              <p>
                {latest.failed === 0
                  ? `Passed ${latest.total} of ${latest.total} runs`
                  : `Failed ${latest.failed} of ${latest.total} runs`}
              </p>
              <p className="mt-0.5 text-muted-foreground">
                on <CommitLink owner={owner} repo={repo} sha={latest.commit} /> · {ago(latest.at)}
              </p>
            </Fact>
          )}
          {issue.reproducer && (
            <>
              <Fact title="Fixes">
                <Link to="." search={{ tab: "fixes" }} data-tab>
                  {fixes.length === 0
                    ? "None yet"
                    : `${fixes.length} ${fixes.length === 1 ? "fix" : "fixes"}`}
                  {proven > 0 && <span className="text-add"> · {proven} proven</span>}
                </Link>
              </Fact>
              <Fact title="Test">
                <Link to="." search={{ tab: "files" }} data-tab className="font-mono text-xs">
                  {issue.reproducer.path.split("/").at(-1)}
                </Link>{" "}
                <span className="text-muted-foreground">in {issue.reproducer.target}</span>
              </Fact>
              <Fact title="Reported at">
                <CommitLink owner={owner} repo={repo} sha={issue.reproducer.commit} />
              </Fact>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

/** The newest batch of runs on one commit: how many failed, on what, and when. */
const latestCheck = (runs: ReadonlyArray<Run>) => {
  const [newest] = runs;

  if (!newest) return null;

  const batch = runs.filter((run) => run.commit === newest.commit).slice(0, runsPerVerdict);

  return {
    commit: newest.commit,
    at: newest.at,
    total: batch.length,
    failed: batch.filter((run) => run.outcome === "fail").length,
  };
};

function Count({ n }: { n: number }) {
  return <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs">{n}</span>;
}

/** One fact in the sidebar, under a rule, as GitHub's issue sidebar shows them. */
function Fact({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b pb-4">
      <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
