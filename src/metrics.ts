import type { BenchmarkMetrics, BenchmarkResult } from "./types.js";

export function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0 || !Number.isFinite(percentileValue)) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const calculatedIndex = Math.ceil(percentileValue * sortedValues.length) - 1;
  const index = Math.min(sortedValues.length - 1, Math.max(0, calculatedIndex));

  return sortedValues[index] ?? null;
}

export function calculateMetrics(result: BenchmarkResult): BenchmarkMetrics {
  const successfulDurations = result.requestResults
    .filter((requestResult) => requestResult.ok)
    .map((requestResult) => requestResult.durationMs);

  const averageMs =
    successfulDurations.length === 0
      ? null
      : successfulDurations.reduce((sum, durationMs) => sum + durationMs, 0) /
        successfulDurations.length;

  const throughputPerSecond =
    result.totalDurationMs > 0
      ? result.requestResults.length / (result.totalDurationMs / 1_000)
      : 0;
  const errorRatePercent =
    result.requestedCount > 0 ? (result.errorCount / result.requestedCount) * 100 : 0;

  return {
    p50Ms: percentile(successfulDurations, 0.5),
    p95Ms: percentile(successfulDurations, 0.95),
    averageMs,
    throughputPerSecond,
    errorRatePercent,
    successCount: result.successCount,
    errorCount: result.errorCount,
  };
}
