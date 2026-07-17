import { test, expect } from "@playwright/test";

test("home page renders without horizontal scrolling", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
