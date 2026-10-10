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
    await page.goto("/growth/lantern-city?scene=v6");
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible();
    await expect(page.locator("[data-scene-world]")).toBeVisible();
    // Diagnose proof-data availability without logging customer records.
    const proof = await page.evaluate(async () => {
      const summary = async (name: string) => {
        const response = await fetch(`/api/trpc/system.${name}`, { credentials: "include" });
        const body = await response.json().catch(() => ({}));
        const value = body?.result?.data?.json ?? body?.result?.data ?? {};
        return {
          status: response.status,
          customerCount: Array.isArray(value.customers) ? value.customers.length : undefined,
          territoriesCount: Array.isArray(value) ? value.length : undefined,
          error: body?.error?.message ?? null,
        };
      };
      return {
        geography: await summary("geographicTruth.myAtlas"),
        territories: await summary("goldlineWorld.territories"),
      };
    });
    console.log("[Lantern City proof-data availability]", JSON.stringify(proof));
    expect(proof.geography.status, "tenant-scoped atlas must be authorized").toBe(200);
    expect(proof.territories.status, "tenant-scoped territories must be authorized").toBe(200);

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
    await page.goto("/growth/lantern-city?scene=v6");
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
      await page.goto("/growth/lantern-city?scene=v6");
      await page.locator(`[data-scene-id="${id}"]`).click();
      if (id === "opus_la") {
        await expect(page).toHaveURL(/\/growth\/opus-la-inspection/);
        await page.getByRole("button", { name: /INITIATE TOWER WAR/i }).click();
      }
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
      await page.goto("/growth/lantern-city?scene=v6");
      const light = page.locator(
        `[data-scene-id="${id}"] [data-scene-target="light"]`
      );
      if ((await light.count()) === 0) {
        // Proof world may have a stronghold with no attached live customer.
        await page.locator(`[data-scene-id="${id}"] [data-scene-target="tower"]`).click();
        if (id === "opus_la") {
          await expect(page).toHaveURL(/\/growth\/opus-la-inspection/);
          await page.getByRole("button", { name: /INITIATE TOWER WAR/i }).click();
        }
        await expect(page).toHaveURL(new RegExp(`tower-wars\\?building=${id}`));
        continue;
      }
      await expect(light).toBeVisible();
      await light.click();
      await expect(page.locator(".owi")).toBeVisible();
      await expect(page).toHaveURL(/\/growth\/lantern-city/);
      await expect(page).not.toHaveURL(/tower-wars/);

      await page.goto("/growth/lantern-city?scene=v6");
      await page
        .locator(`[data-scene-id="${id}"] [data-scene-target="tower"]`)
        .click();
      if (id === "opus_la") {
        await expect(page).toHaveURL(/\/growth\/opus-la-inspection/);
        await page.getByRole("button", { name: /INITIATE TOWER WAR/i }).click();
      }
      await expect(page).toHaveURL(new RegExp(`tower-wars\\?building=${id}`));
      await expect(page.locator(".tw-arena")).toBeVisible();
    }
  });
  for (const [name, url, scene] of [
    ["the Lantern City route opens the island board", "/growth/lantern-city", "islands"],
    ["?scene=map still opens the V7 street map for QA", "/growth/lantern-city?scene=map", "v7"],
  ] as const) {
    test(name, async ({ page }, testInfo) => {
      // the 3D boards are the desktop view (the driver Day Line app is the mobile experience)
      test.skip(testInfo.project.name === "mobile", "3D boards are desktop-only");
      // No WebGL here on purpose: CI's software renderer spends ~15 s just starting a 3D world, and
      // this lane has a 5-minute budget. What this proves is the route, the React board, the
      // customer atlas arriving, and the plain "could not load" fallback a no-WebGL browser gets:
      // never a crash.
      await page.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          return /webgl/i.test(type) ? null : (get as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
        } as typeof HTMLCanvasElement.prototype.getContext;
      });
      const errors: string[] = [];
      page.on("pageerror", e => errors.push(String(e)));
      const atlas = page.waitForResponse(r => r.url().includes("geographicTruth.atlas"));
      await page.goto(url, { waitUntil: "commit" });
      const board = page.locator(`[data-lantern-city="${scene}"]`);
      await expect(board).toBeVisible({ timeout: 30_000 });
      await expect(board.locator('[data-lantern-state="failed"]')).toBeVisible();
      await atlas;
      await expect(board).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
  test("legacy scene=v5 query still opens the live V6 city", async ({ page }) => {
    await page.goto("/growth/lantern-city?scene=v5");
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible();
  });
});
