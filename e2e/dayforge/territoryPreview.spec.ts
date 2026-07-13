import { expect, test } from "@playwright/test";

test("public territory preview renders its safe starting state", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => consoleErrors.push(error.message));

  await page.goto("/territory-preview?utm_source=release_gate&utm_content=render");
  await expect(page.getByTestId("dayforge-territory-preview")).toBeVisible();
  await expect(page.getByLabel(/store address or business name/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /map my territory/i })).toBeDisabled();
  await expect(page.getByText(/no business is contacted/i)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("public territory preview renders, discovers, and resumes", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => consoleErrors.push(error.message));

  await page.goto("/territory-preview?utm_source=release_gate&utm_content=e2e");
  await expect(page.getByTestId("dayforge-territory-preview")).toBeVisible();
  await page.getByLabel(/store address or business name/i).fill(
    "100 Release Gate Way, Los Angeles, CA 90012"
  );
  await page.getByRole("button", { name: /map my territory/i }).click();

  const results = page.getByTestId("territory-preview-results");
  await expect(results).toBeVisible({ timeout: 30_000 });
  await expect(results).toContainText("Westview Property Management");

  await page.reload();
  await expect(page.getByTestId("territory-preview-results")).toContainText(
    "Westview Property Management",
    { timeout: 30_000 }
  );
  expect(consoleErrors).toEqual([]);
});
