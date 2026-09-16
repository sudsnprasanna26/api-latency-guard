# API Latency Guard

API Latency Guard is a GitHub Action that detects API latency and error-rate regressions before they reach production.

It compares the same GET endpoint on a baseline deployment and a candidate deployment, then fails the workflow when the candidate exceeds the configured p95 latency or error-rate threshold. The Action uses bounded concurrency, per-request timeouts, and sequential target execution to keep comparisons controlled and understandable.

## What it measures

- p50, p95, and average latency for successful responses
- Throughput across all completed measured requests
- Error rate across all measured requests
- Candidate p95 regression relative to the baseline

Warmup requests are excluded from every metric. HTTP statuses from 200 through 399 are successful; other statuses, timeouts, and network failures count as errors. Baseline and candidate traffic never run simultaneously.

## Example result

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| p50 latency | 43.20 ms | 47.10 ms |
| p95 latency | 61.40 ms | 78.30 ms |
| Average latency | 46.80 ms | 51.90 ms |
| Throughput | 92.50 req/s | 81.30 req/s |
| Error rate | 0.00% | 0.00% |

In this example, p95 regressed by 27.52%. A configured 20% limit would fail the workflow.

## Quick start

```yaml
name: API performance check

on:
  pull_request:

jobs:
  latency-guard:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v7

      - name: Compare API performance
        uses: sudsnprasanna26/api-latency-guard@v1
        with:
          baseline-url: https://api.example.com
          candidate-url: https://preview.example.com
          endpoint: /api/health
          requests: 100
          concurrency: 10
          warmup: 10
          timeout: 5000
          max-p95-regression: 20
          max-error-rate: 1
```

This is the typical preview-versus-production setup: `baseline-url` points to the current production deployment, while `candidate-url` points to the preview created for the proposed change.

## Inputs

| Input | Required | Default | Description |
| --- | :---: | ---: | --- |
| `baseline-url` | Yes | — | Base URL for the existing or production API. |
| `candidate-url` | Yes | — | Base URL for the proposed or preview API. |
| `endpoint` | No | `/` | Relative endpoint path, optionally including a query string. |
| `requests` | No | `50` | Measured requests per target; integer from 1 through 10,000. |
| `concurrency` | No | `5` | Maximum concurrent requests; integer from 1 through 100 and no greater than `requests`. |
| `warmup` | No | `5` | Unmeasured warmup requests per target; integer from 0 through 1,000. |
| `timeout` | No | `5000` | Per-request timeout in milliseconds; integer from 100 through 60,000. |
| `max-p95-regression` | No | `20` | Maximum candidate p95 regression percentage. |
| `max-error-rate` | No | `1` | Maximum candidate error-rate percentage. |
| `headers-json` | No | `{}` | JSON object of string headers sent to both targets. |

Only `http` and `https` targets are accepted. URLs containing embedded credentials are rejected.

## Outputs

| Output | Description |
| --- | --- |
| `result` | `pass` or `fail`. |
| `baseline-p95-ms` | Baseline p95 latency in milliseconds, or an empty string when unavailable. |
| `candidate-p95-ms` | Candidate p95 latency in milliseconds, or an empty string when unavailable. |
| `p95-regression-percent` | Candidate p95 regression percentage, or an empty string when unavailable. |
| `baseline-error-rate-percent` | Baseline error-rate percentage. |
| `candidate-error-rate-percent` | Candidate error-rate percentage. |
| `report-path` | Path to `api-latency-guard-report.json`. |

The Action also writes a Markdown comparison to the GitHub Actions step summary and a machine-readable JSON report to the workspace.

## Pass and fail behavior

The Action fails after writing its summary, JSON report, and outputs when any of these conditions applies:

- The baseline or candidate produced no successful responses.
- Candidate p95 regression is strictly greater than `max-p95-regression`.
- Candidate error rate is strictly greater than `max-error-rate`.

Equality with either configured threshold passes. A faster candidate has a negative regression percentage and passes the latency check.

## Authentication headers

```yaml
- name: Compare authenticated endpoints
  uses: sudsnprasanna26/api-latency-guard@v1
  with:
    baseline-url: https://api.example.com
    candidate-url: https://preview.example.com
    endpoint: /api/private/health
    headers-json: >-
      {"Authorization":"Bearer ${{ secrets.PREVIEW_API_TOKEN }}"}
```

The same headers are sent to both targets. Header values are excluded from logs and reports. Store credentials in GitHub Secrets rather than writing literal values in workflow files. Do not expose privileged secrets to workflows that execute untrusted pull-request code, especially pull requests from forks.

## Metric definitions

- **p50 latency:** nearest-rank median of successful request durations.
- **p95 latency:** nearest-rank 95th percentile of successful request durations.
- **Average latency:** arithmetic mean of successful request durations.
- **Throughput:** all completed measured requests divided by measured wall-clock time.
- **Error rate:** failed measured requests divided by requested measurements, expressed as a percentage.

Latency retains full precision internally and is rounded only for Markdown presentation.

## Limitations

- One endpoint and GET requests only
- One shared header set for both targets
- No request bodies, retries, historical storage, or notifications
- No distributed or geographic load generation
- No statistical-significance analysis
- No production capacity measurement
- Results vary with runner type, network conditions, and target load

Results are intended for regression detection, not statistically rigorous load testing or production capacity planning.

## Local development

Node.js 24 and npm 10 or newer are required.

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

Run the deterministic demo server locally with:

```powershell
npm run demo -- --port 3001 --delay 25 --error-rate 0
```

The server exposes `GET /health` and `GET /api/test`. Tests use only local native HTTP servers and do not contact public APIs.

## Testing and building

- `npm run typecheck` checks strict TypeScript types without emitting JavaScript.
- `npm test` runs unit and local integration tests once.
- `npm run test:watch` runs tests in watch mode.
- `npm run build` bundles `src/index.ts` into `dist/index.js` with `ncc`.

JavaScript Actions execute the committed bundle, so rebuild and commit `dist/index.js` whenever runtime source changes.

## Release process

Do not release until the validation commands pass and `dist/index.js` is current.

```powershell
npm ci
npm run typecheck
npm test
npm run build
git diff --check
git status --short
```

After reviewing and committing the release candidate, a maintainer can create the immutable and floating tags:

```powershell
git tag v1.0.0
git tag -f v1 v1.0.0
git push origin v1.0.0
git push origin v1 --force
```

Then create a GitHub release for `v1.0.0`, publish the Action to GitHub Marketplace, and verify `sudsnprasanna26/api-latency-guard@v1` from a separate repository. These external release operations are intentionally manual.

## License

API Latency Guard is available under the [MIT License](LICENSE).
