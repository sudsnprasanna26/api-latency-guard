# Contributing

Thanks for helping improve API Latency Guard. Keep changes focused on regression detection for HTTP GET endpoints and avoid adding features outside the documented scope without prior discussion.

## Development checks

Use Node.js 24 and npm 10 or newer. Install and validate with:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Commit the regenerated `dist/index.js` whenever runtime source changes. Add or update behavioral tests, keep credentials out of fixtures and logs, and confirm `git diff --check` passes before opening a pull request.
