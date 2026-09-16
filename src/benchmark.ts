import { performance } from "node:perf_hooks";

import type { BenchmarkConfig, BenchmarkResult, RequestResult } from "./types.js";

export function buildTargetUrl(baseUrl: string, endpoint: string): string {
  const target = new URL(baseUrl);
  const endpointUrl = new URL(endpoint, "http://endpoint.invalid");
  const basePath = target.pathname.replace(/\/+$/, "");
  const endpointPath = endpointUrl.pathname.replace(/^\/+/, "");

  target.pathname = `${basePath}/${endpointPath}`;
  target.search = endpointUrl.search;
  target.hash = endpointUrl.hash;

  return target.toString();
}

function elapsedMilliseconds(startTime: number): number {
  const durationMs = performance.now() - startTime;
  return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
}

export async function runSingleRequest(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<RequestResult> {
  const startTime = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    await response.arrayBuffer();

    const ok = response.status >= 200 && response.status <= 399;
    return {
      durationMs: elapsedMilliseconds(startTime),
      status: response.status,
      ok,
      ...(ok ? {} : { error: `http_${response.status}` }),
    };
  } catch {
    return {
      durationMs: elapsedMilliseconds(startTime),
      status: null,
      ok: false,
      error: timedOut ? "timeout" : "network_error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runRequestPool(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  requestCount: number,
  concurrency: number,
): Promise<RequestResult[]> {
  if (requestCount === 0) {
    return [];
  }

  const results: RequestResult[] = [];
  let nextRequestIndex = 0;

  async function worker(): Promise<void> {
    while (nextRequestIndex < requestCount) {
      nextRequestIndex += 1;
      results.push(await runSingleRequest(url, headers, timeoutMs));
    }
  }

  const workerCount = Math.min(concurrency, requestCount);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

export async function runWarmup(url: string, config: BenchmarkConfig): Promise<void> {
  await runRequestPool(
    url,
    config.headers,
    config.requestTimeoutMs,
    config.warmupRequests,
    config.concurrency,
  );
}

export async function runBenchmark(
  url: string,
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const startTime = performance.now();
  const requestResults = await runRequestPool(
    url,
    config.headers,
    config.requestTimeoutMs,
    config.requests,
    config.concurrency,
  );
  const totalDurationMs = elapsedMilliseconds(startTime);
  const successCount = requestResults.filter((result) => result.ok).length;

  return {
    requestedCount: config.requests,
    successCount,
    errorCount: requestResults.length - successCount,
    totalDurationMs,
    requestResults,
  };
}
