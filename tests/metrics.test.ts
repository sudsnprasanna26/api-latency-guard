import { describe, expect, it } from "vitest";

import { calculateMetrics, percentile } from "../src/metrics.js";
import type { BenchmarkResult, RequestResult } from "../src/types.js";

function request(durationMs: number, ok = true): RequestResult {
  return {
    durationMs,
    status: ok ? 200 : 500,
    ok,
    ...(ok ? {} : { error: "http_500" }),
  };
}

function benchmark(
  requestResults: RequestResult[],
  totalDurationMs = 1_000,
  requestedCount = requestResults.length,
): BenchmarkResult {
  const successCount = requestResults.filter((result) => result.ok).length;

  return {
    requestedCount,
    successCount,
    errorCount: requestedCount - successCount,
    totalDurationMs,
    requestResults,
  };
}

describe("percentile", () => {
  it("returns null for empty input", () => {
    expect(percentile([], 0.95)).toBeNull();
  });

  it("returns the only value in a one-value sample", () => {
    expect(percentile([42], 0.5)).toBe(42);
  });

  it("sorts unsorted values numerically", () => {
    expect(percentile([100, 2, 30, 4], 0.5)).toBe(4);
  });

  it("calculates p50 for an odd sample", () => {
    expect(percentile([5, 1, 3], 0.5)).toBe(3);
  });

  it("uses nearest rank for p50 on an even sample", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2);
  });

  it("calculates p95 for a fixed sample", () => {
    expect(percentile(Array.from({ length: 20 }, (_, index) => index + 1), 0.95)).toBe(19);
  });

  it("does not mutate the input array", () => {
    const values = [9, 1, 5];

    percentile(values, 0.5);

    expect(values).toEqual([9, 1, 5]);
  });
});

describe("calculateMetrics", () => {
  it("calculates latency, throughput, and counts for successful requests", () => {
    const metrics = calculateMetrics(benchmark([request(10), request(20), request(30)], 500));

    expect(metrics).toEqual({
      p50Ms: 20,
      p95Ms: 30,
      averageMs: 20,
      throughputPerSecond: 6,
      errorRatePercent: 0,
      successCount: 3,
      errorCount: 0,
    });
  });

  it("calculates mixed success and failure metrics", () => {
    const metrics = calculateMetrics(
      benchmark([request(10), request(999, false), request(30), request(888, false)]),
    );

    expect(metrics.p50Ms).toBe(10);
    expect(metrics.p95Ms).toBe(30);
    expect(metrics.averageMs).toBe(20);
    expect(metrics.successCount).toBe(2);
    expect(metrics.errorCount).toBe(2);
  });

  it("returns null latency metrics when no request succeeds", () => {
    const metrics = calculateMetrics(benchmark([request(10, false), request(20, false)]));

    expect(metrics.p50Ms).toBeNull();
    expect(metrics.p95Ms).toBeNull();
    expect(metrics.averageMs).toBeNull();
  });

  it("calculates error rate from every requested measurement", () => {
    const metrics = calculateMetrics(benchmark([request(10), request(20, false)], 100, 4));

    expect(metrics.errorRatePercent).toBe(75);
  });

  it("calculates throughput from completed results and wall-clock duration", () => {
    const metrics = calculateMetrics(benchmark([request(10), request(10), request(10)], 250));

    expect(metrics.throughputPerSecond).toBe(12);
  });

  it("returns zero throughput when total duration is zero", () => {
    expect(calculateMetrics(benchmark([request(0)], 0)).throughputPerSecond).toBe(0);
  });

  it("excludes failed-request latency from every latency metric", () => {
    const metrics = calculateMetrics(
      benchmark([request(10), request(20), request(100_000, false)]),
    );

    expect(metrics.p50Ms).toBe(10);
    expect(metrics.p95Ms).toBe(20);
    expect(metrics.averageMs).toBe(15);
  });
});
