import { expect, test, type Page } from "@playwright/test";

/**
 * Dynamic reroute (Slice 96). Proves the Stronghold route table reprojects
 * immediately when authoritative reality changes — no app restart, no
 * generic "dashboard refreshed" message — using the fixture's
 * "RESOLVE ONE REAL STOP" control, which changes the underlying
 * FieldMovesResult exactly the way a real authoritative refetch would.
 */
const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function loginToNeutralizeFixture(page: Page) {
  // First-entry explainer only shows once per player identity (see
  // onboardingProgress.ts) and would otherwise intercept pointer events
  // for every test that doesn't care about it.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["first_entry_explained"])
    );
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/driver?goldlineFixture=NEUTRALIZE");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({ timeout: 30_000 });
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Open field utilities" }).click();
}

async function openStronghold(page: Page) {
  await openMenu(page);
  await page.getByRole("button", { name: "STRONGHOLD", exact: true }).click();
  await expect(page.getByTestId("stronghold-panel")).toBeVisible();
}

/**
 * The harness's test-only controls render outside (before) the game shell,
 * which is a full-viewport overlay — same pointer-interception issue the
 * existing `goldline-fixture-toggle-world` control already solves via a raw
 * DOM click rather than a simulated pointer click.
 */
async function clickFixtureButton(page: Page, testId: string) {
  await page.getByTestId(testId).evaluate(node => {
    (node as HTMLButtonElement).click();
  });
}

test.describe("dynamic reroute reprojects immediately on real change", () => {
  test("resolving one real stop shrinks the route table without a restart", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openStronghold(page);

    const routeTable = page.getByTestId("stronghold-route-table");
    const beforeCount = await routeTable.locator("article").count();

    // Close the panel, apply the real change, reopen — proving the change
    // is reflected the very next time reality is read, with no restart.
    await page.locator(".game-panel-close").click();
    await clickFixtureButton(page, "fixture-resolve-live-stop");
    await page.waitForTimeout(300);
    await openStronghold(page);

    const afterCount = await page.getByTestId("stronghold-route-table").locator("article").count();
    expect(afterCount).toBeLessThan(beforeCount);
  });

  test("never shows a generic 'dashboard refreshed' message", async ({ page }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await clickFixtureButton(page, "fixture-resolve-live-stop");
    await page.waitForTimeout(300);
    await openStronghold(page);

    const text = (await page.getByTestId("stronghold-panel").textContent()) ?? "";
    expect(text.toLowerCase()).not.toContain("dashboard refreshed");
    expect(text.toLowerCase()).not.toContain("refresh to see");
  });

  test("the NEUTRALIZE mission itself disappears once reality no longer supports a route", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);

    // Resolve down to a single remaining stop — a route grammar requires at
    // least 2 real stops (shared/actionGrammar.ts), so the fiction mission
    // must honestly disappear rather than keep dramatizing a route that no
    // longer exists.
    for (let i = 0; i < 4; i += 1) {
      await clickFixtureButton(page, "fixture-resolve-live-stop");
      await page.waitForTimeout(150);
    }

    await openMenu(page);
    await expect(page.getByTestId("enter-fiction-mission")).toHaveCount(0);
  });

  test("does not reshuffle the route for novelty when nothing real changed", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openStronghold(page);
    const first = await page.getByTestId("stronghold-route-table").innerText();

    await page.locator(".game-panel-close").click();
    await page.waitForTimeout(200);
    await openStronghold(page);
    const second = await page.getByTestId("stronghold-route-table").innerText();

    expect(second).toBe(first);
  });
});
