import { expect, test } from "@playwright/test";

/**
 * Milestone 4 mobile flow: a signed-in parent paints a fictional character's
 * look, reviews the candidate sets, and approves one — the M4 exit criterion "a
 * parent can approve a fictional character reference set". Runs on the dev PGlite
 * database and the filesystem object store (both file-backed, offline), with the
 * deterministic fake image model, so no paid call is ever made. A unique email
 * per run avoids collisions on the shared dev database.
 */
test("a parent paints and approves a character reference set", async ({
  page,
}, testInfo) => {
  const email = `painter+${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Test Parent");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-strong-password");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Create a character (shortest happy path — defaults carry the later steps).
  await page.getByRole("link", { name: /manage characters/i }).click();
  await page.getByRole("link", { name: /add a character/i }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Rosa");
  await page.getByRole("spinbutton", { name: /how old/i }).fill("7");
  await page
    .getByRole("textbox", { name: /what do they look like/i })
    .fill("Curly red hair, round glasses");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: "Next", exact: true }).click();
  }
  await page.getByRole("button", { name: /create character/i }).click();
  await expect(page).toHaveURL(/\/app\/characters\/[0-9a-f-]+$/);

  // Enter the appearance surface and paint the first set of options.
  await page.getByRole("link", { name: /paint their look/i }).click();
  await expect(page).toHaveURL(/\/app\/characters\/[0-9a-f-]+\/appearance$/);
  await page.getByRole("button", { name: /paint rosa/i }).click();

  // Painting now runs as a durable workflow (M5): a progress state shows, then
  // the page polls and refreshes when the candidates are ready. Give the
  // background drive + poll a little longer than the default assertion timeout.
  await expect(
    page.getByRole("heading", { name: /choose rosa.s look/i }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Option 1" })).toBeVisible();
  await page
    .getByRole("button", { name: /use this look/i })
    .first()
    .click();

  // The approved reference set is now the character's current look.
  await expect(page).toHaveURL(/\/app\/characters\/[0-9a-f-]+\/appearance$/);
  await expect(
    page.getByRole("heading", { name: /rosa.s current look/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: /rosa — front portrait/i }),
  ).toBeVisible();

  // A reference image actually delivers bytes through the authorized route.
  const src = await page
    .getByRole("img", { name: /rosa — front portrait/i })
    .getAttribute("src");
  expect(src).toContain("/references/");
  const response = await page.request.get(src!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/svg+xml");
});
