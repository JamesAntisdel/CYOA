import { defineConfig, devices } from "@playwright/test";

// Visual-regression config for task 29. The canvas baseline spec opens
// `apps/app/assets/design/design-system.html` as a local file:// URL — no
// dev server needed. The production-surface spec reuses the existing e2e
// serve-expo-web.mjs only when the spec actually navigates to a production
// route (lazy boot).
//
// Token regions (`data-token-region`) diff with strict tolerance — any
// color/type drift between the canvas and production fails CI. Layout
// regions diff with relaxed tolerance — anything-pixel-perfect would be
// noise on different OSes/font hinting.

const repoRoot = __dirname + "/../..";
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts$/,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Strict for token regions; layout regions use a per-test override
      // via `maxDiffPixelRatio` in the spec.
      maxDiffPixelRatio: 0.001,
      threshold: 0.05,
      animations: "disabled",
      caret: "hide",
    },
  },
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-visual" }]] : "list",
  use: {
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  // No global webServer — the canvas spec uses file:// URLs. The
  // production-surface spec lives behind an env flag (VISUAL_PROD=1) and
  // launches the e2e serve-expo-web.mjs only when asked.
  webServer: process.env.VISUAL_PROD
    ? {
        command: `node ${repoRoot}/tests/e2e/serve-expo-web.mjs`,
        cwd: repoRoot,
        url: process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:8081",
        reuseExistingServer: !isCI,
        timeout: 60_000,
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Baselines live next to the specs so PRs show diffs inline.
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFilePath}/{arg}{ext}",
});
