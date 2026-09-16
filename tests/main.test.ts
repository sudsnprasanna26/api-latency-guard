import { describe, expect, it, vi } from "vitest";

import {
  getSafeErrorMessage,
  runAction,
  type ActionDependencies,
} from "../src/main.js";
import type {
  BenchmarkConfig,
  BenchmarkMetrics,
  BenchmarkResult,
  EvaluationResult,
  PerformanceReport,
} from "../src/types.js";

const benchmarkConfig: BenchmarkConfig = {
  baselineUrl: "https://baseline.example.com",
  candidateUrl: "https://candidate.example.com",
  endpoint: "/api/test",
  requests: 2,
  concurrency: 1,
  warmupRequests: 1,
  requestTimeoutMs: 1_000,
  maxP95RegressionPercent: 20,
  maxErrorRatePercent: 1,
  headers: { Authorization: "Bearer secret-test-value" },
};

const baselineResult: BenchmarkResult = {
  requestedCount: 2,
  successCount: 2,
  errorCount: 0,
  totalDurationMs: 20,
  requestResults: [
    { durationMs: 10, status: 200, ok: true },
    { durationMs: 10, status: 200, ok: true },
  ],
};

const candidateResult: BenchmarkResult = {
  ...baselineResult,
  totalDurationMs: 22,
  requestResults: [
    { durationMs: 11, status: 200, ok: true },
    { durationMs: 11, status: 200, ok: true },
  ],
};

const baselineMetrics: BenchmarkMetrics = {
  p50Ms: 10,
  p95Ms: 10,
  averageMs: 10,
  throughputPerSecond: 100,
  errorRatePercent: 0,
  successCount: 2,
  errorCount: 0,
};

const candidateMetrics: BenchmarkMetrics = {
  ...baselineMetrics,
  p50Ms: 11,
  p95Ms: 11,
  averageMs: 11,
};

const passingEvaluation: EvaluationResult = {
  passed: true,
  p95RegressionPercent: 10,
  reasons: [],
};

interface DependencyHarness {
  dependencies: ActionDependencies;
  events: string[];
  outputs: Map<string, string>;
  reports: PerformanceReport[];
}

function createHarness(evaluation = passingEvaluation): DependencyHarness {
  const events: string[] = [];
  const outputs = new Map<string, string>();
  const reports: PerformanceReport[] = [];

  const dependencies: ActionDependencies = {
    readConfig: () => benchmarkConfig,
    buildTargetUrl: (baseUrl, endpoint) => `${baseUrl}${endpoint}`,
    runWarmup: async (url) => {
      events.push(`warmup:${url}`);
    },
    runBenchmark: async (url) => {
      events.push(`benchmark-start:${url}`);
      await Promise.resolve();
      events.push(`benchmark-end:${url}`);
      return url.includes("baseline") ? baselineResult : candidateResult;
    },
    calculateMetrics: (result) =>
      result === baselineResult ? baselineMetrics : candidateMetrics,
    evaluatePerformance: () => evaluation,
    createMarkdownReport: (report) => {
      events.push("create-markdown");
      reports.push(report);
      return "generated markdown";
    },
    writeJsonReport: async (report) => {
      events.push("write-json");
      reports.push(report);
      return "api-latency-guard-report.json";
    },
    info: (message) => events.push(`info:${message}`),
    appendSummary: async () => {
      events.push("append-summary");
    },
    setOutput: (name, value) => {
      events.push(`output:${name}`);
      outputs.set(name, value);
    },
    setFailed: (message) => events.push(`failed:${message}`),
    now: () => new Date("2026-09-16T00:00:00.000Z"),
  };

  return { dependencies, events, outputs, reports };
}

describe("runAction", () => {
  it("runs baseline and candidate work in the required sequence", async () => {
    const { dependencies, events } = createHarness();

    await runAction(dependencies);

    expect(events).toEqual(
      expect.arrayContaining([
        "warmup:https://baseline.example.com/api/test",
        "benchmark-start:https://baseline.example.com/api/test",
        "benchmark-end:https://baseline.example.com/api/test",
        "warmup:https://candidate.example.com/api/test",
        "benchmark-start:https://candidate.example.com/api/test",
        "benchmark-end:https://candidate.example.com/api/test",
      ]),
    );
    expect(events.indexOf("warmup:https://baseline.example.com/api/test")).toBeLessThan(
      events.indexOf("benchmark-start:https://baseline.example.com/api/test"),
    );
    expect(events.indexOf("benchmark-end:https://baseline.example.com/api/test")).toBeLessThan(
      events.indexOf("warmup:https://candidate.example.com/api/test"),
    );
    expect(events.indexOf("warmup:https://candidate.example.com/api/test")).toBeLessThan(
      events.indexOf("benchmark-start:https://candidate.example.com/api/test"),
    );
  });

  it("produces reports and every output for a passing result", async () => {
    const { dependencies, events, outputs } = createHarness();

    await runAction(dependencies);

    expect(events).toContain("create-markdown");
    expect(events).toContain("write-json");
    expect(events).toContain("append-summary");
    expect(outputs).toEqual(
      new Map([
        ["result", "pass"],
        ["baseline-p95-ms", "10"],
        ["candidate-p95-ms", "11"],
        ["p95-regression-percent", "10"],
        ["baseline-error-rate-percent", "0"],
        ["candidate-error-rate-percent", "0"],
        ["report-path", "api-latency-guard-report.json"],
      ]),
    );
    expect(events.some((event) => event.startsWith("failed:"))).toBe(false);
  });

  it("writes reports and outputs before signaling failure", async () => {
    const { dependencies, events, outputs } = createHarness({
      passed: false,
      p95RegressionPercent: 50,
      reasons: ["Candidate exceeded the threshold."],
    });

    await runAction(dependencies);

    const failureIndex = events.indexOf("failed:Candidate exceeded the threshold.");
    expect(outputs.get("result")).toBe("fail");
    expect(events.indexOf("write-json")).toBeLessThan(failureIndex);
    expect(events.indexOf("append-summary")).toBeLessThan(failureIndex);
    expect(events.indexOf("output:report-path")).toBeLessThan(failureIndex);
  });

  it("uses empty strings for unavailable numeric outputs", async () => {
    const { dependencies, outputs } = createHarness({
      passed: false,
      p95RegressionPercent: null,
      reasons: ["Measurements unavailable."],
    });
    dependencies.calculateMetrics = vi
      .fn()
      .mockReturnValue({ ...baselineMetrics, p95Ms: null });

    await runAction(dependencies);

    expect(outputs.get("baseline-p95-ms")).toBe("");
    expect(outputs.get("candidate-p95-ms")).toBe("");
    expect(outputs.get("p95-regression-percent")).toBe("");
  });

  it("never includes secret headers in report objects", async () => {
    const { dependencies, reports } = createHarness();

    await runAction(dependencies);

    expect(reports).toHaveLength(2);
    for (const report of reports) {
      expect(report.config).not.toHaveProperty("headers");
      expect(JSON.stringify(report)).not.toContain("secret-test-value");
    }
  });
});

describe("getSafeErrorMessage", () => {
  it("uses an error message without its stack or line breaks", () => {
    const error = new Error("Safe failure\ninternal detail");
    error.stack = "sensitive stack";

    expect(getSafeErrorMessage(error)).toBe("Safe failure internal detail");
    expect(getSafeErrorMessage(error)).not.toContain("sensitive stack");
  });

  it("uses a generic message for unknown thrown values", () => {
    expect(getSafeErrorMessage({ secret: "do-not-print" })).toBe(
      "API Latency Guard failed unexpectedly.",
    );
  });
});
