import { expect, type Page } from "@playwright/test";

/** Operator-demo command center: WorldGeographySurface + Home lanterns. */
export const WORLD_HOME = "/demo";
/** Live Lantern City: V6 composed scene. */
export const LANTERN_CITY_V6 = "/growth/lantern-city";

export async function dismissDriverOnboarding(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("goldline:day1:dismissed", "1");
    window.localStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["first_entry_explained"])
    );
  });
}

export async function expectDriverDayHome(page: Page) {
  await expect(page.getByTestId("driver-day-home")).toBeVisible({
    timeout: 30_000,
  });
}

export async function enterDriverOverland(page: Page) {
  await dismissDriverOnboarding(page);
  await page.goto("/driver");
  await expectDriverDayHome(page);
  await page.getByRole("button", { name: "Enter Overland" }).click();
  await expect(
    page.getByRole("region", { name: "JOYSTICK overworld" })
  ).toBeVisible({ timeout: 30_000 });
}

export async function expectLanternCityV6(page: Page) {
  await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible({
    timeout: 30_000,
  });
}

export async function enterTowerWarsFromStronghold(
  page: Page,
  buildingId: "opus_la" | "century_park_east"
) {
  await page.goto(LANTERN_CITY_V6);
  await expectLanternCityV6(page);
  await page.locator(`[data-scene-id="${buildingId}"]`).click();
  if (buildingId === "opus_la") {
    await expect(page).toHaveURL(/\/growth\/opus-la-inspection/);
    await page.getByRole("button", { name: /INITIATE TOWER WAR/i }).click();
  }
  await expect(page).toHaveURL(
    new RegExp(`tower-wars\\?building=${buildingId}`)
  );
  await expect(page.locator(".tw-arena")).toBeVisible();
}
