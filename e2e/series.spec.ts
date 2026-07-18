import { test, expect } from "@playwright/test";

/**
 * Milestone 8 mobile flow: a signed-in parent creates a SERIES through the create
 * flow, watches it plan the whole story + write Chapter 1, reads Chapter 1 with the
 * end-of-chapter treatment, taps "Continue tonight", and Chapter 2 appears and
 * reads. Runs on the dev PGlite fallback with the DEV FIXTURE language model (no
 * key, no paid call). A unique email per run avoids collisions.
 */
test("a parent can create a series, read chapter 1, and continue to chapter 2", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const email = `parent+${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${testInfo.project.name}@example.com`;

  await page.goto("/sign-up");
  await page.getByLabel("Your name").fill("Test Parent");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-strong-password");
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Add and approve a character.
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

  // Create a series through the create flow.
  await page.goto("/app/create");
  await page
    .getByRole("textbox", { name: /your idea/i })
    .fill("A gentle band of friends explore a glowing night forest");
  await page.getByRole("button", { name: "Next", exact: true }).click(); // idea → characters
  await page.getByRole("button", { name: "Next", exact: true }).click(); // characters → format
  // Choose the series format.
  await page.getByRole("button", { name: /a story to continue/i }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click(); // format → choices
  await page.getByRole("button", { name: "Next", exact: true }).click(); // choices → start
  await page.getByRole("button", { name: /begin the series/i }).click();

  // Progress → series overview once Chapter 1 is published. The create action routes
  // to the progress screen, but with the fast dev fixture the workflow can complete
  // before that screen renders (it SSR-redirects to the overview when complete), so
  // we wait for the overview URL directly rather than the transient /progress URL.
  await page.waitForURL(/\/app\/series\/[0-9a-f-]+$/, { timeout: 90_000 });
  const overviewUrl = page.url();

  // Read Chapter 1 with the end-of-chapter treatment.
  await page
    .getByRole("link", { name: /chapter 1/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/chapters\/1$/);
  await expect(page.getByText(/chapter 1 of 5/i)).toBeVisible();
  await expect(page.getByText(/end of chapter 1/i)).toBeVisible();
  await expect(
    page.getByRole("link", { name: /close the book/i }),
  ).toBeVisible();

  // Back to the overview and continue tonight → Chapter 2. The continue action starts
  // the next-chapter workflow (durable, runs in the background) and routes to the
  // progress screen. Poll the overview until Chapter 2 is published and shown — this
  // avoids racing the transient /progress URL under the fast dev fixture.
  await page.goto(overviewUrl);
  await page.getByRole("button", { name: /continue tonight/i }).click();
  // Give the action POST time to land before any navigation can abort it.
  await page.waitForTimeout(1500);
  await expect(async () => {
    // Success end-state: Chapter 2 on the overview.
    await page.goto(overviewUrl);
    const chapterTwo = page.getByRole("link", { name: /chapter 2/i }).first();
    if (await chapterTwo.isVisible().catch(() => false)) return;
    // The submit can be lost if navigation aborted the POST — re-tap, which is
    // safe (deterministic requestId collapses duplicates) and can never start
    // chapter 3 because the button label pins the chapter number.
    const continueButton = page.getByRole("button", {
      name: /continue tonight — chapter 2/i,
    });
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
      await page.waitForTimeout(1500);
    }
    throw new Error("chapter 2 not published yet");
  }).toPass({ timeout: 90_000 });

  // Chapter 2 now appears and reads.
  await page
    .getByRole("link", { name: /chapter 2/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/chapters\/2$/);
  await expect(page.getByText(/chapter 2 of 5/i)).toBeVisible();

  // --- Per-chapter reading progress (M8 wired series beacon) ---
  const chapter1Url = `${overviewUrl}/chapters/1`;
  const chapter2Url = `${overviewUrl}/chapters/2`;

  // Force a save by signalling the page is hidden (the reader saves on visibility
  // change), and wait for the beacon POST to be acknowledged before reloading.
  async function forceSaveProgress() {
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes("/reading-progress") &&
        r.request().method() === "POST",
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await saved;
  }

  // Read Chapter 1 mid-scroll and persist that position.
  await page.goto(chapter1Url);
  await expect(page.getByText(/chapter 1 of 5/i)).toBeVisible();
  await page.evaluate(() =>
    document.getElementById("p-10")?.scrollIntoView({ block: "start" }),
  );
  await page.waitForTimeout(100);
  const ch1Scroll = await page.evaluate(() => window.scrollY);
  expect(ch1Scroll).toBeGreaterThan(150);
  await forceSaveProgress();

  // Reload → the saved position is restored (survives refresh).
  await page.reload();
  await expect(page.getByText(/chapter 1 of 5/i)).toBeVisible();
  await page.waitForTimeout(600); // allow the restore effect to run
  const ch1Restored = await page.evaluate(() => window.scrollY);
  expect(ch1Restored).toBeGreaterThan(150);

  // Chapter 2's progress is INDEPENDENT of Chapter 1: opening it starts at the top,
  // NOT Chapter 1's deep position. (Under the old UNIQUE(story_id, user_id) the two
  // chapters would have shared/clobbered one row and inherited each other's scroll.)
  await page.goto(chapter2Url);
  await expect(page.getByText(/chapter 2 of 5/i)).toBeVisible();
  await page.waitForTimeout(600);
  const ch2Scroll = await page.evaluate(() => window.scrollY);
  expect(ch2Scroll).toBeLessThan(80);

  // And Chapter 1 still restores to its own deep position afterwards.
  await page.goto(chapter1Url);
  await expect(page.getByText(/chapter 1 of 5/i)).toBeVisible();
  await page.waitForTimeout(600);
  const ch1Again = await page.evaluate(() => window.scrollY);
  expect(ch1Again).toBeGreaterThan(150);
});
