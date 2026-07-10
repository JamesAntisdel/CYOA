import { createReadStream, existsSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const outputDir = process.env.E2E_EXPORT_DIR ?? "/tmp/cyoa-e2e-export";
const port = Number(process.env.E2E_PORT ?? 8081);
const host = process.env.E2E_HOST ?? "127.0.0.1";
const corepackHome = process.env.COREPACK_HOME ?? join(root, ".corepack");
const expoBin = join(root, "apps/app/node_modules/.bin/expo");
const reuseExport = process.env.E2E_REUSE_EXPORT === "1";

if (!reuseExport || !existsSync(join(outputDir, "index.html"))) {
  await rm(outputDir, { force: true, recursive: true });
  await mkdir(outputDir, { recursive: true });
  await run(expoBin, [
    "export",
    "--platform",
    "web",
    "--output-dir",
    outputDir,
  ]);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const candidate = normalize(join(outputDir, pathname));
  const filePath = candidate.startsWith(outputDir) ? await resolveFile(candidate) : null;
  const resolvedPath = filePath ?? join(outputDir, "index.html");

  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", contentType(resolvedPath));
  createReadStream(resolvedPath)
    .on("error", () => {
      response.statusCode = 404;
      response.end("Not found");
    })
    .pipe(response);
});

server.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Serving Expo E2E export at http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

async function run(command, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: join(root, "apps/app"),
      env: { ...process.env, COREPACK_HOME: corepackHome },
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} ${args.join(" ")} exited with ${code}`));
      }
    });
  });
}

async function resolveFile(candidate) {
  if (!existsSync(candidate)) return null;
  const info = await stat(candidate);
  if (info.isFile()) return candidate;
  const indexPath = join(candidate, "index.html");
  return existsSync(indexPath) ? indexPath : null;
}

function contentType(filePath) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}
