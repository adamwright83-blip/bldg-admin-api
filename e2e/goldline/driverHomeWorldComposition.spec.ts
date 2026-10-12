import { expect, test } from "@playwright/test";

test.describe("driver home playable-world composition", () => {
  test("keeps the world primary on a Pixel-class phone", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");
    const shell = page.locator(".gdp-shell");
    const scene = page.locator(".gdp-art-scene");
    await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute("data-art-ready", "true");
    const viewport = page.viewportSize()!;
    const shellBox = (await shell.boundingBox())!;
    expect(shellBox.x).toBeLessThanOrEqual(2);
    expect(shellBox.width).toBeGreaterThanOrEqual(viewport.width - 4);

    // The world is now a source-art SVG over a non-repeating clean backdrop.
    const backgroundRepeat = await scene.locator(".gdp-scene-backdrop").evaluate(element =>
      getComputedStyle(element).backgroundRepeat
    );
    expect(backgroundRepeat).toContain("no-repeat");
    await expect(scene.locator(".gdp-approved-art-layer")).toHaveAttribute("viewBox", "0 0 941 1672");
    for (const selector of [".gdp-menu-button", ".gdp-counts", ".gdp-summary", ".gdp-chapter-invite", ".gdp-trail-heading"]) {
      await expect(page.locator(selector)).toBeHidden();
    }

    const firstStop = page.locator(".gdp-object").first();
    await expect(firstStop).toBeVisible();
    const sceneBox = (await scene.boundingBox())!;
    const stopBox = (await firstStop.boundingBox())!;
    expect(stopBox.width).toBeLessThan(sceneBox.width * 0.4);
    await expect(page.locator(".gdp-world-avatar")).toBeVisible();

    for (const name of ["Open Navigation Menu", "Claire, AI Guide", "LANTERN CITY", "DAY LINE", "COLLECTION", "BRIEFINGS"]) {
      const tool = page.getByRole("button", { name, exact: true });
      await expect(tool).toBeVisible();
      const box = (await tool.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-3);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 3);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
    await expect(page.getByRole("navigation", { name: "Goldline Navigation", exact: true })).toBeVisible();
  });
});
