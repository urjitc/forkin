import { createFileRoute } from "@tanstack/react-router";
import { ActivityLog } from "#/dashboard/activity";
import { loadEnvironment } from "#/dashboard/data";
import { useReloadOnProjectChange } from "#/dashboard/live";
import { CommitLink, Section, ago, box } from "#/dashboard/ui";
import { EnvironmentStatus, type Baseline } from "#/domain";

export const Route = createFileRoute("/$owner/$repo/environment")({
  loader: ({ params }) => loadEnvironment({ data: params }),
  component: EnvironmentPage,
});

const baselineText = (baseline: Baseline | undefined) =>
  baseline === undefined
    ? "Not run yet"
    : baseline.outcome === "broken"
      ? "The suite couldn't run"
      : `${baseline.passed} passed, ${baseline.failed} failed`;

const cell = "px-4 py-2.5 text-left";

// Where every check runs: the repo's snapshot, its targets and their baselines, and the log of
// everything the repo's Project has done.
function EnvironmentPage() {
  const { owner, repo } = Route.useParams();
  const { environment, activity } = Route.useLoaderData();

  useReloadOnProjectChange(owner, repo);

  if (!environment) {
    return (
      <>
        <h1 className="mb-2 text-2xl font-semibold">Environment</h1>
        <p className="text-muted-foreground">
          This repo isn't set up yet. Add a forkin.json with its install command and test targets;
          Forkin builds a snapshot from it, and every check runs there.
        </p>
      </>
    );
  }

  const { config, status } = environment;
  const baselines = EnvironmentStatus.guards.Ready(status) ? status.snapshot.baselines : {};

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold">Environment</h1>

      <Section title="Snapshot">
        <div className={`${box} px-4 py-3`}>
          {EnvironmentStatus.match(status, {
            Ready: ({ snapshot }) => (
              <p>
                <span className="font-medium text-add">Ready</span> at{" "}
                <CommitLink owner={owner} repo={repo} sha={snapshot.commit} />, built{" "}
                {ago(snapshot.builtAt)} in {Math.round(snapshot.seconds)} s.
              </p>
            ),
            Building: ({ commit, step }) => (
              <p>
                <span className="font-medium text-brand-ink">Building</span> at{" "}
                <code className="font-mono text-sm">{commit.slice(0, 7)}</code>: {step}
              </p>
            ),
            Failed: ({ commit, message }) => (
              <>
                <p>
                  <span className="font-medium text-del">Failed</span> to build at{" "}
                  <code className="font-mono text-sm">{commit.slice(0, 7)}</code>
                </p>
                <pre className="mt-3 overflow-x-auto font-mono text-xs text-muted-foreground">
                  {message}
                </pre>
              </>
            ),
          })}
        </div>
      </Section>

      <Section title="Test targets">
        <div className={`${box} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-muted-foreground">
              <tr>
                <th className={`${cell} font-medium`}>Target</th>
                <th className={`${cell} font-medium`}>Runs</th>
                <th className={`${cell} font-medium`}>Baseline</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {Object.entries(config.targets).map(([name, target]) => (
                <tr key={name}>
                  <td className={`${cell} font-medium`}>{name}</td>
                  <td className={cell}>
                    <code className="font-mono text-xs">{target.test}</code>
                    {target.path !== "." && (
                      <span className="text-muted-foreground"> in {target.path}</span>
                    )}
                  </td>
                  <td className={cell}>{baselineText(baselines[name])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Activity">
        <ActivityLog events={activity} />
      </Section>
    </>
  );
}
