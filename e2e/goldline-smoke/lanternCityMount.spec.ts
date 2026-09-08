import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";
const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";
test.use({
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
});
test.describe.configure({ mode: "serial" });
test.describe("Lantern City V6 route and retained workflows", () => {
  test.beforeAll(async ({ request }) => {
    await resetGoldlineProofWorld(request);
  });
  test.beforeEach(async ({ page }) => {
    const login = await page.request.post("/api/auth/login", {
      data: { password: ADMIN_PASSWORD, role: "admin" },
    });
    expect(login.status()).toBe(200);
  });
  test("mounts a populated composed city without legacy lantern geometry", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto("/growth/lantern-city");
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible();
    await expect(page.locator("[data-scene-world]")).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator(
            '[data-scene-object="lantern"], [data-scene-object="stronghold"]'
          )
          .count()
      )
      .toBeGreaterThan(0);
    await expect(page.locator('[data-scene-object="stronghold"]')).toHaveCount(
      2
    );
    await expect(
      page.locator('[data-lantern-city="v6"] .lc-lantern')
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
  test("customer selection opens the real inspector and returns to the city", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city");
    const target = page.locator('[data-scene-object="lantern"]').first();
    await expect(target).toBeVisible();
    await target.click();
    await expect(page.locator(".owi")).toBeVisible();
    await expect(page.locator('[data-selected="true"]')).toHaveCount(1);
    await page
      .getByRole("button", {
        name: "Return to the same city location",
        exact: true,
      })
      .click();
    await expect(page.locator(".owi")).toHaveCount(0);
  });
  test("both canonical strongholds still enter Tower Wars", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    for (const id of ["opus_la", "century_park_east"]) {
      await page.goto("/growth/lantern-city");
      await page.locator(`[data-scene-id="${id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`tower-wars\\?building=${id}`));
      await expect(page.locator(".tw-arena")).toBeVisible();
      await expect
        .poll(() => page.locator(".tw-piece").count())
        .toBeGreaterThan(1);
    }
    expect(errors).toEqual([]);
  });
  test("each stronghold's tower and attached customer light are independent hit targets", async ({
    page,
  }) => {
    for (const id of ["opus_la", "century_park_east"]) {
      await page.goto("/growth/lantern-city");
      const light = page.locator(
        `[data-scene-id="${id}"] [data-scene-target="light"]`
      );
      await expect(light).toBeVisible();
      await light.click();
      await expect(page.locator(".owi")).toBeVisible();
      await expect(page).toHaveURL(/\/growth\/lantern-city/);
      await expect(page).not.toHaveURL(/tower-wars/);

      await page.goto("/growth/lantern-city");
      await page
        .locator(`[data-scene-id="${id}"] [data-scene-target="tower"]`)
        .click();
      await expect(page).toHaveURL(new RegExp(`tower-wars\\?building=${id}`));
      await expect(page.locator(".tw-arena")).toBeVisible();
    }
  });
  test("frozen V5 is still available for comparison", async ({ page }) => {
    await page.goto("/growth/lantern-city?scene=v5");
    await expect(page.locator(".lc-page.lc-v5-game")).toBeVisible();
    await expect(page.locator('[data-lantern-city="v6"]')).toHaveCount(0);
  });
});
