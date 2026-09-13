import { expect, test } from "@playwright/test";

const PHONE = { width: 412, height: 923 };

test.describe("driver home playable-world composition", () => {
  test.use({ viewport: PHONE });

  test("world owns the phone while route landmarks and diegetic tools stay readable", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");

    const shell = page.locator(".gdp-shell");
    await expect(shell).toBeVisible();

    // The dashboard-era chrome must not re-enter the visual hierarchy.
    await expect(page.locator(".gdp-menu-button")).toBeHidden();
    await expect(page.locator(".gdp-counts")).toBeHidden();
    await expect(page.locator(".gdp-summary")).toBeHidden();
    await expect(page.locator(".gdp-chapter-invite")).toBeHidden();

    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(shellBox!.width).toBeGreaterThanOrEqual(PHONE.width * 0.98);

    // Stops are landmarks attached to the Gold Line, not full-width SaaS rows.
    const stop = page.locator(".gdp-stop").first();
    await expect(stop).toBeVisible();
    const stopBox = await stop.boundingBox();
    expect(stopBox).not.toBeNull();
    expect(stopBox!.width).toBeLessThan(PHONE.width * 0.7);
    expect(stopBox!.width).toBeGreaterThan(180);

    // Trailblazer is a board piece; the old NOW diagnostic box is not visible.
    await expect(page.locator(".gdp-now img").first()).toBeVisible();
    await expect(page.locator(".gdp-now > div").first()).toBeHidden();

    // Core world tools remain inside the phone canvas rather than clipping off-screen.
    for (const selector of [
      ".gdp-claire-tool",
      ".gdp-manifest-tool",
      ".gdp-overland-tool",
      ".gdp-vehicle-key",
    ]) {
      const tool = page.locator(selector).first();
      await expect(tool).toBeVisible();
      const box = await tool.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-3);
      expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width + 3);
    }

    const nextUp = page.getByTestId("day-plan-next-up");
    await expect(nextUp).toBeVisible();
    const nextBox = await nextUp.boundingBox();
    expect(nextBox).not.toBeNull();
    expect(nextBox!.height).toBeLessThanOrEqual(90);

    const nav = page.locator(".gdp-game-nav");
    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox!.height).toBeLessThanOrEqual(70);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
