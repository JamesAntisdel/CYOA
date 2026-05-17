// Headless-browser end-to-end smoke test.
//
// Drives the real Expo web app against the live local Docker stack
// (cyoa-local-app-1 + cyoa-local-convex-1 + cyoa-local-provider-mocks-1)
// through this user flow:
//
//   1. Open /                       -> document.title contains "The Unwritten"
//   2. Age gate picker is visible   -> select "18 or older", press Continue
//   3. Library section appears      -> starter stories rendered
//   4. Tap a non-tutorial cover     -> Bone Cathedral / Iron Court / Ashfall
//   5. URL changes to /read/<id>    -> reader mounted
//   6. Click first choice button    -> submitChoice fires
//   7. Within 20s, a MediaPlate state advances:
//        - a real <img> renders with a non-empty src, OR
//        - the skeleton microcopy "the scene is being drawn..." is gone.
//
// Run against the local stack (which must already be up):
//
//   pnpm test:e2e:flow
//
// Override the target with E2E_BASE_URL when needed:
//
//   E2E_BASE_URL=http://127.0.0.1:8081 pnpm test:e2e:flow

import { test, expect, type Locator, type Page } from "@playwright/test";

const NON_TUTORIAL_TITLES = ["Bone Cathedral", "Iron Court", "Ashfall"] as const;

// React Native Web renders accessibilityLabel as aria-label. The text on
// the skeleton uses a typographic ellipsis (U+2026), not three dots.
const SKELETON_MICROCOPY = "the scene is being drawn…";

const log = (step: string, detail?: string) => {
  // Plain console.log shows up in Playwright's reporter output and CI logs.
  // eslint-disable-next-line no-console
  console.log(`[flow] ${step}${detail ? ` — ${detail}` : ""}`);
};

test.describe("end-to-end flow @smoke", () => {
  test("guest journey: landing -> 18+ gate -> library -> reader -> first media", async ({ page, baseURL }) => {
    const base = baseURL ?? "http://localhost:8081";

    // 1) Landing
    log("nav", `goto ${base}/`);
    await page.goto(`${base}/`);

    // The Expo web export sets the document title from app.json's `name`
    // ("The Unwritten") via react-navigation's useDocumentTitle. Waiting on
    // the title is a cheap, hydration-independent readiness probe.
    log("wait", "document.title contains 'The Unwritten'");
    await expect(page).toHaveTitle(/The Unwritten/i, { timeout: 20_000 });

    // 2) Age gate
    log("gate", "age-gate radio group visible");
    const ageGroup = page.getByRole("radiogroup");
    await expect(ageGroup).toBeVisible({ timeout: 15_000 });

    log("gate", "select '18 or older'");
    const adultRadio = page.getByRole("radio", { name: /18 or older/i });
    await adultRadio.click();
    // RN Web Pressable doesn't always flip aria-checked synchronously; the
    // Continue button enabling is the real readiness signal.
    const continueButton = page.getByRole("button", { name: /^Continue$/ });
    await expect(continueButton).toBeEnabled({ timeout: 5_000 });

    log("gate", "press Continue");
    await continueButton.click();

    // 3) Library
    log("lib", "navigate to /library");
    // After age submit, `/` re-renders with the starter list. We could stay
    // on `/`, but navigating to `/library` is the explicit "library page"
    // surface and is the same flow a user hits via the nav.
    await page.goto(`${base}/library`);

    // Wait for the dedicated header so we don't race a partial render.
    log("lib", "library header visible");
    await expect(page.getByText(/Choose a starter adventure\./i)).toBeVisible({ timeout: 15_000 });

    // 4) Pick a non-tutorial cover.
    log("lib", "locate a non-tutorial cover");
    const cover = await findFirstVisibleCover(page);
    expect(cover, "no non-tutorial starter cover visible — library failed to populate").not.toBeNull();
    const coverTitle = await cover!.getAttribute("aria-label");
    log("lib", `tapping ${coverTitle ?? "<unknown cover>"}`);
    await cover!.click();

    // 5) Reader URL
    log("read", "wait for /read/<saveId>");
    await page.waitForURL(/\/read\/[^/]+/, { timeout: 15_000 });
    log("read", `at ${page.url()}`);

    // The reader header shows the story title — wait on something user-visible
    // so we don't try to click a choice that hasn't mounted yet.
    log("read", "wait for choice list to mount");
    const choicesGroup = page.getByLabel(/Available choices/i);
    await expect(choicesGroup).toBeVisible({ timeout: 15_000 });

    // 6) Click the first choice.
    // ChoiceList renders one or more Pressables with role="button" inside the
    // group. Locked choices have aria-disabled="true"; we exclude those with
    // an attribute selector and grab the first remaining button.
    const firstChoice = choicesGroup
      .locator('[role="button"]:not([aria-disabled="true"])')
      .first();
    await expect(firstChoice, "no enabled choice rendered").toBeVisible({ timeout: 10_000 });
    const choiceLabel = (await firstChoice.textContent())?.trim() ?? "<unknown>";
    log("read", `click first choice: "${choiceLabel}"`);
    await firstChoice.click();

    // 7) Media readiness within 20s.
    log("media", "wait up to 20s for media plate to advance past skeleton");
    await waitForMediaAdvance(page, 20_000);
    log("media", "media plate advanced — flow passed");
  });
});

