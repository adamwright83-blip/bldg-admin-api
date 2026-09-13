import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("canonical driver entry", () => {
  test("a fresh driver session begins on Today's Day Plan and enters Overland deliberately", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/driver");

    // The real day is now the canonical home. Neither the traversal renderer
    // nor Overland should swallow the route before the operator chooses them.
    await expect(page.getByTestId("driver-day-home")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator(".gdp-shell")).toBeVisible();
    await expect(page.getByTestId("goldline-shell")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Goldline global overworld" })
    ).toHaveCount(0);
    await expect(page.getByText("CLOCKHEAD", { exact: false })).toHaveCount(0);

    // World entry is now a deliberate action from Today, not the default boot
    // surface and not an old Field Operations dashboard detour.
    await page.getByRole("button", { name: /ENTER THE WORLD/i }).click();
    await expect(
      page.getByRole("region", { name: "Goldline global overworld" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("driver-day-home")).toHaveCount(0);
    await expect(page.getByTestId("goldline-shell")).toHaveCount(0);
  });
});
