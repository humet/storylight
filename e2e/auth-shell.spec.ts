import { test, expect } from "@playwright/test";

test("marketing landing renders for an unauthenticated visitor", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /bedtime stories/i }),
  ).toBeVisible();
  // Public entry points to auth are present.
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
});

test("the app shell redirects an unauthenticated visitor to sign-in", async ({
  page,
}) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { name: /^sign in$/i })).toBeVisible();
});

test("no horizontal overflow at 320px on the sign-in page", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
  );
  expect(overflows).toBe(false);
});
