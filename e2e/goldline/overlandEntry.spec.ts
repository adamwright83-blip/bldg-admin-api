import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("canonical driver entry", () => {
  test("a fresh driver session begins on Overland, not inside Clockhead", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/driver");

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
