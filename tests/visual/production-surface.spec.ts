// Production-surface visual regression. Captures one screenshot per
// implemented route (library, paywall, login, discover, settings, etc.)
// and diffs against a baseline. Run separately from canvas-baseline
// because this spec needs the Expo web server running.
//
// Boot it with:
//   VISUAL_PROD=1 pnpm test:visual
//
// The canvas vs production comparison is left to a human reviewer for
// now — once both baselines are stable, a follow-up can pair them up
// via the SECTIONS table's prodRoute field and a side-by-side diff.

import { test, expect } from "@playwright/test";
import { SECTIONS } from "./sections";

test.describe("production surface § ", () => {
  test.skip(!process.env.VISUAL_PROD, "set VISUAL_PROD=1 to capture production surfaces");

  for (const section of SECTIONS) {
    if (!section.prodRoute) continue;

    test(`${section.id} ${section.prodRoute}`, async ({ page, baseURL }) => {
      const base = baseURL ?? process.env.VISUAL_BASE_URL ?? "http://127.0.0.1:8081";
      await page.goto(`${base}${section.prodRoute}`);

      // Production surfaces load fonts + React Native Web — give them a
      // chance to settle before snapshotting.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

      const tolerance = section.tolerance === "token"
        ? { maxDiffPixelRatio: 0.001 }
        : { maxDiffPixelRatio: 0.01 };

      await expect(page).toHaveScreenshot(
        `${section.id}.png`,
        tolerance,
      );
    });
  }
});
