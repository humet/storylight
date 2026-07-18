import { test, expect } from "@playwright/test";

/**
 * Milestone 9 mobile flow: a parent creates a one-off story, the illustration slot
 * shows a "Painting this page" placeholder while the image job runs, then a painted
 * image appears (deterministic FAKE image + vision adapters — no key, no paid call).
 * The parent can open the picture and repaint it from the (visually secondary)
 * parent options menu. Runs on the dev PGlite fallback + in-process dispatcher.
 */
test("a parent sees a page get painted and can repaint it", async ({
  page,
}, testInfo) => {
  const email = `parent+${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Test Parent");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-strong-password");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/characters/new");
  await page.getByRole("textbox", { name: "Name" }).fill("Rosa");
  await page.getByRole("spinbutton", { name: /how old/i }).fill("7");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: /create character/i }).click();
  await expect(page).toHaveURL(/\/app\/characters\/[0-9a-f-]+$/);
  await page.getByRole("button", { name: /approve this character/i }).click();
  await expect(page).toHaveURL(/\/app\/characters$/);

  await page.goto("/app/create");
  await page
    .getByRole("textbox", { name: /your idea/i })
    .fill("Rosa finds her way home through a dark, gentle garden");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: /start tonight's story/i }).click();

  await page.waitForURL(/\/app\/stories\/[0-9a-f-]+$/, { timeout: 45000 });
  const readerUrl = page.url();
  await expect(
    page.getByRole("heading", { level: 1, name: /lantern in the garden/i }),
  ).toBeVisible();

  // The painted image is served from the private authorized delivery route. It may
  // start as a "Painting this page" placeholder; reload until the image arrives.
  const paintedImage = page.locator('img[src*="/app/illustrations/"]');
  await expect(async () => {
    await page.reload();
    await expect(paintedImage.first()).toBeAttached({ timeout: 3000 });
  }).toPass({ timeout: 45000 });

  // The picture is openable full screen (its own authorized URL).
  const fullscreenLink = page.locator('a[href*="/app/illustrations/"]').first();
  await expect(fullscreenLink).toHaveAttribute("target", "_blank");

  // Repaint the pictures from the (secondary) parent options menu.
  await page.locator("details summary").first().click();
  await page.getByTestId("regenerate-illustrations").click();

  // The reader is still intact after triggering a repaint (text never breaks).
  await expect(page).toHaveURL(readerUrl);
  await expect(
    page.getByRole("heading", { level: 1, name: /lantern in the garden/i }),
  ).toBeVisible();
});
