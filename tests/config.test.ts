import { describe, expect, it } from "vitest";

import { parseConfig, type RawConfigInputs } from "../src/config.js";

const requiredInputs: RawConfigInputs = {
  "baseline-url": "https://baseline.example.com",
  "candidate-url": "https://candidate.example.com",
};

function parse(overrides: RawConfigInputs = {}) {
  return parseConfig({ ...requiredInputs, ...overrides });
}

describe("parseConfig", () => {
  it("parses a valid explicit configuration", () => {
    expect(
      parse({
        endpoint: "/api/items?limit=1",
        requests: "25",
        concurrency: "4",
        warmup: "2",
        timeout: "2500",
        "max-p95-regression": "12.5",
        "max-error-rate": "0.5",
        "headers-json": '{"Authorization":"Bearer test-token"}',
      }),
    ).toEqual({
      baselineUrl: "https://baseline.example.com",
      candidateUrl: "https://candidate.example.com",
      endpoint: "/api/items?limit=1",
      requests: 25,
      concurrency: 4,
      warmupRequests: 2,
      requestTimeoutMs: 2500,
      maxP95RegressionPercent: 12.5,
      maxErrorRatePercent: 0.5,
      headers: { Authorization: "Bearer test-token" },
    });
  });

  it("applies all optional defaults", () => {
    expect(parse()).toEqual({
      baselineUrl: "https://baseline.example.com",
      candidateUrl: "https://candidate.example.com",
      endpoint: "/",
      requests: 50,
      concurrency: 5,
      warmupRequests: 5,
      requestTimeoutMs: 5000,
      maxP95RegressionPercent: 20,
      maxErrorRatePercent: 1,
      headers: {},
    });
  });

  it.each([
    ["http URL", "http://baseline.example.com/", "http://baseline.example.com"],
    ["https URL", "https://baseline.example.com/", "https://baseline.example.com"],
    ["existing base path", "https://baseline.example.com/api/v1/", "https://baseline.example.com/api/v1"],
  ])("normalizes a %s", (_caseName, input, expected) => {
    expect(parse({ "baseline-url": input }).baselineUrl).toBe(expected);
  });

  it("preserves an endpoint query string", () => {
    expect(parse({ endpoint: "/health?verbose=true" }).endpoint).toBe(
      "/health?verbose=true",
    );
  });

  it.each(["baseline-url", "candidate-url"] as const)(
    "rejects a missing %s",
    (name) => {
      expect(() => parse({ [name]: "" })).toThrow(`Input "${name}" is required.`);
    },
  );

  it("rejects a malformed URL", () => {
    expect(() => parse({ "baseline-url": "not a url" })).toThrow(
      'Input "baseline-url" must be a valid URL.',
    );
  });

  it("rejects an unsupported URL protocol", () => {
    expect(() => parse({ "baseline-url": "ftp://baseline.example.com" })).toThrow(
      'Input "baseline-url" must use http or https.',
    );
  });

  it("rejects URL credentials without exposing them", () => {
    const secret = "do-not-print";

    expect(() =>
      parse({ "baseline-url": `https://user:${secret}@baseline.example.com` }),
    ).toThrow('Input "baseline-url" must not include credentials.');

    try {
      parse({ "baseline-url": `https://user:${secret}@baseline.example.com` });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each(["health", "//other.example.com/health"])(
    "rejects invalid endpoint %s",
    (endpoint) => {
      expect(() => parse({ endpoint })).toThrow(
        'Input "endpoint" must be a relative path beginning with "/".',
      );
    },
  );

  it.each(["1.5", "abc"])("rejects non-integer requests value %s", (requests) => {
    expect(() => parse({ requests })).toThrow(
      'Input "requests" must be an integer between 1 and 10000.',
    );
  });

  it.each(["0", "10001"])("rejects out-of-bounds requests value %s", (requests) => {
    expect(() => parse({ requests })).toThrow(
      'Input "requests" must be an integer between 1 and 10000.',
    );
  });

  it.each(["1.5", "abc"])(
    "rejects non-integer concurrency value %s",
    (concurrency) => {
      expect(() => parse({ concurrency })).toThrow(
        'Input "concurrency" must be an integer between 1 and 100.',
      );
    },
  );

  it.each(["0", "101"])(
    "rejects out-of-bounds concurrency value %s",
    (concurrency) => {
      expect(() => parse({ concurrency })).toThrow(
        'Input "concurrency" must be an integer between 1 and 100.',
      );
    },
  );

  it("rejects concurrency greater than requests", () => {
    expect(() => parse({ requests: "2", concurrency: "3" })).toThrow(
      'Input "concurrency" cannot exceed "requests".',
    );
  });

  it("accepts zero warmup requests", () => {
    expect(parse({ warmup: "0" }).warmupRequests).toBe(0);
  });

  it.each(["-1", "1001", "1.5"])("rejects invalid warmup value %s", (warmup) => {
    expect(() => parse({ warmup })).toThrow(
      'Input "warmup" must be an integer between 0 and 1000.',
    );
  });

  it.each(["99", "60001", "100.5"])("rejects invalid timeout value %s", (timeout) => {
    expect(() => parse({ timeout })).toThrow(
      'Input "timeout" must be an integer between 100 and 60000.',
    );
  });

  it.each([
    ["max-p95-regression", "-1"],
    ["max-p95-regression", "10001"],
    ["max-p95-regression", "Infinity"],
    ["max-error-rate", "-1"],
    ["max-error-rate", "101"],
    ["max-error-rate", "NaN"],
  ] as const)("rejects invalid percentage %s=%s", (name, value) => {
    expect(() => parse({ [name]: value })).toThrow(`Input "${name}" must be a number`);
  });

  it("rejects malformed header JSON without exposing the input", () => {
    const secret = "private-header-value";

    try {
      parse({ "headers-json": `{"Authorization":"${secret}"` });
      throw new Error("Expected parsing to fail");
    } catch (error) {
      expect(String(error)).toContain(
        'Input "headers-json" must be a JSON object whose values are strings.',
      );
      expect(String(error)).not.toContain(secret);
    }
  });

  it.each([
    ["an array", '["value"]'],
    ["null", "null"],
    ["a number", "42"],
  ])("rejects header JSON containing %s", (_caseName, headersJson) => {
    expect(() => parse({ "headers-json": headersJson })).toThrow(
      'Input "headers-json" must be a JSON object whose values are strings.',
    );
  });

  it.each([
    '{"X-Number":1}',
    '{"X-Boolean":true}',
    '{"X-Nested":{"value":"secret"}}',
  ])("rejects non-string header values", (headersJson) => {
    expect(() => parse({ "headers-json": headersJson })).toThrow(
      'Input "headers-json" must be a JSON object whose values are strings.',
    );
  });

  it("accepts valid header JSON", () => {
    expect(parse({ "headers-json": '{"Accept":"application/json"}' }).headers).toEqual({
      Accept: "application/json",
    });
  });
});
