import * as core from "@actions/core";

import type { BenchmarkConfig } from "./types.js";

export interface RawConfigInputs {
  "baseline-url"?: string;
  "candidate-url"?: string;
  endpoint?: string;
  requests?: string;
  concurrency?: string;
  warmup?: string;
  timeout?: string;
  "max-p95-regression"?: string;
  "max-error-rate"?: string;
  "headers-json"?: string;
}

const defaults = {
  endpoint: "/",
  requests: "50",
  concurrency: "5",
  warmup: "5",
  timeout: "5000",
  maxP95Regression: "20",
  maxErrorRate: "1",
  headersJson: "{}",
} as const;

function requiredValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim() ?? "";

  if (trimmed.length === 0) {
    throw new Error(`Input "${name}" is required.`);
  }

  return trimmed;
}

function valueOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? fallback : trimmed;
}

function parseBaseUrl(value: string | undefined, name: string): string {
  const rawUrl = requiredValue(value, name);
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Input "${name}" must be a valid URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Input "${name}" must use http or https.`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`Input "${name}" must not include credentials.`);
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}${parsed.search}${parsed.hash}`;
}

function parseEndpoint(value: string | undefined): string {
  const endpoint = valueOrDefault(value, defaults.endpoint);

  if (!endpoint.startsWith("/") || endpoint.startsWith("//")) {
    throw new Error('Input "endpoint" must be a relative path beginning with "/".');
  }

  return endpoint;
}

function parseInteger(
  value: string | undefined,
  fallback: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(valueOrDefault(value, fallback));

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `Input "${name}" must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return parsed;
}

function parsePercentage(
  value: string | undefined,
  fallback: string,
  name: string,
  maximum: number,
): number {
  const parsed = Number(valueOrDefault(value, fallback));

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`Input "${name}" must be a number between 0 and ${maximum}.`);
  }

  return parsed;
}

function parseHeaders(value: string | undefined): Record<string, string> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(valueOrDefault(value, defaults.headersJson));
  } catch {
    throw new Error(
      'Input "headers-json" must be a JSON object whose values are strings.',
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      'Input "headers-json" must be a JSON object whose values are strings.',
    );
  }

  for (const headerValue of Object.values(parsed)) {
    if (typeof headerValue !== "string") {
      throw new Error(
        'Input "headers-json" must be a JSON object whose values are strings.',
      );
    }
  }

  return parsed as Record<string, string>;
}

export function parseConfig(inputs: RawConfigInputs): BenchmarkConfig {
  const requests = parseInteger(inputs.requests, defaults.requests, "requests", 1, 10_000);
  const concurrency = parseInteger(
    inputs.concurrency,
    defaults.concurrency,
    "concurrency",
    1,
    100,
  );

  if (concurrency > requests) {
    throw new Error('Input "concurrency" cannot exceed "requests".');
  }

  return {
    baselineUrl: parseBaseUrl(inputs["baseline-url"], "baseline-url"),
    candidateUrl: parseBaseUrl(inputs["candidate-url"], "candidate-url"),
    endpoint: parseEndpoint(inputs.endpoint),
    requests,
    concurrency,
    warmupRequests: parseInteger(inputs.warmup, defaults.warmup, "warmup", 0, 1_000),
    requestTimeoutMs: parseInteger(inputs.timeout, defaults.timeout, "timeout", 100, 60_000),
    maxP95RegressionPercent: parsePercentage(
      inputs["max-p95-regression"],
      defaults.maxP95Regression,
      "max-p95-regression",
      10_000,
    ),
    maxErrorRatePercent: parsePercentage(
      inputs["max-error-rate"],
      defaults.maxErrorRate,
      "max-error-rate",
      100,
    ),
    headers: parseHeaders(inputs["headers-json"]),
  };
}

export function readConfig(): BenchmarkConfig {
  return parseConfig({
    "baseline-url": core.getInput("baseline-url"),
    "candidate-url": core.getInput("candidate-url"),
    endpoint: core.getInput("endpoint"),
    requests: core.getInput("requests"),
    concurrency: core.getInput("concurrency"),
    warmup: core.getInput("warmup"),
    timeout: core.getInput("timeout"),
    "max-p95-regression": core.getInput("max-p95-regression"),
    "max-error-rate": core.getInput("max-error-rate"),
    "headers-json": core.getInput("headers-json"),
  });
}
