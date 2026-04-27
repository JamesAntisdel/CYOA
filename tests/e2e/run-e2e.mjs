import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const port = Number(process.env.E2E_PORT ?? 8081);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const serverScript = join(root, "tests/e2e/serve-expo-web.mjs");
const playwrightBin = join(root, "apps/app/node_modules/.bin/playwright");
const corepackHome = process.env.COREPACK_HOME ?? join(root, ".corepack");
const exportDir = process.env.E2E_EXPORT_DIR ?? "/tmp/cyoa-e2e-export";
const canReuseExport =
  process.env.E2E_REUSE_EXPORT !== "0" && existsSync(join(exportDir, "index.html"));
const readyTimeoutMs = Number(
  process.env.E2E_READY_TIMEOUT_MS ?? (canReuseExport ? 10_000 : 90_000),
);

let server;

try {
  if (!process.env.E2E_BASE_URL) {
    server = spawn("node", [serverScript], {
      cwd: root,
      env: {
        ...process.env,
        COREPACK_HOME: corepackHome,
        E2E_PORT: String(port),
        E2E_REUSE_EXPORT: process.env.E2E_REUSE_EXPORT ?? "1",
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    const serverExit = once(server, "exit").then(([code, signal]) => {
      throw new Error(
        `E2E web server exited before readiness: ${code ?? signal ?? "unknown"}`,
      );
    });
    await Promise.race([waitForServer(baseURL, readyTimeoutMs), serverExit]);
  }

  const code = await run(playwrightBin, ["test", "-c", "playwright.config.ts"], {
    ...process.env,
    E2E_BASE_URL: baseURL,
  });
  process.exitCode = code;
} finally {
  if (server && !server.killed) {
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), delay(2_000)]);
  }
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function run(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  return typeof code === "number" ? code : 1;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
