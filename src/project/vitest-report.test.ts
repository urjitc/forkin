import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import before from "./fixtures/agents-2400-before.json?raw";
import after from "./fixtures/agents-2400-after.json?raw";
import { readVitestReport } from "./vitest-report";

// The fixtures are trimmed reports from a real run of cloudflare/agents PR 2400's test, before and after its fix.
describe("readVitestReport", () => {
  it.effect("reads a failing run", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* readVitestReport(before), {
        outcome: "fail",
        passed: 18,
        failed: 2,
        failedTests: [
          "Spike: sub-agent routing via facet Fetcher connects a WebSocket to a leaf facet 2 levels below the root",
          "Spike: sub-agent routing via facet Fetcher connects a WebSocket to a leaf facet 3 levels below the root",
        ],
      });
    }),
  );

  it.effect("reads a passing run", () =>
    Effect.gen(function* () {
      assert.strictEqual((yield* readVitestReport(after)).outcome, "pass");
    }),
  );

  it.effect("calls a file that failed to load broken", () =>
    Effect.gen(function* () {
      const crashed = JSON.stringify({
        numTotalTests: 0,
        numPassedTests: 0,
        numFailedTests: 0,
        testResults: [{ status: "failed", message: "Cannot find module", assertionResults: [] }],
      });

      assert.strictEqual((yield* readVitestReport(crashed)).outcome, "broken");
    }),
  );

  it.effect("fails on output that is not a Vitest report", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(readVitestReport("Error: workerd crashed"));

      assert.strictEqual(error._tag, "UnreadableReport");
    }),
  );
});
