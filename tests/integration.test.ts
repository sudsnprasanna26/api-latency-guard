import type { Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildTargetUrl, runBenchmark, runWarmup } from "../src/benchmark.js";
import { evaluatePerformance } from "../src/evaluate.js";
import { calculateMetrics } from "../src/metrics.js";
import { writeJsonReport } from "../src/report.js";
import type { BenchmarkConfig, PerformanceReport } from "../src/types.js";
import { createDemoServer, type DemoServerOptions } from "../demo/server.js";

interface RunningServer {
  baseUrl: string;
  close: () => Promise<void>;
}

const temporaryDirectories: string[] = [];

async function listen(options: Omit<DemoServerOptions, "port">): Promise<RunningServer> {
  const server: Server = createDemoServer({ port: 0, ...options });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Integration server did not receive a TCP port.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function config(
  baselineUrl: string,
  candidateUrl: string,
  overrides: Partial<BenchmarkConfig> = {},
): BenchmarkConfig {
  return {
    baselineUrl,
    candidateUrl,
    endpoint: "/api/test",
    requests: 4,
    concurrency: 2,
    warmupRequests: 1,
    requestTimeoutMs: 1_000,
    maxP95RegressionPercent: 100,
    maxErrorRatePercent: 1,
    headers: {},
    ...overrides,
  };
}

async function compare(benchmarkConfig: BenchmarkConfig): Promise<PerformanceReport> {
  const baselineTarget = buildTargetUrl(
    benchmarkConfig.baselineUrl,
    benchmarkConfig.endpoint,
  );
  const candidateTarget = buildTargetUrl(
    benchmarkConfig.candidateUrl,
    benchmarkConfig.endpoint,
  );

  await runWarmup(baselineTarget, benchmarkConfig);
  const baseline = calculateMetrics(await runBenchmark(baselineTarget, benchmarkConfig));
  await runWarmup(candidateTarget, benchmarkConfig);
  const candidate = calculateMetrics(await runBenchmark(candidateTarget, benchmarkConfig));
  const evaluation = evaluatePerformance(baseline, candidate, benchmarkConfig);

  return {
    generatedAt: new Date().toISOString(),
    config: {
      baselineUrl: benchmarkConfig.baselineUrl,
      candidateUrl: benchmarkConfig.candidateUrl,
      endpoint: benchmarkConfig.endpoint,
      requests: benchmarkConfig.requests,
      concurrency: benchmarkConfig.concurrency,
      warmupRequests: benchmarkConfig.warmupRequests,
      requestTimeoutMs: benchmarkConfig.requestTimeoutMs,
      maxP95RegressionPercent: benchmarkConfig.maxP95RegressionPercent,
      maxErrorRatePercent: benchmarkConfig.maxErrorRatePercent,
    },
    baseline,
    candidate,
    evaluation,
  };
}

async function closeAll(...servers: RunningServer[]): Promise<void> {
  await Promise.all(servers.map((server) => server.close()));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("local end-to-end comparison", () => {
  it("serves health checks and rejects unsupported methods", async () => {
    const server = await listen({ delayMs: 100, errorRatePercent: 0 });

    try {
      const health = await fetch(`${server.baseUrl}/health`);
      const unsupportedMethod = await fetch(`${server.baseUrl}/api/test`, { method: "POST" });

      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });
      expect(unsupportedMethod.status).toBe(405);
    } finally {
      await server.close();
    }
  });

  it("passes a similar-speed candidate", async () => {
    const baselineServer = await listen({ delayMs: 20, errorRatePercent: 0 });
    const candidateServer = await listen({ delayMs: 25, errorRatePercent: 0 });

    try {
      const report = await compare(config(baselineServer.baseUrl, candidateServer.baseUrl));

      expect(report.evaluation.passed).toBe(true);
      expect(report.baseline.successCount).toBe(4);
      expect(report.candidate.successCount).toBe(4);
    } finally {
      await closeAll(baselineServer, candidateServer);
    }
  });

  it("fails a substantially slower candidate", async () => {
    const baselineServer = await listen({ delayMs: 15, errorRatePercent: 0 });
    const candidateServer = await listen({ delayMs: 90, errorRatePercent: 0 });

    try {
      const report = await compare(
        config(baselineServer.baseUrl, candidateServer.baseUrl, {
          maxP95RegressionPercent: 100,
        }),
      );

      expect(report.evaluation.passed).toBe(false);
      expect(report.evaluation.reasons).toEqual(
        expect.arrayContaining([expect.stringContaining("p95 latency regressed")]),
      );
      expect(report.candidate.p95Ms).toBeGreaterThan((report.baseline.p95Ms ?? 0) * 2);
    } finally {
      await closeAll(baselineServer, candidateServer);
    }
  });

  it("fails a high-error candidate", async () => {
    const baselineServer = await listen({ delayMs: 5, errorRatePercent: 0 });
    const candidateServer = await listen({ delayMs: 5, errorRatePercent: 100 });

    try {
      const report = await compare(config(baselineServer.baseUrl, candidateServer.baseUrl));

      expect(report.evaluation.passed).toBe(false);
      expect(report.candidate.errorRatePercent).toBe(100);
      expect(report.candidate.successCount).toBe(0);
      expect(report.evaluation.reasons).toEqual(
        expect.arrayContaining([
          "Candidate produced no successful responses.",
          expect.stringContaining("Candidate error rate was 100.0%"),
        ]),
      );
    } finally {
      await closeAll(baselineServer, candidateServer);
    }
  });

  it("fails a timed-out candidate through metrics and evaluation", async () => {
    const baselineServer = await listen({ delayMs: 5, errorRatePercent: 0 });
    const candidateServer = await listen({ delayMs: 250, errorRatePercent: 0 });

    try {
      const report = await compare(
        config(baselineServer.baseUrl, candidateServer.baseUrl, {
          requestTimeoutMs: 100,
        }),
      );

      expect(report.evaluation.passed).toBe(false);
      expect(report.candidate.errorRatePercent).toBe(100);
      expect(report.candidate.p95Ms).toBeNull();
      expect(report.evaluation.reasons).toContain(
        "Candidate produced no successful responses.",
      );
    } finally {
      await closeAll(baselineServer, candidateServer);
    }
  });

  it("writes a parseable JSON report from an end-to-end run", async () => {
    const baselineServer = await listen({ delayMs: 5, errorRatePercent: 0 });
    const candidateServer = await listen({ delayMs: 8, errorRatePercent: 0 });
    const directory = await mkdtemp(join(tmpdir(), "api-latency-guard-integration-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "report.json");

    try {
      const report = await compare(config(baselineServer.baseUrl, candidateServer.baseUrl));
      await writeJsonReport(report, outputPath);
      const parsed = JSON.parse(await readFile(outputPath, "utf8")) as PerformanceReport;

      expect(parsed.evaluation.passed).toBe(true);
      expect(parsed.baseline.successCount).toBe(4);
      expect(parsed.candidate.successCount).toBe(4);
      expect(parsed.config).not.toHaveProperty("headers");
    } finally {
      await closeAll(baselineServer, candidateServer);
    }
  });
});
