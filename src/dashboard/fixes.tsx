import { Link } from "@tanstack/react-router";
import { FixStatus, type Fix, type FixChecks } from "#/domain";
import { runsPerVerdict } from "#/project/verdict";
import { cn } from "#/lib/utils";
import { FixLabel, ago, box } from "./ui";

/** Proven fixes first, then those being checked, waiting, and rejected; newest first within each. */
const statusOrder: ReadonlyArray<Fix["status"]["_tag"]> = [
  "Proven",
  "Checking",
  "Open",
  "Rejected",
];

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={cn("flex items-center gap-1", ok ? "text-add" : "text-del")}>
      <span aria-hidden="true">{ok ? "✓" : "✕"}</span>
      <span className="text-foreground">{children}</span>
    </span>
  );
}

const total = ({ passed, failed }: { passed: number; failed: number }) => passed + failed;

/** The three checks in a row, and the sandbox time they took. */
function Checks({ checks }: { checks: FixChecks }) {
  const { test, suite, testUntouched } = checks;
  const passes = test.runs.filter((run) => run.outcome === "pass").length;

  const seconds = test.runs.reduce((sum, run) => sum + run.seconds, 0) + suite.run.seconds;

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      <Check ok={test.passed}>
        Test passes {passes}/{runsPerVerdict}
      </Check>
      <Check ok={suite.holds}>
        Suite {suite.run.passed}/{total(suite.run)}{" "}
        <span className="text-muted-foreground">
          (before {suite.before.passed}/{total(suite.before)})
        </span>
      </Check>
      <Check ok={testUntouched}>Test untouched</Check>
      <span className="text-muted-foreground">{Math.round(seconds)} s of sandbox time</span>
    </div>
  );
}

/** Where a fix's page lives. */
export type IssueRef = { owner: string; repo: string; number: number };

/** One agent's attempt: who, which commit, the checks, and why it was rejected. */
export function FixSummary({ fix }: { fix: Fix }) {
  const commit = FixStatus.match(fix.status, {
    Open: () => null,
    Checking: ({ commit }) => commit,
    Proven: ({ commit }) => commit,
    Rejected: ({ commit }) => commit,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FixLabel status={fix.status} />
        <span className="font-semibold">{fix.author}</span>
        <span className="text-sm text-muted-foreground">
          {commit && <code className="font-mono">{commit.slice(0, 7)}</code>}
          {commit && " · "}started {ago(fix.startedAt)}
          {fix.builtOn && (
            <>
              {" · building on "}
              <code className="font-mono">{fix.builtOn}</code>
            </>
          )}
        </span>
      </div>
      {FixStatus.match(fix.status, {
        Open: () => <p className="text-xs text-muted-foreground">Waiting for its agent to push.</p>,
        Checking: () => (
          <p className="text-sm text-muted-foreground">
            Running the test {runsPerVerdict} times and the suite on this fix…
          </p>
        ),
        Proven: ({ checks }) => <Checks checks={checks} />,
        Rejected: ({ checks, reasons }) => (
          <>
            {checks && <Checks checks={checks} />}
            <ul className="text-sm text-del">
              {reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </>
        ),
      })}
    </div>
  );
}

/** Every agent's attempt at an issue, side by side, so the runs show which one should ship. */
export function FixesList({ fixes, issue }: { fixes: ReadonlyArray<Fix>; issue: IssueRef }) {
  if (fixes.length === 0) {
    return <p className={`${box} px-4 py-6 text-center text-muted-foreground`}>No fixes yet.</p>;
  }

  const sorted = fixes.toSorted(
    (a, b) =>
      statusOrder.indexOf(a.status._tag) - statusOrder.indexOf(b.status._tag) ||
      b.startedAt.localeCompare(a.startedAt),
  );

  return (
    <ul className={`${box} divide-y`}>
      {sorted.map((fix) => (
        <li key={fix.id}>
          <Link
            data-row
            to="/$owner/$repo/issues/$number/fixes/$id"
            params={{
              owner: issue.owner,
              repo: issue.repo,
              number: String(issue.number),
              id: fix.id,
            }}
            className="block px-4 py-3 transition-colors hover:bg-muted/50"
          >
            <FixSummary fix={fix} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
