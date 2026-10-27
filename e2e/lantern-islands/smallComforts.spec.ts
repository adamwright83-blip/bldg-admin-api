import { expect, test } from "@playwright/test";
test("Tin Can House opens the real Small Comforts game and exit preserves tenant customer state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.goto("/e2e/lantern-islands/fixture.html");
  const board = page.getByLabel("Lantern City island board");
  await expect(board).toHaveAttribute("data-customer-keys", "fixture-customer");
  await page.getByRole("button", { name: "Tin Can House · Small Comforts" }).click();
  const game = page.locator('[data-small-comforts="game"]');
  await expect(game).toBeVisible();
  await expect(board).toHaveAttribute("data-paused", "true");
  await expect(game.locator("iframe")).toHaveAttribute("src", "/small-comforts/index.html");
  await game.getByRole("button", { name: /Lantern City/ }).click();
  await expect(game).toHaveCount(0);
  await expect(board).toHaveAttribute("data-paused", "false");
  await expect(board).toHaveAttribute("data-focus-island", "Hollywood");
  await expect(board).toHaveAttribute("data-customer-keys", "fixture-customer");
  expect(errors).toEqual([]);
});
