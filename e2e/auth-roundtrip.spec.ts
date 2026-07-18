import { test, expect } from "@playwright/test";

// Full credential vertical slice: sign up -> family bootstrap + HTTP-only
// session cookie -> requireActor() resolves the actor from family_members ->
// the authenticated shell renders. Persistence is now the Drizzle adapter over
// the dev PGlite fallback (M2), which is file-backed and survives across runs,
// so a unique email per run avoids collisions with earlier data.
test("signing up creates a session and reaches the app shell", async ({
  page,
}, testInfo) => {
  const email = `parent+${Date.now()}-${testInfo.project.name}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Test Parent");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-strong-password");
  await page.getByRole("button", { name: /create account/i }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: /your family library/i }),
  ).toBeVisible();

  // The authenticated session survives a fresh navigation to the shell.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole("heading", { name: /your family library/i }),
  ).toBeVisible();
});
