import { writeFile } from "node:fs/promises";

import type { BenchmarkMetrics, PerformanceReport } from "./types.js";

const defaultReportPath = "api-latency-guard-report.json";

export function formatNumber(value: number | null, decimals = 2): string {
  return value === null || !Number.isFinite(value) ? "N/A" : value.toFixed(decimals);
}

function formatUnit(value: number | null, unit: string): string {
  const formatted = formatNumber(value);
  return formatted === "N/A" ? formatted : `${formatted} ${unit}`;
}

function difference(candidate: number | null, baseline: number | null, unit: string): string {
  if (candidate === null || baseline === null) {
    return "N/A";
  }

  const value = candidate - baseline;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${formatNumber(value)} ${unit}`;
}

function codeValue(value: string): string {
  return value.replace(/[`\r\n]/g, " ");
}

function tableRow(
  label: string,
  baseline: string,
  candidate: string,
  result: string,
): string {
  return `| ${label} | ${baseline} | ${candidate} | ${result} |`;
}

export function createMarkdownReport(report: PerformanceReport): string {
  const { baseline, candidate, config, evaluation } = report;
  const resultLabel = evaluation.passed ? "✅ Pass" : "❌ Fail";
  const regression =
    evaluation.p95RegressionPercent === null
      ? "N/A"
      : `${formatNumber(evaluation.p95RegressionPercent)}%`;
  const lines = [
    "# API Latency Guard",
    "",
    `**Result:** ${resultLabel}`,
    "",
    `- Baseline target: \`${codeValue(config.baselineUrl)}\``,
    `- Candidate target: \`${codeValue(config.candidateUrl)}\``,
    `- Endpoint: \`${codeValue(config.endpoint)}\``,
    `- Measured requests: ${config.requests}`,
    `- Concurrency: ${config.concurrency}`,
    `- Warmup requests: ${config.warmupRequests}`,
    `- Request timeout: ${config.requestTimeoutMs} ms`,
    `- Maximum p95 regression: ${formatNumber(config.maxP95RegressionPercent)}%`,
    `- Maximum candidate error rate: ${formatNumber(config.maxErrorRatePercent)}%`,
    "",
    "| Metric | Baseline | Candidate | Difference / result |",
    "| --- | ---: | ---: | ---: |",
    tableRow(
      "p50 latency",
      formatUnit(baseline.p50Ms, "ms"),
      formatUnit(candidate.p50Ms, "ms"),
      difference(candidate.p50Ms, baseline.p50Ms, "ms"),
    ),
    tableRow(
      "p95 latency",
      formatUnit(baseline.p95Ms, "ms"),
      formatUnit(candidate.p95Ms, "ms"),
      `${regression} regression`,
    ),
    tableRow(
      "Average latency",
      formatUnit(baseline.averageMs, "ms"),
      formatUnit(candidate.averageMs, "ms"),
      difference(candidate.averageMs, baseline.averageMs, "ms"),
    ),
    tableRow(
      "Throughput",
      formatUnit(baseline.throughputPerSecond, "req/s"),
      formatUnit(candidate.throughputPerSecond, "req/s"),
      difference(candidate.throughputPerSecond, baseline.throughputPerSecond, "req/s"),
    ),
    tableRow(
      "Error rate",
      formatUnit(baseline.errorRatePercent, "%"),
      formatUnit(candidate.errorRatePercent, "%"),
      difference(candidate.errorRatePercent, baseline.errorRatePercent, "pp"),
    ),
    tableRow(
      "Successful requests",
      String(baseline.successCount),
      String(candidate.successCount),
      String(candidate.successCount - baseline.successCount),
    ),
    tableRow(
      "Failed requests",
      String(baseline.errorCount),
      String(candidate.errorCount),
      String(candidate.errorCount - baseline.errorCount),
    ),
  ];

  if (evaluation.reasons.length > 0) {
    lines.push("", "## Failure reasons", "");
    lines.push(...evaluation.reasons.map((reason) => `- ${reason}`));
  }

  lines.push(
    "",
    "> Results reflect this CI runner and workload and are intended for regression detection, not production capacity planning.",
    "",
  );

  return lines.join("\n");
}

function copyMetrics(metrics: BenchmarkMetrics): BenchmarkMetrics {
  return {
    p50Ms: metrics.p50Ms,
    p95Ms: metrics.p95Ms,
    averageMs: metrics.averageMs,
    throughputPerSecond: metrics.throughputPerSecond,
    errorRatePercent: metrics.errorRatePercent,
    successCount: metrics.successCount,
    errorCount: metrics.errorCount,
  };
}

function sanitizeReport(report: PerformanceReport): PerformanceReport {
  return {
    generatedAt: report.generatedAt,
    config: {
      baselineUrl: report.config.baselineUrl,
      candidateUrl: report.config.candidateUrl,
      endpoint: report.config.endpoint,
      requests: report.config.requests,
      concurrency: report.config.concurrency,
      warmupRequests: report.config.warmupRequests,
      requestTimeoutMs: report.config.requestTimeoutMs,
      maxP95RegressionPercent: report.config.maxP95RegressionPercent,
      maxErrorRatePercent: report.config.maxErrorRatePercent,
    },
    baseline: copyMetrics(report.baseline),
    candidate: copyMetrics(report.candidate),
    evaluation: {
      passed: report.evaluation.passed,
      p95RegressionPercent: report.evaluation.p95RegressionPercent,
      reasons: [...report.evaluation.reasons],
    },
  };
}

export async function writeJsonReport(
  report: PerformanceReport,
  outputPath = defaultReportPath,
): Promise<string> {
  await writeFile(outputPath, `${JSON.stringify(sanitizeReport(report), null, 2)}\n`, "utf8");
  return outputPath;
}
