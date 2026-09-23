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
      page.getByRole("region", { name: "JOYSTICK overworld" })
    ).toHaveCount(0);

    // Exercise the canonical diegetic Overland control that the driver actually
    // sees. The legacy Day Plan menu is intentionally hidden by world-tool CSS;
    // forcing it visible creates an overlapping, unreachable duplicate control.
    const exploreOverland = page.getByRole("button", { name: "Enter Overland" });
    await expect(exploreOverland).toBeVisible({ timeout: 10_000 });
    await exploreOverland.click();

    await expect(
      page.getByRole("region", { name: "JOYSTICK overworld" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("goldline-shell")).toHaveCount(0);
    await expect(page.getByText("CLOCKHEAD", { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "Open Field Operations" }).click();
    await expect(page.getByTestId("goldline-shell")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("region", { name: "JOYSTICK overworld" })
    ).toHaveCount(0);
  });
});