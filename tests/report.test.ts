import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createMarkdownReport,
  formatNumber,
  writeJsonReport,
} from "../src/report.js";
import type { BenchmarkMetrics, PerformanceReport } from "../src/types.js";

const temporaryDirectories: string[] = [];

function metrics(overrides: Partial<BenchmarkMetrics> = {}): BenchmarkMetrics {
  return {
    p50Ms: 40,
    p95Ms: 60,
    averageMs: 45,
    throughputPerSecond: 90,
    errorRatePercent: 0,
    successCount: 50,
    errorCount: 0,
    ...overrides,
  };
}

function performanceReport(overrides: Partial<PerformanceReport> = {}): PerformanceReport {
  return {
    generatedAt: "2026-09-16T00:00:00.000Z",
    config: {
      baselineUrl: "https://api.example.com",
      candidateUrl: "https://preview.example.com",
      endpoint: "/api/test",
      requests: 50,
      concurrency: 5,
      warmupRequests: 5,
      requestTimeoutMs: 5_000,
      maxP95RegressionPercent: 20,
      maxErrorRatePercent: 1,
    },
    baseline: metrics(),
    candidate: metrics({ p50Ms: 45, p95Ms: 66, averageMs: 50, throughputPerSecond: 85 }),
    evaluation: {
      passed: true,
      p95RegressionPercent: 10,
      reasons: [],
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("formatNumber", () => {
  it("formats finite numbers with the requested precision", () => {
    expect(formatNumber(12.3456)).toBe("12.35");
    expect(formatNumber(12.3456, 1)).toBe("12.3");
  });

  it.each([null, Number.NaN, Number.POSITIVE_INFINITY])(
    "renders unavailable value %s as N/A",
    (value) => {
      expect(formatNumber(value)).toBe("N/A");
    },
  );
});

describe("createMarkdownReport", () => {
  it("creates a complete passing report", () => {
    const markdown = createMarkdownReport(performanceReport());

    expect(markdown).toContain("# API Latency Guard");
    expect(markdown).toContain("**Result:** ✅ Pass");
    expect(markdown).toContain("`https://api.example.com`");
    expect(markdown).toContain("`https://preview.example.com`");
    expect(markdown).toContain("| p95 latency | 60.00 ms | 66.00 ms | 10.00% regression |");
  });

  it("creates a failing report with every reason", () => {
    const markdown = createMarkdownReport(
      performanceReport({
        evaluation: {
          passed: false,
          p95RegressionPercent: 50,
          reasons: ["Latency threshold exceeded.", "Error threshold exceeded."],
        },
      }),
    );

    expect(markdown).toContain("**Result:** ❌ Fail");
    expect(markdown).toContain("- Latency threshold exceeded.");
    expect(markdown).toContain("- Error threshold exceeded.");
  });

  it("renders null latency values as N/A", () => {
    const markdown = createMarkdownReport(
      performanceReport({
        candidate: metrics({ p50Ms: null, p95Ms: null, averageMs: null }),
        evaluation: { passed: false, p95RegressionPercent: null, reasons: [] },
      }),
    );

    expect(markdown).toContain("| p50 latency | 40.00 ms | N/A | N/A |");
    expect(markdown).toContain("| p95 latency | 60.00 ms | N/A | N/A regression |");
    expect(markdown).not.toMatch(/null|NaN|Infinity/);
  });

  it("renders negative regression without hiding the sign", () => {
    const markdown = createMarkdownReport(
      performanceReport({
        candidate: metrics({ p95Ms: 54 }),
        evaluation: { passed: true, p95RegressionPercent: -10, reasons: [] },
      }),
    );

    expect(markdown).toContain("-10.00% regression");
  });

  it("includes the required limitations disclaimer", () => {
    expect(createMarkdownReport(performanceReport())).toContain(
      "> Results reflect this CI runner and workload and are intended for regression detection, not production capacity planning.",
    );
  });
});

describe("writeJsonReport", () => {
  it("creates parseable formatted JSON and returns its path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "api-latency-guard-report-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "report.json");

    const returnedPath = await writeJsonReport(performanceReport(), outputPath);
    const contents = await readFile(outputPath, "utf8");

    expect(returnedPath).toBe(outputPath);
    expect(contents.endsWith("\n")).toBe(true);
    expect(JSON.parse(contents)).toEqual(performanceReport());
  });

  it("strips headers and undeclared raw request data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "api-latency-guard-report-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "report.json");
    const report = performanceReport() as PerformanceReport & {
      config: PerformanceReport["config"] & { headers: Record<string, string> };
      requestResults: unknown[];
    };
    report.config.headers = { Authorization: "Bearer secret-value" };
    report.requestResults = [{ body: "private-response" }];

    await writeJsonReport(report, outputPath);
    const contents = await readFile(outputPath, "utf8");

    expect(contents).not.toContain("headers");
    expect(contents).not.toContain("secret-value");
    expect(contents).not.toContain("requestResults");
    expect(contents).not.toContain("private-response");
  });
});
