import type { Baseline, FixChecks, Run } from "#/domain";
import { runsPerVerdict } from "./verdict";

/**
 * Judges a fix from its runs. The original test must pass every run; the target's suite must not
 * lose a test that passed at the issue's commit, nor shrink (a deleted test would hide a break); and
 * the fix must leave the failing test alone. Each check that fails gives one reason.
 */
export const judgeFix = ({
  testRuns,
  suite,
  before,
  testUntouched,
}: {
  testRuns: ReadonlyArray<Run>;
  suite: Run;
  before: Baseline;
  testUntouched: boolean;
}) => {
  const testPassed =
    testRuns.length === runsPerVerdict && testRuns.every((run) => run.outcome === "pass");

  const newlyFailing = suite.failedTests.filter((name) => !before.failedTests.includes(name));
  const shrank = suite.passed + suite.failed < before.passed + before.failed;
  const holds = suite.outcome !== "broken" && newlyFailing.length === 0 && !shrank;

  const reasons = [
    ...(testPassed
      ? []
      : [
          `The issue's test passed ${testRuns.filter((run) => run.outcome === "pass").length} of ${runsPerVerdict} runs, not all of them.`,
        ]),
    ...(suite.outcome === "broken" ? ["The suite couldn't run with the fix."] : []),
    ...(newlyFailing.length > 0
      ? [`${newlyFailing.length} tests that passed before now fail: ${newlyFailing.join("; ")}.`]
      : []),
    ...(shrank
      ? [
          `The suite ran ${suite.passed + suite.failed} tests, fewer than the ${before.passed + before.failed} before the fix.`,
        ]
      : []),
    ...(testUntouched
      ? []
      : ["The fix changes the issue's test; Forkin ran the original instead."]),
  ];

  const checks = {
    test: { passed: testPassed, runs: testRuns },
    suite: { holds, run: suite, before, newlyFailing },
    testUntouched,
  } satisfies FixChecks;

  return { checks, reasons };
};
