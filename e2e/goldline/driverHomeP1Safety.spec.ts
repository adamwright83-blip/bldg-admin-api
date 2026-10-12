import { expect, test } from "@playwright/test";

test.describe("driver home P1 safety fixes", () => {
  test("forced-mobile composition uses proportional readable sizing", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");
    const shell = page.locator(".gdp-shell");
    await expect(shell).toBeVisible();
    await shell.evaluate(element => element.classList.add("gdp-shell--forced-mobile"));
    await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute("data-art-ready", "true");

    const stop = page.locator(".gdp-object").first();
    const title = stop.locator(".gdp-object-surface strong");
    await expect(title).toBeVisible();
    const sceneBox = (await page.locator(".gdp-art-scene").boundingBox())!;
    const stopBox = (await stop.boundingBox())!;
    expect(stopBox.width / sceneBox.width).toBeGreaterThan(0.2);
    expect(stopBox.width / sceneBox.width).toBeLessThan(0.4);
    const titleSize = await title.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(titleSize / sceneBox.width).toBeCloseTo(0.0196, 3);

    const shellStyles = await shell.evaluate(element => {
      const style = getComputedStyle(element);
      return { width: style.width, maxWidth: style.maxWidth };
    });
    expect(Number.parseFloat(shellStyles.width)).toBeGreaterThan(390);
    expect(shellStyles.maxWidth).not.toBe("520px");
  });

  test("the real Kingdom action remains readable and tappable in approved navigation", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");
    const map = page.getByRole("button", { name: "Open Navigation Menu", exact: true });
    await expect(map).toHaveAttribute("aria-expanded", "false");
    await map.click();
    await expect(map).toHaveAttribute("aria-expanded", "true");
    const chapter = page.getByRole("button", { name: "ENTER KINGDOM", exact: true });
    await expect(chapter).toBeVisible();
    await expect(chapter).toBeEnabled();
    const chapterFontSize = await chapter.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    const missionFontSize = await page.getByTestId("build-mission-cta").evaluate(element =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(chapterFontSize).toBe(missionFontSize);
    expect((await chapter.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await chapter.click();
    await expect.poll(() => page.evaluate(() => document.body.dataset.chapterEntered)).toBe("true");
    await expect(map).toHaveAttribute("aria-expanded", "false");
  });
});
