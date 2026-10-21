import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

test.describe("Home city clicks stay on separate destinations", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("Opus LA opens building inspection", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByTestId("home-city-clicks")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("home-click-building-inspection").click();
    await expect(page).toHaveURL(/\/growth\/opus-la-inspection/);
    await expect(page).not.toHaveURL(/tower-wars/);
  });

  test("Century Park East opens Tower Wars", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByTestId("home-click-tower-wars")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("home-click-tower-wars").click();
    await expect(page).toHaveURL(/\/growth\/tower-wars\?building=century_park_east/);
    await expect(page.locator(".tw-arena")).toBeVisible({ timeout: 30_000 });
  });

  test("a customer inspection does not enter Tower Wars", async ({ page }) => {
    await page.goto("/home");
    const button = page.getByTestId("home-click-customer-inspection");
    await expect(button).toBeVisible({ timeout: 30_000 });
    const customerId = await button.getAttribute("data-customer-id");
    expect(customerId && customerId !== "phone:3105550141").toBeTruthy();
    await button.click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page).not.toHaveURL(/tower-wars/);
    await expect(page.getByTestId("home-customer-inspection")).toHaveAttribute(
      "data-customer-id",
      customerId!
    );
  });

  test("Mei Lin opens the Silver Lake villager with her identity intact", async ({ page }) => {
    await page.goto("/home");
    const button = page.locator('[data-testid="home-click-silver-lake"][data-customer-id="phone:3105550141"]');
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();
    await expect(page).toHaveURL(/cozy=1/);
    await expect(page).toHaveURL(/territory=silver-lake/);
    await expect(page).toHaveURL(/customer=phone%3A3105550141/);
    await expect(page).not.toHaveURL(/tower-wars/);
    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 20_000 });
    const villager = page.getByTestId("silver-lake-villager");
    await expect(villager).toHaveCount(1, { timeout: 15_000 });
    await expect(villager).toHaveAttribute("data-customer-id", "phone:3105550141");
    await expect(page.locator('aside[aria-label="Customer Outreach Composer"]')).toHaveAttribute(
      "data-customer-id",
      "phone:3105550141"
    );
  });
});
