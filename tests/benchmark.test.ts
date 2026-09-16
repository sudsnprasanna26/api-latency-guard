import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  buildTargetUrl,
  runBenchmark,
  runSingleRequest,
  runWarmup,
} from "../src/benchmark.js";
import type { BenchmarkConfig } from "../src/types.js";

type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

interface TestServer {
  url: string;
  close: () => Promise<void>;
}

async function startServer(handler: RequestHandler): Promise<TestServer> {
  const server = createServer((request, response) => {
    void Promise.resolve(handler(request, response)).catch(() => {
      response.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Test server did not receive a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function config(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return {
    baselineUrl: "http://127.0.0.1",
    candidateUrl: "http://127.0.0.1",
    endpoint: "/",
    requests: 4,
    concurrency: 2,
    warmupRequests: 2,
    requestTimeoutMs: 1_000,
    maxP95RegressionPercent: 20,
    maxErrorRatePercent: 1,
    headers: {},
    ...overrides,
  };
}

describe("buildTargetUrl", () => {
  it("joins an endpoint to a root base URL", () => {
    expect(buildTargetUrl("https://api.example.com", "/health")).toBe(
      "https://api.example.com/health",
    );
  });

  it("preserves an existing base path", () => {
    expect(buildTargetUrl("https://api.example.com/v1", "/users")).toBe(
      "https://api.example.com/v1/users",
    );
  });

  it("preserves endpoint query parameters", () => {
    expect(buildTargetUrl("https://api.example.com/v1/", "/users?limit=1")).toBe(
      "https://api.example.com/v1/users?limit=1",
    );
  });
});

describe("runSingleRequest", () => {
  it("returns a successful result", async () => {
    const server = await startServer((_request, response) => {
      response.end("ok");
    });

    try {
      const result = await runSingleRequest(server.url, {}, 1_000);

      expect(result.status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.error).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("sends custom headers to the server", async () => {
    let observedHeader: string | undefined;
    const server = await startServer((request, response) => {
      observedHeader = request.headers["x-latency-test"] as string | undefined;
      response.end("ok");
    });

    try {
      await runSingleRequest(server.url, { "X-Latency-Test": "safe-test-value" }, 1_000);
      expect(observedHeader).toBe("safe-test-value");
    } finally {
      await server.close();
    }
  });

  it("considers HTTP 302 successful", async () => {
    const server = await startServer((_request, response) => {
      response.writeHead(302);
      response.end();
    });

    try {
      expect(await runSingleRequest(server.url, {}, 1_000)).toMatchObject({
        status: 302,
        ok: true,
      });
    } finally {
      await server.close();
    }
  });

  it.each([404, 500])("converts HTTP %s into an error result", async (status) => {
    const server = await startServer((_request, response) => {
      response.writeHead(status);
      response.end("discarded");
    });

    try {
      expect(await runSingleRequest(server.url, {}, 1_000)).toMatchObject({
        status,
        ok: false,
        error: `http_${status}`,
      });
    } finally {
      await server.close();
    }
  });

  it("captures request timeouts", async () => {
    const server = await startServer(() => undefined);

    try {
      expect(await runSingleRequest(server.url, {}, 25)).toMatchObject({
        status: null,
        ok: false,
        error: "timeout",
      });
    } finally {
      await server.close();
    }
  });

  it("captures connection failures", async () => {
    const server = await startServer((_request, response) => {
      response.end();
    });
    const unavailableUrl = server.url;
    await server.close();

    expect(await runSingleRequest(unavailableUrl, {}, 1_000)).toMatchObject({
      status: null,
      ok: false,
      error: "network_error",
    });
  });

  it("waits until the response body has been consumed", async () => {
    let releaseBody!: () => void;
    let markRequestStarted!: () => void;
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const server = await startServer(async (_request, response) => {
      response.writeHead(200);
      response.write("partial");
      markRequestStarted();
      await bodyGate;
      response.end("complete");
    });

    try {
      let settled = false;
      const pendingRequest = runSingleRequest(server.url, {}, 1_000).then((result) => {
        settled = true;
        return result;
      });

      await requestStarted;
      await Promise.resolve();
      expect(settled).toBe(false);

      releaseBody();
      expect((await pendingRequest).ok).toBe(true);
    } finally {
      releaseBody();
      await server.close();
    }
  });
});

describe("runBenchmark", () => {
  it("executes the exact measured request count", async () => {
    let requestCount = 0;
    const server = await startServer((_request, response) => {
      requestCount += 1;
      response.end("ok");
    });

    try {
      const result = await runBenchmark(server.url, config({ requests: 7, concurrency: 3 }));

      expect(requestCount).toBe(7);
      expect(result.requestedCount).toBe(7);
      expect(result.requestResults).toHaveLength(7);
    } finally {
      await server.close();
    }
  });

  it("returns finite non-negative durations", async () => {
    const server = await startServer((_request, response) => {
      response.end("ok");
    });

    try {
      const result = await runBenchmark(server.url, config());

      for (const requestResult of result.requestResults) {
        expect(Number.isFinite(requestResult.durationMs)).toBe(true);
        expect(requestResult.durationMs).toBeGreaterThanOrEqual(0);
      }
    } finally {
      await server.close();
    }
  });

  it("counts failed requests without rejecting the benchmark", async () => {
    let requestCount = 0;
    const server = await startServer((_request, response) => {
      requestCount += 1;
      response.writeHead(requestCount === 2 ? 500 : 200);
      response.end();
    });

    try {
      const result = await runBenchmark(server.url, config({ requests: 3 }));

      expect(result.requestResults).toHaveLength(3);
      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("never exceeds configured concurrency", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const server = await startServer(async (_request, response) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      response.end("ok");
      activeRequests -= 1;
    });

    try {
      await runBenchmark(server.url, config({ requests: 9, concurrency: 3 }));
      expect(maximumActiveRequests).toBeLessThanOrEqual(3);
    } finally {
      await server.close();
    }
  });

  it("allows requests to overlap when concurrency is greater than one", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    let releaseRequests!: () => void;
    const requestGate = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    const server = await startServer(async (_request, response) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      if (activeRequests === 2) {
        releaseRequests();
      }
      await requestGate;
      response.end("ok");
      activeRequests -= 1;
    });

    try {
      await runBenchmark(server.url, config({ requests: 2, concurrency: 2 }));
      expect(maximumActiveRequests).toBe(2);
    } finally {
      releaseRequests();
      await server.close();
    }
  });

  it("measures positive total wall-clock duration", async () => {
    const server = await startServer((_request, response) => {
      response.end("ok");
    });

    try {
      expect((await runBenchmark(server.url, config())).totalDurationMs).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});

describe("runWarmup", () => {
  it("executes the configured warmup count", async () => {
    let requestCount = 0;
    const server = await startServer((_request, response) => {
      requestCount += 1;
      response.end("ok");
    });

    try {
      await runWarmup(server.url, config({ warmupRequests: 3 }));
      expect(requestCount).toBe(3);
    } finally {
      await server.close();
    }
  });

  it("does not include warmups in measured results", async () => {
    let requestCount = 0;
    const server = await startServer((_request, response) => {
      requestCount += 1;
      response.end("ok");
    });

    try {
      const benchmarkConfig = config({ warmupRequests: 2, requests: 4 });
      await runWarmup(server.url, benchmarkConfig);
      const result = await runBenchmark(server.url, benchmarkConfig);

      expect(requestCount).toBe(6);
      expect(result.requestResults).toHaveLength(4);
    } finally {
      await server.close();
    }
  });

  it("returns immediately when warmup count is zero", async () => {
    await expect(
      runWarmup("http://127.0.0.1:1", config({ warmupRequests: 0 })),
    ).resolves.toBeUndefined();
  });

  it("continues after a failed warmup request", async () => {
    let requestCount = 0;
    const server = await startServer((_request, response) => {
      requestCount += 1;
      response.writeHead(requestCount === 1 ? 500 : 200);
      response.end();
    });

    try {
      await runWarmup(server.url, config({ warmupRequests: 3 }));
      expect(requestCount).toBe(3);
    } finally {
      await server.close();
    }
  });

  it("applies the concurrency cap to warmup requests", async () => {
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    const server = await startServer(async (_request, response) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 10));
      response.end();
      activeRequests -= 1;
    });

    try {
      await runWarmup(server.url, config({ concurrency: 2, warmupRequests: 6 }));
      expect(maximumActiveRequests).toBeLessThanOrEqual(2);
    } finally {
      await server.close();
    }
  });
});
