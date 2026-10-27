import { expect, test } from "@playwright/test";

test("Report mode is read-only and Explore still opens the cozy house", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method())) writes.push(`${request.method()} ${request.url()}`);
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/e2e/lantern-islands/fixture.html");
  await expect(page.getByRole("tab", { name: "Explore" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Tin Can House · Small Comforts" })).toBeVisible();
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.getByRole("note")).toContainText("Fixture figures — not live sales.");
  await expect(page.getByLabel("Lantern City report")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tin Can House · Small Comforts" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Silver Lake" }).click();
  await expect(page.locator("[data-report-revenue]")).toContainText("Silver Lake");
  await expect(page.locator("[data-report-revenue]")).toContainText("$45.00");
  await page.getByRole("button", { name: "90 days" }).click();
  await expect(page.getByLabel("Lantern City report")).toContainText("the last 90 days");
  await page.screenshot({
    path: "test-results/lantern-report-desktop.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("tab", { name: "Report" })).toBeVisible();
  await page.screenshot({
    path: "test-results/lantern-report-mobile.png",
  });
  await page.getByRole("tab", { name: "Explore" }).click();
  await expect(page.getByRole("button", { name: "Tin Can House · Small Comforts" })).toBeVisible();
  await page.getByRole("button", { name: "Tin Can House · Small Comforts" }).click();
  await expect(page.locator('[data-small-comforts="game"]')).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
