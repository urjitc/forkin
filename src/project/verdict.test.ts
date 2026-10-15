import { assert, describe, it } from "@effect/vitest";
import { Verdict, type Run, type RunOutcome } from "#/domain";
import { verdictFromRuns } from "./verdict";

const run = (outcome: RunOutcome): Run => ({
  commit: "cbb859b",
  outcome,
  passed: 0,
  failed: outcome === "fail" ? 1 : 0,
  failedTests: outcome === "fail" ? ["the bug shows"] : [],
  seconds: 20,
  at: "2026-10-14T00:00:00.000Z",
});

describe("verdictFromRuns", () => {
  it("is Reproduced only when every run fails", () => {
    assert.deepStrictEqual(
      verdictFromRuns([run("fail"), run("fail"), run("fail")]),
      Verdict.cases.Reproduced.make({}),
    );
  });

  it("reports a flaky test as Couldn't reproduce with its failure count", () => {
    assert.deepStrictEqual(
      verdictFromRuns([run("fail"), run("pass"), run("fail")]),
      Verdict.cases.CouldntReproduce.make({ failedRuns: 2, totalRuns: 3 }),
    );
  });

  it("is Couldn't reproduce when the test passes", () => {
    assert.deepStrictEqual(
      verdictFromRuns([run("pass"), run("pass"), run("pass")]),
      Verdict.cases.CouldntReproduce.make({ failedRuns: 0, totalRuns: 3 }),
    );
  });

  it("is Broken test when any run crashes before testing", () => {
    assert.deepStrictEqual(
      verdictFromRuns([run("fail"), run("broken"), run("fail")]),
      Verdict.cases.BrokenTest.make({}),
    );
  });

  it("never calls an issue Reproduced without runs", () => {
    assert.deepStrictEqual(
      verdictFromRuns([]),
      Verdict.cases.CouldntReproduce.make({ failedRuns: 0, totalRuns: 0 }),
    );
  });
});
