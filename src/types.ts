export interface BenchmarkConfig {
  baselineUrl: string;
  candidateUrl: string;
  endpoint: string;
  requests: number;
  concurrency: number;
  warmupRequests: number;
  requestTimeoutMs: number;
  maxP95RegressionPercent: number;
  maxErrorRatePercent: number;
  headers: Record<string, string>;
}

export interface RequestResult {
  durationMs: number;
  status: number | null;
  ok: boolean;
  error?: string;
}

export interface BenchmarkResult {
  requestedCount: number;
  successCount: number;
  errorCount: number;
  totalDurationMs: number;
  requestResults: RequestResult[];
}

export interface BenchmarkMetrics {
  p50Ms: number | null;
  p95Ms: number | null;
  averageMs: number | null;
  throughputPerSecond: number;
  errorRatePercent: number;
  successCount: number;
  errorCount: number;
}

export interface EvaluationResult {
  passed: boolean;
  p95RegressionPercent: number | null;
  reasons: string[];
}

export interface PerformanceReport {
  generatedAt: string;
  config: Omit<BenchmarkConfig, "headers">;
  baseline: BenchmarkMetrics;
  candidate: BenchmarkMetrics;
  evaluation: EvaluationResult;
}
