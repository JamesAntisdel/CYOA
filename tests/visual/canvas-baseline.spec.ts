// Canvas baseline visual regression. Opens
// `apps/app/assets/design/design-system.html` as a local file:// URL and
// captures one screenshot per canvas section at 1280×900.
//
// On first run, Playwright writes the baselines under
// `tests/visual/__snapshots__/canvas-baseline.spec.ts/`. On every later run
// it diffs each section's screenshot against its baseline. Token-tolerance
// sections (color/type-heavy) fail CI on small drift; layout-tolerance
// sections allow ~1% pixel drift to avoid OS font-hinting noise.
//
// To refresh baselines after an intentional canvas change:
//   pnpm test:visual:update

import { test, expect } from "@playwright/test";
import { SECTIONS, CANVAS_FILE_URL } from "./sections";

test.describe("canvas baseline § ", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(CANVAS_FILE_URL);
    // The canvas renders React via Babel-standalone, which finishes after
    // some async font + script load. The intro section is rendered last in
    // the React app — waiting on a stable selector is more reliable than a
    // fixed timeout.
    await page.waitForSelector('[data-dc-section]', { timeout: 15_000 });
    // Fonts (IM Fell English, EB Garamond, Lora, Inter, Special Elite)
    // load from Google Fonts. Wait for them so type drift is not a
    // false-positive driven by FOUT.
    await page.evaluate(() => document.fonts.ready);
  });

  for (const section of SECTIONS) {
    test(`${section.id} — ${section.title}`, async ({ page }) => {
      const handle = page.locator(`[data-dc-section="${section.id}"]`);
      await handle.scrollIntoViewIfNeeded();
      await expect(handle).toBeVisible();

      const screenshotOptions = section.tolerance === "token"
        ? { maxDiffPixelRatio: 0.001 }
        : { maxDiffPixelRatio: 0.01 };

      await expect(handle).toHaveScreenshot(
        `${section.id}.png`,
        screenshotOptions,
      );
    });
  }
});
