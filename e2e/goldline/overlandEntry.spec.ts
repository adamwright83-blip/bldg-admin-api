import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("canonical driver entry", () => {
  test("a fresh driver session begins on the real day, then can enter Overland and Field Operations", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/driver");

    await expect(page.getByTestId("driver-day-home")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("goldline-shell")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Goldline global overworld" })
    ).toHaveCount(0);

    // Exercise the actual Day Plan menu control. The role-based locator became
    // brittle when the mobile day shell changed its accessibility tree even
    // though the visible control remained the same physical button.
    const menuButton = page.locator("button.gdp-menu-button");
    await expect(menuButton).toBeVisible({ timeout: 10_000 });
    await menuButton.click();

    const exploreOverland = page
      .locator(".gdp-menu button")
      .filter({ hasText: "EXPLORE OVERLAND" });
    await expect(exploreOverland).toBeVisible({ timeout: 10_000 });
    await exploreOverland.click();

    await expect(
      page.getByRole("region", { name: "Goldline global overworld" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("goldline-shell")).toHaveCount(0);
    await expect(page.getByText("CLOCKHEAD", { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "Open Field Operations" }).click();
    await expect(page.getByTestId("goldline-shell")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("region", { name: "Goldline global overworld" })
    ).toHaveCount(0);
  });
});
