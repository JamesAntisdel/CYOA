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

  test("tutorial advances through the real training-room graph", async ({
    page,
  }) => {
    await launchTutorial(page);

    await expect(page.getByText("Room 1 - The Locked Cell")).toBeVisible();
    await expect(page.getByText("Nerve: ●○○○○")).toBeVisible();
    await expect(page.getByText("Insight: ○○○○○")).toBeVisible();
    await expect(page.getByLabel("Room 1 - The Locked Cell illustration.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue carefully" })).toBeHidden();

    const choice = page.getByRole("button", {
      name: "Study the wall runes before touching anything.",
    });
    await expect(choice).toBeEnabled();
    await choice.dblclick();

    await expect(page.getByText("Room 2 - The Rune Hall")).toBeVisible();
    await expect(page.getByText("Nerve: ●●○○○")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue carefully" })).toBeHidden();

    await page.getByRole("button", { name: "Trace the chalk sigil exactly as the runes described." }).click();
    await expect(page.getByText("Room 3 - The Counterweight Door")).toBeVisible();
    await expect(page.getByText("Chalk Mark")).toBeVisible();

    await page.getByRole("button", { name: "Press your chalk-marked palm to the counterweight door." }).click();
    await expect(page.getByLabel("Ending: The Door Remembers You")).toBeVisible();
    await expect(page.getByText("You have completed this training path.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Home" })).toBeVisible();
  });

  test("reader settings persist into the story view", async ({ page }) => {
    await createEligibleGuest(page);

    await page.goto("/settings");
    await page.getByRole("button", { name: "Hidden" }).click();
    await page.getByRole("button", { name: "Focus" }).click();
    await page.getByRole("button", { name: "Reduce motion" }).click();

    await page.goto("/");
    await page.getByRole("button", { name: /Start .*Training Room/i }).click();

    await expect(page.getByText("Room 1 - The Locked Cell")).toBeVisible();
    await expect(page.getByText("The player wakes in a candlelit training cell with a locked oak door, wall runes, and a loose brick.")).toBeVisible();
    await expect(page.getByLabel("Current stats")).toBeHidden();
    await page.getByText("Settings").click();
    await expect(page.getByRole("button", { name: "Reset settings" })).toBeVisible();
  });

  test("tutorial key path does not dead-end in the final room", async ({ page }) => {
    await launchTutorial(page);

    await page.getByRole("button", { name: "Lift the loose brick and take the rusty key." }).click();
    await expect(page.getByText("Room 2 - The Rune Hall")).toBeVisible();

    await page.getByRole("button", { name: "Use the rusty key on the gate." }).click();
    await expect(page.getByText("Room 3 - The Counterweight Door")).toBeVisible();
    await expect(page.getByLabel("Room 3 - The Counterweight Door illustration.")).toBeVisible();

    const recoveryChoice = page.getByRole("button", {
      name: "Study the counterweight lesson and reset the door.",
    });
    await expect(recoveryChoice).toBeEnabled();
    await recoveryChoice.click();

    await expect(page.getByLabel("Ending: The Door Remembers You")).toBeVisible();
    await page.getByRole("button", { name: "Home" }).click();
    await expect(page.getByText("Starter adventures")).toBeVisible();
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

  test("creator can stage a starter-compatible seed", async ({ page }) => {
    await createEligibleGuest(page);
    await page.getByRole("button", { name: "Create", exact: true }).click();

    await expect(page.getByText("Seed an adventure")).toBeVisible();
    await page.getByLabel("Seed title").fill("Glass Orchard");
    await page.getByLabel("Opening seed").fill("A glass orchard rings softly when the moon rises.");
    await page.getByLabel("Careful choice").fill("Test one branch with a wrapped hand.");
    await page.getByLabel("Bold choice").fill("Run beneath the ringing trees.");

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByLabel("Creator status")).toContainText(/Draft saved/i);

    await page.getByRole("button", { name: "Publish seed" }).click();
    await expect(page.getByLabel("Creator status")).toContainText(/Seed saved|published|Publishing is not available/i);
  });

  test("free limit paywall exposes mocked upgrade and overage controls", async ({ page }) => {
    await page.goto("/paywall");

    await expect(page.getByText("Choose how the story keeps going.")).toBeVisible();
    await page.getByRole("button", { name: "Preview Pro" }).click();
    await expect(page.getByText(/pro checkout is not available yet/i)).toBeVisible();
    await page.getByRole("switch").click();
    await expect(page.getByRole("switch", { name: "On" })).toBeVisible();
    await page.getByRole("button", { name: "$25" }).click();
  });

  test("mature controls are unavailable to unclaimed or unpaid local profiles", async ({ page }) => {
    await createEligibleGuest(page);
    await page.goto("/account");

    await expect(page.getByText("Guest profile", { exact: true })).toBeVisible();
    await expect(page.getByText("18+ controls")).toBeVisible();
    await expect(page.getByText("not eligible")).toBeVisible();
    await expect(page.getByRole("button", { name: "Claim with email" })).toBeVisible();
  });

  test("local guest can edit and claim an account profile with email", async ({ page }) => {
    await createEligibleGuest(page);
    await page.getByRole("button", { name: "Account" }).click();

    await expect(page.getByText("Guest profile", { exact: true })).toBeVisible();
    await page.getByLabel("Display name").fill("Reader One");
    await page.getByRole("button", { name: "Save name" }).click();
    await expect(page.getByText("Profile name updated.")).toBeVisible();
    await expect(page.getByText("Reader One")).toBeVisible();

    await page.getByLabel("Email address").fill("not-an-email");
    await page.getByRole("button", { name: "Claim with email" }).click();
    await expect(page.getByText("valid_email_required")).toBeVisible();

    await page.getByLabel("Email address").fill("reader@example.com");
    await page.getByRole("button", { name: "Claim with email" }).click();

    await expect(page.getByText("Claimed profile")).toBeVisible();
    await expect(page.getByText("reader@example.com")).toBeVisible();
  });

  test("local auth sign-up, sign-out, and sign-in update the profile", async ({ page }) => {
    await createEligibleGuest(page);
    await page.getByRole("button", { name: "Login" }).click();

    await page.getByRole("tab", { name: "Create" }).click();
    await page.getByLabel("Display name").fill("Test Reader");
    await page.getByLabel("Login email").fill("login@example.com");
    await page.getByLabel("Login password").fill("password123");
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByText("Signed-in profile")).toBeVisible();
    await expect(page.getByText("Test Reader")).toBeVisible();
    await expect(page.getByText("login@example.com")).toBeVisible();
    await expect(page.getByLabel("Main navigation").getByRole("button", { name: "Login" })).toBeHidden();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("Guest profile", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Main navigation").getByRole("button", { name: "Login" })).toBeVisible();

    await page.getByRole("button", { name: "Sign in or create account" }).click();
    await page.getByLabel("Login email").fill("login@example.com");
    await page.getByLabel("Login password").fill("wrongpass");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("invalid_email_or_password")).toBeVisible();

    await page.getByLabel("Login password").fill("password123");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Signed-in profile")).toBeVisible();
    await expect(page.getByText("login@example.com")).toBeVisible();
    await expect(page.getByLabel("Main navigation").getByRole("button", { name: "Login" })).toBeHidden();
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
