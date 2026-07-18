import { test, expect } from "@playwright/test";

/**
 * Milestone 3 mobile flow: a signed-in parent adds a character through the
 * progressive editor, approves it, and sees it in the family grid. Runs on the
 * dev PGlite fallback (file-backed, survives across runs), so a unique email per
 * run avoids collisions. This is deliberately the shortest happy path — the
 * server-side exit criteria are proven by the integration suite.
 */
test("a parent can create and approve a character from the mobile flow", async ({
  page,
}, testInfo) => {
  const email = `parent+${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Test Parent");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-strong-password");
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/app$/);

  // Reach the character editor from the shell.
  await page.getByRole("link", { name: /manage characters/i }).click();
  await expect(page).toHaveURL(/\/app\/characters$/);
  await page.getByRole("link", { name: /add a character/i }).click();
  await expect(page).toHaveURL(/\/app\/characters\/new$/);

  // Step 1 — the basics. Defaults carry the rest of the steps.
  await page.getByRole("textbox", { name: "Name" }).fill("Rosa");
  await page.getByRole("spinbutton", { name: /how old/i }).fill("7");

  // Advance through personality, speech, and boundaries to review.
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }

  await page.getByRole("button", { name: /create character/i }).click();

  // Lands on the character's review surface as a draft, then approve.
  await expect(page).toHaveURL(/\/app\/characters\/[0-9a-f-]+$/);
  await expect(
    page.getByRole("heading", { name: "Rosa", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: /approve this character/i }).click();

  // Back in the grid, the character is listed.
  await expect(page).toHaveURL(/\/app\/characters$/);
  await expect(page.getByRole("heading", { name: "Rosa" })).toBeVisible();
  await expect(page.getByText(/ready/i).first()).toBeVisible();
});
