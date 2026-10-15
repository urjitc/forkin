import { Effect, Schema } from "effect";
import type { RunOutcome } from "#/domain";

// The fields Forkin reads from Vitest's JSON reporter.
const VitestReport = Schema.Struct({
  numTotalTests: Schema.Int,
  numPassedTests: Schema.Int,
  numFailedTests: Schema.Int,
  testResults: Schema.Array(
    Schema.Struct({
      status: Schema.String,
      message: Schema.optionalKey(Schema.String),
      assertionResults: Schema.Array(
        Schema.Struct({ status: Schema.String, fullName: Schema.String }),
      ),
    }),
  ),
});

export class UnreadableReport extends Schema.TaggedError<UnreadableReport>()("UnreadableReport", {
  message: Schema.String,
}) {}

const decodeReport = Schema.decodeUnknownEffect(Schema.fromJsonString(VitestReport));

/**
 * Reads a Vitest JSON report. A file that failed to load, or a run with no tests, is `broken`:
 * the test crashed before it could say anything about the bug.
 */
export const readVitestReport = Effect.fn("readVitestReport")(function* (json: string) {
  const report = yield* decodeReport(json).pipe(
    Effect.mapError(
      (error) =>
        new UnreadableReport({ message: `Vitest's report could not be read: ${error.message}` }),
    ),
  );

  const crashed = report.testResults.some(
    (file) => file.status === "failed" && file.assertionResults.length === 0,
  );

  const outcome: RunOutcome =
    crashed || report.numTotalTests === 0 ? "broken" : report.numFailedTests > 0 ? "fail" : "pass";

  const failedTests = report.testResults.flatMap((file) =>
    file.assertionResults.flatMap((test) => (test.status === "failed" ? [test.fullName] : [])),
  );

  return { outcome, passed: report.numPassedTests, failed: report.numFailedTests, failedTests };
});
