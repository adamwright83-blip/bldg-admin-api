import { expect, test } from "@playwright/test";

const PHONE = { width: 412, height: 923 };

test.describe("driver home playable-world composition", () => {
  test.use({ viewport: PHONE });

  test("world owns the phone while route landmarks and diegetic tools stay readable", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");
    const shell = page.locator(".gdp-shell");
    const scene = page.locator(".gdp-art-scene");
    await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute("data-art-ready", "true");

    for (const selector of [".gdp-menu-button", ".gdp-counts", ".gdp-summary", ".gdp-chapter-invite"]) {
      await expect(page.locator(selector)).toBeHidden();
    }

    const shellBox = (await shell.boundingBox())!;
    const sceneBox = (await scene.boundingBox())!;
    expect(shellBox.width).toBeGreaterThanOrEqual(PHONE.width * 0.98);
    expect(sceneBox.height / sceneBox.width).toBeCloseTo(1672 / 941, 2);

    // Each live stop remains a compact landmark with its own native action.
    await expect(page.locator(".gdp-object")).toHaveCount(9);
    const stop = page.locator(".gdp-object").first();
    await expect(stop).toBeVisible();
    const stopBox = (await stop.boundingBox())!;
    expect(stopBox.width / sceneBox.width).toBeGreaterThan(0.2);
    expect(stopBox.width / sceneBox.width).toBeLessThan(0.4);

    await expect(scene.locator(".gdp-approved-art-layer image")).toHaveAttribute("href", /approved-reference\.png$/);
    await expect(page.locator(".gdp-world-avatar")).toHaveAttribute("data-verified-progress", /0\.[0-9]+/);

    for (const tool of [
      page.getByRole("button", { name: "Open Navigation Menu", exact: true }),
      page.getByRole("button", { name: "Claire, AI Guide", exact: true }),
      ...["LANTERN CITY", "DAY LINE", "COLLECTION", "BRIEFINGS"].map(name =>
        page.getByRole("button", { name, exact: true })
      ),
    ]) {
      await expect(tool).toBeVisible();
      const box = (await tool.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(-3);
      expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width + 3);
    }

    const dock = page.getByRole("navigation", { name: "Goldline Navigation", exact: true });
    const dockBox = (await dock.boundingBox())!;
    expect(dockBox.height / sceneBox.width).toBeCloseTo(128 / 941, 2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    // The approved map control preserves the mission builder without adding
    // dashboard chrome over the artwork.
    await page.getByRole("button", { name: "Open Navigation Menu", exact: true }).click();
    await page.getByTestId("build-mission-cta").click();
    await page.getByRole("button", { name: /In-person mission/i }).click();
    await page.getByRole("button", { name: /Luxury living/i }).click();
    await expect(page.getByText("Enter the property name or street address first.")).toBeVisible();
    await expect(page.getByLabel("Mission search location")).toBeFocused();
    await page.getByLabel("Close mission builder").click();

    const title = await stop.locator(".gdp-object-surface strong").textContent();
    await stop.click();
    await expect(page.getByRole("dialog").getByRole("heading")).toHaveText(title!);
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.scrollTo({ left: 0, top: 0, behavior: "instant" }));

  });
});
