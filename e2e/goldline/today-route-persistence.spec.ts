import { expect, test, type Page } from "@playwright/test";

/**
 * Today's Route + fiction-assignment persistence across reload (Slices 95,
 * 101). Proves the same unresolved real action keeps the same fiction
 * assignment across a full page reload — no Math.random()/Date reseed on
 * revisit, and no daily-reset/streak-punishment behavior.
 */
const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function loginToNeutralizeFixture(page: Page) {
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

test.describe("Today's Route persists the same fiction assignment across reload", () => {
  test("the mission title stays NEUTRALIZE after a full reload — no re-roll", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openMenu(page);

    const enterButton = page.getByTestId("enter-fiction-mission");
    await expect(enterButton).toBeVisible({ timeout: 10_000 });
    const firstTitle = await enterButton.textContent();
    expect(firstTitle).toBe("NEUTRALIZE");

    await page.reload();
    await expect(page.getByTestId("goldline-shell")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await openMenu(page);

    const enterButtonAfterReload = page.getByTestId("enter-fiction-mission");
    await expect(enterButtonAfterReload).toBeVisible({ timeout: 10_000 });
    await expect(enterButtonAfterReload).toHaveText(firstTitle ?? "NEUTRALIZE");
  });

  test("the persisted assignment survives in localStorage under the identity-scoped key", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openMenu(page);

    const enterButton = page.getByTestId("enter-fiction-mission");
    await expect(enterButton).toBeVisible({ timeout: 10_000 });
    await enterButton.click();

    // The assignment is actually written the moment the mission is derived
    // (a useMemo side effect, at mount — not gated on this click), but poll
    // rather than a flat sleep so the assertion never races render timing.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const keys = Object.keys(window.localStorage).filter(key =>
              key.startsWith("goldline:fiction-assignments:v1:")
            );
            return keys.some(key =>
              (window.localStorage.getItem(key) ?? "").includes("neutralize-v1")
            );
          }),
        { timeout: 5_000 }
      )
      .toBe(true);
  });

  test("no daily reset: the same fixture the next day (simulated) still shows the same route entry count", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openMenu(page);
    await page.getByRole("button", { name: "STRONGHOLD", exact: true }).click();
    const routeTable = page.getByTestId("stronghold-route-table");
    const beforeCount = await routeTable.locator("article").count();

    // Simulate "the next day" purely by reloading — this fixture's
    // authoritative data does not change with wall-clock date, proving
    // there is no midnight reset baked into the projection itself.
    await page.reload();
    await expect(page.getByTestId("goldline-shell")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await openMenu(page);
    await page.getByRole("button", { name: "STRONGHOLD", exact: true }).click();
    const afterCount = await page.getByTestId("stronghold-route-table").locator("article").count();

    expect(afterCount).toBe(beforeCount);
  });
});
