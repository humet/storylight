import { test, expect } from "@playwright/test";

/**
 * Milestone 7 mobile flow: a signed-in parent adds a character, writes a one-off
 * story through the create flow, watches progress, reads it in the reader, and on
 * reload the position is restored. Runs on the dev PGlite fallback with the DEV
 * FIXTURE language model (no key, no paid call) — the same fake-adapter contract
 * the integration suite proves. A unique email per run avoids collisions.
 */
test("a parent can create, read, and reopen a one-off story", async ({
  page,
}, testInfo) => {
  const email = `parent+${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Test Parent");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-strong-password");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Add and approve a character (the story needs an active cast member).
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

  // Write tonight's story through the create flow.
  await page.goto("/app/create");
  await page
    .getByRole("textbox", { name: /your idea/i })
    .fill("Rosa finds her way home through a dark, gentle garden");
  await page.getByRole("button", { name: "Next", exact: true }).click(); // idea → characters
  // Rosa is the only character and is pre-selected; advance through the steps.
  await page.getByRole("button", { name: "Next", exact: true }).click(); // characters → format
  await page.getByRole("button", { name: "Next", exact: true }).click(); // format → choices
  await page.getByRole("button", { name: "Next", exact: true }).click(); // choices → start
  await page.getByRole("button", { name: /start tonight's story/i }).click();

  // The progress screen is transient — with the fast dev fixture the workflow
  // can complete before it ever renders (same cold-start race as the series
  // spec), so wait only for the reader end-state.
  await page.waitForURL(/\/app\/stories\/[0-9a-f-]+$/, { timeout: 45000 });

  const readerUrl = page.url();
  await expect(
    page.getByRole("heading", { level: 1, name: /lantern in the garden/i }),
  ).toBeVisible();
  await expect(page.getByText(/close the book/i)).toBeVisible();

  // Scroll down, let progress save, then reload — the story is still readable.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(2000);
  await page.reload();

  await expect(page).toHaveURL(readerUrl);
  await expect(
    page.getByRole("heading", { level: 1, name: /lantern in the garden/i }),
  ).toBeVisible();
  // Position is restored below the top of the page (paragraph anchor / scroll).
  await page.waitForTimeout(500);
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);
});
