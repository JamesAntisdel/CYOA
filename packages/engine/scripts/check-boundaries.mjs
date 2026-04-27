import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const srcDir = new URL("../src", import.meta.url).pathname;
const forbiddenImports = [
  "react",
  "convex",
  "@anthropic-ai/sdk",
  "@google/generative-ai",
  "expo",
];
const forbiddenTokens = [
  "fetch(",
  "Date.now(",
  "process.env",
  "console.log(",
  "crypto.randomUUID(",
];

const failures = [];

for (const file of walk(srcDir)) {
  const text = readFileSync(file, "utf8");
  for (const token of forbiddenTokens) {
    if (text.includes(token)) {
      failures.push(`${file}: forbidden token ${token}`);
    }
  }
  for (const source of importSources(text)) {
    if (forbiddenImports.some((token) => source === token || source.startsWith(`${token}/`))) {
      failures.push(`${file}: forbidden import ${source}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      yield* walk(path);
    } else if (path.endsWith(".ts")) {
      yield path;
    }
  }
}

function importSources(text) {
  const sources = [];
  const staticImport = /from\s+["']([^"']+)["']/g;
  const sideEffectImport = /import\s+["']([^"']+)["']/g;
  for (const match of text.matchAll(staticImport)) sources.push(match[1]);
  for (const match of text.matchAll(sideEffectImport)) sources.push(match[1]);
  return sources;
}
