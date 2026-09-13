import { expect, test } from "@playwright/test";

test.describe("driver home playable-world composition", () => {
  test("keeps the world primary on a Pixel-class phone", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");

    const shell = page.locator(".gdp-shell");
    await expect(shell).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();

    // The live app previously rendered as a narrow desktop canvas with dark
    // gutters. The approved composition owns the phone width.
    expect(shellBox!.x).toBeLessThanOrEqual(2);
    expect(shellBox!.width).toBeGreaterThanOrEqual(viewport!.width - 4);

    const shellStyles = await shell.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        backgroundRepeat: style.backgroundRepeat,
        overflowX: style.overflowX,
      };
    });
    expect(shellStyles.backgroundRepeat).toContain("no-repeat");
    expect(["clip", "hidden"]).toContain(shellStyles.overflowX);

    // Dashboard chrome is not allowed to reclaim the hero field.
    for (const selector of [
      ".gdp-menu-button",
      ".gdp-counts",
      ".gdp-summary",
      ".gdp-chapter-invite",
      ".gdp-trail-heading",
    ]) {
      await expect(page.locator(selector)).toBeHidden();
    }

    // Stops are landmarks on the Gold Line, not full-width dashboard rows.
    const firstStop = page.locator(".gdp-stop").first();
    await expect(firstStop).toBeVisible();
    const stopBox = await firstStop.boundingBox();
    expect(stopBox).not.toBeNull();
    expect(stopBox!.width).toBeLessThan(viewport!.width * 0.74);

    // Trailblazer is a board piece large enough to read as the player.
    const operator = page.locator(".gdp-now img").first();
    await expect(operator).toBeVisible();
    const operatorBox = await operator.boundingBox();
    expect(operatorBox).not.toBeNull();
    expect(operatorBox!.height).toBeGreaterThanOrEqual(90);

    // Diegetic tools must be genuinely tappable and remain inside the world.
    for (const selector of [
      ".gdp-claire-tool",
      ".gdp-manifest-tool",
      ".gdp-overland-tool",
      ".gdp-vehicle-key",
    ]) {
      const tool = page.locator(selector);
      await expect(tool).toBeVisible();
      const box = await tool.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-3);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 3);
      expect(box!.y).toBeGreaterThanOrEqual(0);
    }

    await expect(page.locator(".gdp-next-up")).toBeVisible();
    await expect(page.locator(".gdp-game-nav")).toBeVisible();
  });
});
