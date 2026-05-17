import { defineConfig, devices } from "@playwright/test";

// End-to-end flow smoke config. Unlike playwright.visual.config.ts, this
// suite drives a real user flow (age gate -> library -> reader -> first
// choice -> media plate) against a LIVE local Docker stack:
//
//   - cyoa-local-app-1          serves the Expo web export at :8081
//   - cyoa-local-convex-1       runs anonymous local Convex at :3210/:3211
//   - cyoa-local-provider-mocks-1 mocks LLM providers at :4010
//
// The stack must already be running (`docker compose up -d app provider-mocks convex`).
// This config never boots a webServer — it talks to whatever is at
// E2E_BASE_URL (default http://localhost:8081).
//
// Pair with `pnpm test:e2e:flow` at the repo root.

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: ".",
  testMatch: /.*end-to-end-flow\.spec\.ts$/,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report-flow" }]]
    : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8081",
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  // The local Docker stack is the server. We never start one from this config.
  webServer: undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
