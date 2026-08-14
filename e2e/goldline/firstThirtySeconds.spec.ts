import { expect, test, type Page } from "@playwright/test";

/**
 * Proves the game explains itself in the first 30 seconds — the real
 * field-tester never got a "what am I doing / where do I go / what real
 * action / what happens after" answer before hitting fabricated JUMP
 * prompts. This is the ONLY Goldline spec that must NOT seed the
 * `goldline:onboarding:v1` skip flag — every other spec suppresses the
 * first-entry explainer deliberately (see their addInitScript calls) so it
 * doesn't intercept pointer events; this one exists specifically to prove
 * the explainer itself, on a genuinely fresh identity.
 */
test.describe.configure({ timeout: 90_000 });

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function loginFresh(page: Page) {
  // Deliberately do NOT seed goldline:onboarding:v1 — this is the one
  // spec that must observe the explainer's genuine first-run appearance.
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith("goldline:"))
      .forEach(key => window.localStorage.removeItem(key));
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/driver?goldlineFixture=NEUTRALIZE");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("first 30 seconds explain themselves", () => {
  test("a genuinely fresh identity sees the explainer, can dismiss it, and can then determine objective/direction/action/outcome from the live UI alone", async ({
    page,
  }) => {
    await loginFresh(page);

    // The explainer genuinely appears on first entry — not assumed, not a
    // source-string check, an actual rendered dialog in this browser.
    const explainer = page.getByTestId("first-entry-explainer");
    await expect(explainer).toBeVisible();
    await expect(explainer).toContainText("YOUR BUSINESS IS THE ADVENTURE");
    // States what the player is doing, where to go, what action to take,
    // and what happens after — the four things the real field-tester
    // could not determine.
    await expect(explainer).toContainText("Follow the Gold Line");
    await expect(explainer).toContainText("Do the real action");
    await expect(explainer).toContainText(
      "Goldline updates from the real result"
    );

    // It is genuinely dismissible.
    await explainer.getByRole("button", { name: "GOT IT" }).click();
    await expect(explainer).toHaveCount(0);

    // It does not return on its own within the same session — a real
    // player is never re-interrupted by the same explainer mid-play.
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("first-entry-explainer")).toHaveCount(0);

    // After dismissal, the four "first 30 seconds" questions must be
    // answerable from the live world UI alone.

    // 1. "What am I doing / what is my objective?" — either a named
    // mission/order is shown, or the honest NO ACTIVE OBJECTIVE state is
    // shown. Either way, this is never blank/ambiguous.
    const objectiveAnswered = page
      .locator(".action-awaiting, [data-testid='objective-ahead'], [data-testid='no-active-objective']")
      .first();
    await expect(objectiveAnswered).toBeVisible();

    // 2. "Where do I go?" — the Gold Line itself is always rendered as the
    // route to follow (proven by the corridor-status branch/progress
    // indicator being live and visible).
    await expect(page.locator(".corridor-status")).toBeVisible();

    // 3. "What real action do I take?" — the context-actions surface is
    // present in the DOM (its content is truthfully empty until real
    // proximity/work exists, but the mechanism itself is discoverable).
    await expect(page.locator(".context-actions").first()).toBeVisible();

    // 4. "What happens after?" — the persistent world-history/FIELD LINK
    // status readout is visible, showing outcomes are tracked and surfaced
    // back to the player rather than disappearing into a fictional void.
    await expect(page.locator(".game-topbar")).toBeVisible();
    await expect(page.locator(".game-topbar b")).toBeVisible();
  });
});
