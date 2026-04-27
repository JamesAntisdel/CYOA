import { expect, test as base } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await use(page);
  },
});

export { expect };

export async function createEligibleGuest(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("radio", { name: /18 or older/i }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("The Unwritten")).toBeVisible();
}

export async function launchTutorial(page: import("@playwright/test").Page) {
  await createEligibleGuest(page);
  await page.getByRole("button", { name: /Start .*Training Room/i }).click();
  await expect(page.getByText("The First Door")).toBeVisible();
}
