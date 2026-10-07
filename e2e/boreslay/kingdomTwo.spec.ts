import { expect, test } from "@playwright/test";

test("Boreslay Duel accepts real mobile input on the exact browser build", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.goto("/e2e/boreslay/fixture.html?debug=1&seed=424242");

  await expect(
    page.getByRole("heading", { name: "EXCUSE RALLY" })
  ).toBeVisible();
  await page.getByRole("button", { name: "ENTER THE RALLY" }).tap();
  await expect(page.getByRole("button", { name: "Pause rally" })).toBeVisible();

  const start = await page.evaluate(() => {
    const engine = (window as any).__boreslayRallyEngine;
    if (!engine) throw new Error("Boreslay debug engine was not exposed");
    return {
      tick: engine.state.tick as number,
      x: engine.state.spark.x as number,
      status: engine.state.status as string,
    };
  });
  expect(start.status).toBe("playing");

  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(220);
  await page.keyboard.up("ArrowRight");

  const moved = await page.evaluate(() => {
    const engine = (window as any).__boreslayRallyEngine;
    if (!engine) throw new Error("Boreslay debug engine disappeared");
    return {
      tick: engine.state.tick as number,
      x: engine.state.spark.x as number,
    };
  });
  expect(moved.tick).toBeGreaterThan(start.tick);
  expect(moved.x).toBeGreaterThan(start.x + 5);

  await page.getByRole("button", { name: "JUMP" }).tap();
  await page.waitForTimeout(30);
  const jump = await page.evaluate(() => {
    const engine = (window as any).__boreslayRallyEngine;
    if (!engine) throw new Error("Boreslay debug engine disappeared");
    return {
      vy: engine.state.duel.spark.vy as number,
      grounded: engine.state.duel.spark.grounded as boolean,
    };
  });
  expect(jump.grounded).toBe(false);
  expect(jump.vy).toBeLessThan(0);

  await expect(page.getByRole("button", { name: "STRIKE" })).toBeVisible();
  await expect(page.getByRole("button", { name: "LOFT" })).toBeVisible();
  await expect(page.getByRole("button", { name: "POWER" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
