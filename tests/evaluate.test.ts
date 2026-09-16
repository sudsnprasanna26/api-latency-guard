import { describe, expect, it } from "vitest";

import { evaluatePerformance } from "../src/evaluate.js";
import type { BenchmarkConfig, BenchmarkMetrics } from "../src/types.js";

const config: BenchmarkConfig = {
  baselineUrl: "https://baseline.example.com",
  candidateUrl: "https://candidate.example.com",
  endpoint: "/",
  requests: 50,
  concurrency: 5,
  warmupRequests: 5,
  requestTimeoutMs: 5_000,
  maxP95RegressionPercent: 20,
  maxErrorRatePercent: 1,
  headers: {},
};

function metrics(
  p95Ms: number | null,
  errorRatePercent = 0,
  successCount = p95Ms === null ? 0 : 50,
): BenchmarkMetrics {
  return {
    p50Ms: p95Ms,
    p95Ms,
    averageMs: p95Ms,
    throughputPerSecond: 10,
    errorRatePercent,
    successCount,
    errorCount: 50 - successCount,
  };
}

describe("evaluatePerformance", () => {
  it("passes a candidate that is faster than baseline", () => {
    const result = evaluatePerformance(metrics(100), metrics(80), config);

    expect(result).toEqual({ passed: true, p95RegressionPercent: -20, reasons: [] });
  });

  it("passes a slower candidate below the threshold", () => {
    expect(evaluatePerformance(metrics(100), metrics(119), config).passed).toBe(true);
  });

  it("passes a candidate exactly at the latency threshold", () => {
    const result = evaluatePerformance(metrics(100), metrics(120), config);

    expect(result.passed).toBe(true);
    expect(result.p95RegressionPercent).toBe(20);
  });

  it("fails a candidate above the latency threshold", () => {
    const result = evaluatePerformance(metrics(100), metrics(125), config);

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain(
      "Candidate p95 latency regressed by 25.0%, exceeding the allowed 20.0%.",
    );
  });

  it("passes when candidate error rate is below the threshold", () => {
    expect(evaluatePerformance(metrics(100), metrics(100, 0.9), config).passed).toBe(true);
  });

  it("passes when candidate error rate exactly matches the threshold", () => {
    expect(evaluatePerformance(metrics(100), metrics(100, 1), config).passed).toBe(true);
  });

  it("fails when candidate error rate exceeds the threshold", () => {
    const result = evaluatePerformance(metrics(100), metrics(100, 4), config);

    expect(result.reasons).toContain(
      "Candidate error rate was 4.0%, exceeding the allowed 1.0%.",
    );
  });

  it("fails when the baseline has no successful responses", () => {
    const result = evaluatePerformance(metrics(null), metrics(100), config);

    expect(result.passed).toBe(false);
    expect(result.p95RegressionPercent).toBeNull();
    expect(result.reasons).toContain("Baseline produced no successful responses.");
  });

  it("fails when the candidate has no successful responses", () => {
    const result = evaluatePerformance(metrics(100), metrics(null, 100), config);

    expect(result.passed).toBe(false);
    expect(result.p95RegressionPercent).toBeNull();
    expect(result.reasons).toContain("Candidate produced no successful responses.");
  });

  it("returns every simultaneous failure reason", () => {
    const result = evaluatePerformance(metrics(null), metrics(null, 100), config);

    expect(result.reasons).toEqual([
      "Baseline produced no successful responses.",
      "Candidate produced no successful responses.",
      "Candidate error rate was 100.0%, exceeding the allowed 1.0%.",
    ]);
  });

  it("handles a zero baseline p95 without non-finite output", () => {
    const result = evaluatePerformance(metrics(0), metrics(1), config);

    expect(result.passed).toBe(false);
    expect(result.p95RegressionPercent).toBeNull();
    expect(result.reasons).toContain(
      "Candidate p95 latency could not be compared because baseline p95 latency was zero.",
    );
  });

  it("treats two zero p95 measurements as zero regression", () => {
    expect(evaluatePerformance(metrics(0), metrics(0), config)).toEqual({
      passed: true,
      p95RegressionPercent: 0,
      reasons: [],
    });
  });

  it("keeps regression null when latency metrics are unavailable", () => {
    const result = evaluatePerformance(metrics(null), metrics(null), {
      ...config,
      maxErrorRatePercent: 100,
    });

    expect(result.p95RegressionPercent).toBeNull();
    expect(Number.isFinite(result.p95RegressionPercent)).toBe(false);
  });
});
