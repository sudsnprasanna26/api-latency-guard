import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface DemoServerOptions {
  port: number;
  delayMs: number;
  errorRatePercent: number;
}

function parseInteger(value: string | undefined, name: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}.`);
  }
  return parsed;
}

export function parseArguments(argumentsToParse: string[]): DemoServerOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < argumentsToParse.length; index += 2) {
    const name = argumentsToParse[index];
    const value = argumentsToParse[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be provided as --name value pairs.");
    }
    values.set(name, value);
  }

  for (const name of values.keys()) {
    if (!["--port", "--delay", "--error-rate"].includes(name)) {
      throw new Error(`Unsupported argument: ${name}.`);
    }
  }

  const errorRatePercent = Number(values.get("--error-rate") ?? "0");
  if (!Number.isFinite(errorRatePercent) || errorRatePercent < 0 || errorRatePercent > 100) {
    throw new Error("--error-rate must be a number between 0 and 100.");
  }

  return {
    port: parseInteger(values.get("--port") ?? "3000", "--port", 1),
    delayMs: parseInteger(values.get("--delay") ?? "0", "--delay", 0),
    errorRatePercent,
  };
}

export function createDemoServer(options: DemoServerOptions): Server {
  return createServer(async (request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (pathname !== "/api/test") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    if (options.delayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, options.delayMs));
    }

    const shouldFail = Math.random() * 100 < options.errorRatePercent;
    response.writeHead(shouldFail ? 500 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(shouldFail ? { error: "demo_error" } : { status: "ok" }));
  });
}

async function start(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const server = createDemoServer(options);

  const shutdown = (): void => {
    server.close(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  server.listen(options.port, "127.0.0.1", () => {
    console.log(
      `Demo server listening on port ${options.port} ` +
        `(delay=${options.delayMs}ms, error-rate=${options.errorRatePercent}%).`,
    );
  });
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  void start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Demo server failed to start.";
    console.error(message);
    process.exitCode = 1;
  });
}
