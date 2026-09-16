import * as core from "@actions/core";

import { buildTargetUrl, runBenchmark, runWarmup } from "./benchmark.js";
import { readConfig } from "./config.js";
import { evaluatePerformance } from "./evaluate.js";
import { calculateMetrics } from "./metrics.js";
import { createMarkdownReport, writeJsonReport } from "./report.js";
import type { PerformanceReport } from "./types.js";

export interface ActionDependencies {
  readConfig: typeof readConfig;
  buildTargetUrl: typeof buildTargetUrl;
  runWarmup: typeof runWarmup;
  runBenchmark: typeof runBenchmark;
  calculateMetrics: typeof calculateMetrics;
  evaluatePerformance: typeof evaluatePerformance;
  createMarkdownReport: typeof createMarkdownReport;
  writeJsonReport: typeof writeJsonReport;
  info: (message: string) => void;
  appendSummary: (markdown: string) => Promise<void>;
  setOutput: (name: string, value: string) => void;
  setFailed: (message: string) => void;
  now: () => Date;
}

const defaultDependencies: ActionDependencies = {
  readConfig,
  buildTargetUrl,
  runWarmup,
  runBenchmark,
  calculateMetrics,
  evaluatePerformance,
  createMarkdownReport,
  writeJsonReport,
  info: core.info,
  appendSummary: async (markdown) => {
    await core.summary.addRaw(markdown).write();
  },
  setOutput: core.setOutput,
  setFailed: core.setFailed,
  now: () => new Date(),
};

function numericOutput(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "" : String(value);
}

export function getSafeErrorMessage(error: unknown): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return "API Latency Guard failed unexpectedly.";
  }

  return error.message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

export async function runAction(dependencies: ActionDependencies): Promise<void> {
  const config = dependencies.readConfig();
  const baselineTarget = dependencies.buildTargetUrl(config.baselineUrl, config.endpoint);
  const candidateTarget = dependencies.buildTargetUrl(config.candidateUrl, config.endpoint);

  dependencies.info("Starting API Latency Guard.");
  dependencies.info("Benchmarking baseline target...");
  await dependencies.runWarmup(baselineTarget, config);
  const baselineResult = await dependencies.runBenchmark(baselineTarget, config);
  const baselineMetrics = dependencies.calculateMetrics(baselineResult);

  dependencies.info("Benchmarking candidate target...");
  await dependencies.runWarmup(candidateTarget, config);
  const candidateResult = await dependencies.runBenchmark(candidateTarget, config);
  const candidateMetrics = dependencies.calculateMetrics(candidateResult);
  const evaluation = dependencies.evaluatePerformance(
    baselineMetrics,
    candidateMetrics,
    config,
  );

  const report: PerformanceReport = {
    generatedAt: dependencies.now().toISOString(),
    config: {
      baselineUrl: config.baselineUrl,
      candidateUrl: config.candidateUrl,
      endpoint: config.endpoint,
      requests: config.requests,
      concurrency: config.concurrency,
      warmupRequests: config.warmupRequests,
      requestTimeoutMs: config.requestTimeoutMs,
      maxP95RegressionPercent: config.maxP95RegressionPercent,
      maxErrorRatePercent: config.maxErrorRatePercent,
    },
    baseline: baselineMetrics,
    candidate: candidateMetrics,
    evaluation,
  };

  dependencies.info("Writing performance report...");
  const markdown = dependencies.createMarkdownReport(report);
  const reportPath = await dependencies.writeJsonReport(report);
  await dependencies.appendSummary(markdown);

  dependencies.setOutput("result", evaluation.passed ? "pass" : "fail");
  dependencies.setOutput("baseline-p95-ms", numericOutput(baselineMetrics.p95Ms));
  dependencies.setOutput("candidate-p95-ms", numericOutput(candidateMetrics.p95Ms));
  dependencies.setOutput(
    "p95-regression-percent",
    numericOutput(evaluation.p95RegressionPercent),
  );
  dependencies.setOutput(
    "baseline-error-rate-percent",
    numericOutput(baselineMetrics.errorRatePercent),
  );
  dependencies.setOutput(
    "candidate-error-rate-percent",
    numericOutput(candidateMetrics.errorRatePercent),
  );
  dependencies.setOutput("report-path", reportPath);

  if (!evaluation.passed) {
    dependencies.setFailed(evaluation.reasons.join(" ") || "Performance thresholds failed.");
  }
}

export async function run(): Promise<void> {
  await runAction(defaultDependencies);
}
