import type {
  BenchmarkConfig,
  BenchmarkMetrics,
  EvaluationResult,
} from "./types.js";

export function evaluatePerformance(
  baseline: BenchmarkMetrics,
  candidate: BenchmarkMetrics,
  config: BenchmarkConfig,
): EvaluationResult {
  const reasons: string[] = [];
  let p95RegressionPercent: number | null = null;

  if (baseline.successCount === 0) {
    reasons.push("Baseline produced no successful responses.");
  }

  if (candidate.successCount === 0) {
    reasons.push("Candidate produced no successful responses.");
  }

  if (baseline.p95Ms !== null && candidate.p95Ms !== null) {
    if (baseline.p95Ms === 0) {
      if (candidate.p95Ms === 0) {
        p95RegressionPercent = 0;
      } else {
        reasons.push(
          "Candidate p95 latency could not be compared because baseline p95 latency was zero.",
        );
      }
    } else {
      p95RegressionPercent =
        ((candidate.p95Ms - baseline.p95Ms) / baseline.p95Ms) * 100;

      if (p95RegressionPercent > config.maxP95RegressionPercent) {
        reasons.push(
          `Candidate p95 latency regressed by ${p95RegressionPercent.toFixed(1)}%, ` +
            `exceeding the allowed ${config.maxP95RegressionPercent.toFixed(1)}%.`,
        );
      }
    }
  }

  if (candidate.errorRatePercent > config.maxErrorRatePercent) {
    reasons.push(
      `Candidate error rate was ${candidate.errorRatePercent.toFixed(1)}%, ` +
        `exceeding the allowed ${config.maxErrorRatePercent.toFixed(1)}%.`,
    );
  }

  return {
    passed: reasons.length === 0,
    p95RegressionPercent,
    reasons,
  };
}
