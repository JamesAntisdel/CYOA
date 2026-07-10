import { spawnSync } from "node:child_process";

const target = process.env.CONVEX_DEPLOYMENT ?? process.env.EXPO_PUBLIC_CONVEX_URL ?? "local Convex dev deployment";

console.log("CYOA local seed");
console.log(`Target: ${target}`);
console.log("");

const result = spawnSync("pnpm", ["exec", "convex", "run", "seeds:loadStarterStories"], {
  cwd: new URL("../..", import.meta.url),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