/**
 * Find the first visible non-tutorial starter cover on the library page.
 *
 * Covers are rendered as <Pressable> wrapping an <Image accessibilityLabel="{title} cover">.
 * React Native Web turns that into an <img alt="{title} cover" />, and the
 * Pressable parent becomes a div with role="button". We look up the image by
 * its alt text and walk up to the clickable ancestor.
 */
async function findFirstVisibleCover(page: Page): Promise<Locator | null> {
  for (const title of NON_TUTORIAL_TITLES) {
    const altPattern = new RegExp(`${escapeRegExp(title)} cover`, "i");
    const image = page.getByRole("img", { name: altPattern });
    if (await image.count() === 0) continue;
    // The clickable element is the nearest ancestor with role="button".
    const clickable = image.first().locator("xpath=ancestor-or-self::*[@role='button'][1]");
    if (await clickable.count() === 0) continue;
    if (await clickable.first().isVisible()) {
      return clickable.first();
    }
  }
  return null;
}

/**
 * Poll for one of:
 *   - an <img> inside the reader main column with a non-empty src that does
 *     NOT match the cover-image alt pattern (i.e. the SCENE image, not a card)
 *   - the skeleton microcopy "the scene is being drawn..." is no longer visible
 *   - a [data-testid="media-plate"] element rendered in a non-skeleton state
 *
 * Resolves on the first matching condition or throws after `timeoutMs`.
 */
async function waitForMediaAdvance(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastDiagnostic = "no signal";

  while (Date.now() < deadline) {
    // Cheap optimistic checks first.
    const testIdPlate = page.locator('[data-testid="media-plate"]');
    if (await testIdPlate.count() > 0) {
      const state = await testIdPlate.first().getAttribute("data-state").catch(() => null);
      if (state && state !== "skeleton") {
        log("media", `media-plate testid found, state=${state}`);
        return;
      }
    }

    // Any <img> with a non-empty src that is NOT chrome (nav candle mark,
    // story cover thumbnails, placeholder pixels). Anything else on this
    // page is a scene-media image.
    const candidate = await page.evaluate(() => {
      const CHROME_ALT_PATTERNS = [
        / cover$/i,
        /candle mark/i,
        /^The Unwritten/i, // brand wordmarks / og-cards
      ];
      const imgs = Array.from(document.querySelectorAll("img"));
      const hit = imgs.find((img) => {
        const src = img.getAttribute("src") ?? "";
        const alt = img.getAttribute("alt") ?? "";
        if (!src) return false;
        if (CHROME_ALT_PATTERNS.some((p) => p.test(alt))) return false;
        // expo-router and react-native-web sometimes render placeholder
        // 1x1 transparent pixels — ignore those.
        if (src.startsWith("data:image/gif;base64,R0lGOD")) return false;
        if (src.startsWith("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB")) return false;
        return true;
      });
      return hit ? { src: hit.getAttribute("src"), alt: hit.getAttribute("alt") } : null;
    });
    if (candidate?.src) {
      log("media", `scene <img> rendered alt="${candidate.alt}" src=${candidate.src.slice(0, 80)}…`);
      return;
    }

    // Skeleton microcopy gone => the plate has moved past state 1.
    const skeleton = page.getByText(SKELETON_MICROCOPY);
    const skeletonCount = await skeleton.count();
    if (skeletonCount === 0) {
      // Make sure the reader hasn't unmounted entirely (which would also
      // hide the skeleton). The choice list disappears on ending screens,
      // but the prose Surface stays — assert it's still on screen.
      const proseStillThere = await page.getByLabel(/Available choices/i).count();
      if (proseStillThere > 0) {
        log("media", "skeleton microcopy gone, choice list still mounted");
        return;
      }
      lastDiagnostic = "skeleton gone but choice list also gone (reader unmounted?)";
    } else {
      lastDiagnostic = `skeleton still visible (${skeletonCount} match)`;
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `MediaPlate did not advance past skeleton within ${timeoutMs}ms — last diagnostic: ${lastDiagnostic}`,
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
