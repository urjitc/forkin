import { assert, describe, it } from "@effect/vitest";
import type { Baseline, Run, RunOutcome } from "#/domain";
import { judgeFix } from "./fix-checks";

const run = (outcome: RunOutcome, failedTests: ReadonlyArray<string> = []): Run => ({
  commit: "036dad7",
  outcome,
  passed: 30,
  failed: failedTests.length,
  failedTests,
  seconds: 20,
  at: "2026-10-15T00:00:00.000Z",
});

// The suite at the issue's commit with its test: the test fails, and one other test was already failing.
const before: Baseline = {
  outcome: "fail",
  passed: 30,
  failed: 2,
  failedTests: ["the bug shows", "already broken"],
  seconds: 20,
};

const passing = [run("pass"), run("pass"), run("pass")];

describe("judgeFix", () => {
  it("proves a fix that passes the test and keeps the suite", () => {
    const { checks, reasons } = judgeFix({
      testRuns: passing,
      suite: { ...run("fail", ["already broken"]), passed: 31 },
      before,
      testUntouched: true,
    });

    assert.deepStrictEqual(reasons, []);
    assert.isTrue(checks.test.passed && checks.suite.holds && checks.testUntouched);
  });

  it("rejects a fix the test still fails on", () => {
    const { reasons } = judgeFix({
      testRuns: [run("pass"), run("fail"), run("pass")],
      suite: { ...run("fail", ["already broken"]), passed: 31 },
      before,
      testUntouched: true,
    });

    assert.deepStrictEqual(reasons, ["The issue's test passed 2 of 3 runs, not all of them."]);
  });

  it("rejects a fix that breaks a test that passed before", () => {
    const { checks } = judgeFix({
      testRuns: passing,
      suite: run("fail", ["already broken", "renders the list"]),
      before,
      testUntouched: true,
    });

    assert.isFalse(checks.suite.holds);
    assert.deepStrictEqual(checks.suite.newlyFailing, ["renders the list"]);
  });

  it("rejects a fix that deletes tests to pass", () => {
    const { checks } = judgeFix({
      testRuns: passing,
      suite: { ...run("pass"), passed: 25 },
      before,
      testUntouched: true,
    });

    assert.isFalse(checks.suite.holds);
  });

  it("rejects a fix that edits the issue's test", () => {
    const { reasons } = judgeFix({
      testRuns: passing,
      suite: { ...run("fail", ["already broken"]), passed: 31 },
      before,
      testUntouched: false,
    });

    assert.deepStrictEqual(reasons, [
      "The fix changes the issue's test; Forkin ran the original instead.",
    ]);
  });
});
