import { Verdict, type Run } from "#/domain";

/** How many times a reproducer runs before Forkin calls a verdict; it must fail every time. */
export const runsPerVerdict = 3;

/**
 * The verdict a set of runs supports. Any crash means the test itself is broken; only failing every
 * run counts as Reproduced, so a flaky test lands as Couldn't reproduce with its failure count.
 */
export const verdictFromRuns = (runs: ReadonlyArray<Run>): Verdict => {
  if (runs.some((run) => run.outcome === "broken")) return Verdict.cases.BrokenTest.make({});

  const failedRuns = runs.filter((run) => run.outcome === "fail").length;

  if (runs.length > 0 && failedRuns === runs.length) return Verdict.cases.Reproduced.make({});

  return Verdict.cases.CouldntReproduce.make({ failedRuns, totalRuns: runs.length });
};
