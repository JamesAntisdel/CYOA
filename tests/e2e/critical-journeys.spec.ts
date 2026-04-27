import { createEligibleGuest, expect, launchTutorial, test } from "./fixtures/app";

test.describe("implemented critical journeys", () => {
  test("first visit creates an eligible guest and shows starter adventures", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Choose your age range.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

    await page.getByRole("radio", { name: /18 or older/i }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("The Unwritten")).toBeVisible();
    await expect(page.getByRole("button", { name: /Start .*Training Room/i })).toBeVisible();
    await expect(page.getByText("Starter adventures")).toBeVisible();
  });

  test("under-13 users are blocked before session creation", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("radio", { name: /Under 13/i }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByText("The story is only available for ages 13 and older."),
    ).toBeVisible();
    await expect(page.getByText("The Unwritten")).toBeHidden();
  });

  test("tutorial first choice streams, updates stat pips, and ignores duplicate turn taps", async ({
    page,
  }) => {
    await launchTutorial(page);

    await expect(page.getByText("Nerve: ●●●○○")).toBeVisible();
    await expect(page.getByText("Insight: ●●○○○")).toBeVisible();
    await expect(page.getByText("Illustration queued")).toBeVisible();

    const choice = page.getByRole("button", { name: "Listen at the blue door" });
    await expect(choice).toBeEnabled();
    await choice.dblclick();

    await expect(page.getByText("Beyond the Door")).toBeVisible();
    await expect(page.getByText("Nerve: ●●●●○")).toBeVisible();
    await expect(page.getByText("Insight: ●●●○○")).toBeVisible();
    await expect(page.getByRole("button", { name: "Return to the reading table" })).toBeVisible();
  });

  test("co-op vote room records a deterministic participant vote", async ({ page }) => {
    await page.goto("/coop");

    await expect(page.getByText("Room CANDLE")).toBeVisible();
    await expect(page.getByText("Reader", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Follow the candle smoke" }).click();
    await expect(page.getByText("Your vote is recorded.")).toBeVisible();
    await expect(page.getByText("voted")).toBeVisible();

    await page.getByRole("button", { name: "Rotate" }).click();
    await expect(page.getByText("Pick one choice for this turn.")).toBeVisible();
    await expect(page.getByText("voted")).toBeHidden();
  });

  test("publish and read-along/fork scaffold is reachable without live providers", async ({ page }) => {
    await page.goto("/publish/e2e-save");

    await expect(page.getByText("Share this tale")).toBeVisible();
    await page.getByLabel("Tale title").fill("E2E Tale");
    await page.getByLabel("Tale synopsis").fill("A deterministic public snapshot.");
    await expect(page.getByRole("button", { name: "Run gates and publish" })).toBeVisible();

    await page.goto("/tale/e2e-tale");
    await expect(page.getByText("Published tale")).toBeVisible();
    await expect(page.getByRole("button", { name: /Fork from:/i }).first()).toBeVisible();
  });

  test("free limit paywall exposes mocked upgrade and overage controls", async ({ page }) => {
    await page.goto("/paywall");

    await expect(page.getByText("Choose how the story keeps going.")).toBeVisible();
    await page.getByRole("button", { name: "Preview Pro" }).click();
    await expect(page.getByText(/Pro preview:/i)).toBeVisible();
    await page.getByRole("switch").click();
    await expect(page.getByRole("switch", { name: "On" })).toBeVisible();
    await page.getByRole("button", { name: "$25" }).click();
  });

  test("mature controls are unavailable to unclaimed or unpaid local profiles", async ({ page }) => {
    await createEligibleGuest(page);
    await page.goto("/account");

    await expect(page.getByText("Guest profile")).toBeVisible();
    await expect(page.getByText("18+ controls")).toBeVisible();
    await expect(page.getByText("not eligible")).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim with email" })).toBeVisible();
  });

  test("death and ending surfaces keep hidden paths concealed", async ({ page }) => {
    await page.goto("/endings");

    await expect(page.getByText("Trophy crypt")).toBeVisible();
    await expect(page.getByText("2 of 4 endings found")).toBeVisible();
    await expect(page.getByText("Hidden ending").first()).toBeVisible();
    await expect(page.getByText("Undiscovered path").first()).toBeVisible();
  });

  test("admin dashboard is hidden without admin claim", async ({ page }) => {
    await page.goto("/admin");

    await expect(page.getByText("Admin claim required")).toBeVisible();
    await expect(page.getByText("Operator dashboards are hidden")).toBeVisible();
  });
  test("safety redirect uses a safe ending surface", async ({ page }) => {
    await page.goto("/read/safe-ending");

    await expect(page.getByText("Safe Closing Page")).toBeVisible();
    await expect(page.getByText("The Story Ends Here")).toBeVisible();
    await expect(page.getByText("This thread has ended safely.")).toBeVisible();
  });

  test("Pro media attach renders a ready scene asset without blocking prose", async ({ page }) => {
    await page.goto("/read/pro-media");

    await expect(page.getByText("The Painted Door")).toBeVisible();
    await expect(page.getByText("A finished illustration settles into the page")).toBeVisible();
    await expect(page.getByLabel("Ready Pro illustration attached to the scene.")).toBeVisible();
  });
});
