import { expect, test, type Page } from "@playwright/test";

/**
 * Computed-size regression for the mobile legibility floor this repair
 * enforces: ~18px for primary identity text, ~16px for actionable button
 * labels, ~14px for secondary/supporting text, at Pixel-class width (this
 * suite's fixed 412px viewport — see playwright.goldline.config.ts). A
 * prior PR already claimed mobile legibility while production remained
 * unreadable; this asserts actual `getComputedStyle` values, not source
 * strings, specifically to not repeat that mistake.
 */
test.describe.configure({ timeout: 90_000 });

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";
const SECONDARY_FLOOR = 14;
const ACTIONABLE_FLOOR = 16;
const PRIMARY_FLOOR = 18;

async function login(page: Page) {
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
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
}

async function computedPx(page: Page, selector: string): Promise<number> {
  const value = await page.locator(selector).first().evaluate(
    el => window.getComputedStyle(el).fontSize
  );
  return parseFloat(value);
}

test.describe("mobile typography floor", () => {
  test("top bar, corridor status, and next-objective guidance meet the legibility floor", async ({
    page,
  }) => {
    await login(page);
    await page.waitForTimeout(500);

    expect(await computedPx(page, ".game-topbar b")).toBeGreaterThanOrEqual(
      PRIMARY_FLOOR
    );
    expect(
      await computedPx(page, ".corridor-status")
    ).toBeGreaterThanOrEqual(SECONDARY_FLOOR);
    expect(
      await computedPx(page, ".action-awaiting")
    ).toBeGreaterThanOrEqual(SECONDARY_FLOOR);
  });

  test("Mission Fork list meets the legibility floor when expanded", async ({
    page,
  }) => {
    await login(page);
    await page.waitForTimeout(500);
    await page.locator(".mission-fork-toggle").click();
    const listItem = page.locator(".mission-fork-list > button").first();
    if (await listItem.count()) {
      const nameSize = await computedPx(page, ".mission-fork-list b");
      expect(nameSize).toBeGreaterThanOrEqual(PRIMARY_FLOOR);
      const metaSize = await computedPx(page, ".mission-fork-list small");
      expect(metaSize).toBeGreaterThanOrEqual(SECONDARY_FLOOR);
    }
  });

  test("Field Console buttons meet the actionable legibility floor", async ({
    page,
  }) => {
    await login(page);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Open field utilities" }).click();
    expect(
      await computedPx(page, ".field-console-grid button")
    ).toBeGreaterThanOrEqual(ACTIONABLE_FLOOR);
  });

  test("Live Route entries meet the legibility floor", async ({ page }) => {
    await login(page);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Open field utilities" }).click();
    await page.getByRole("button", { name: "LIVE ROUTE" }).click();
    const row = page.locator(".live-route-list article").first();
    if (await row.count()) {
      expect(
        await computedPx(page, ".live-route-list b")
      ).toBeGreaterThanOrEqual(SECONDARY_FLOOR);
      expect(
        await computedPx(page, ".live-route-list small")
      ).toBeGreaterThanOrEqual(SECONDARY_FLOOR);
      expect(
        await computedPx(page, ".live-route-list button")
      ).toBeGreaterThanOrEqual(SECONDARY_FLOOR);
    }
  });
});
