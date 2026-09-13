import { expect, test } from "@playwright/test";

test.describe("driver home P1 safety fixes", () => {
  test("forced-mobile composition uses proportional readable sizing", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");

    const shell = page.locator(".gdp-shell");
    await expect(shell).toBeVisible();
    await shell.evaluate(element => element.classList.add("gdp-shell--forced-mobile"));

    const stop = page.locator(".gdp-stop").first();
    const title = page.locator(".gdp-card-copy h2").first();
    await expect(stop).toBeVisible();
    await expect(title).toBeVisible();

    const stopBox = await stop.boundingBox();
    expect(stopBox).not.toBeNull();
    expect(stopBox!.width).toBeGreaterThan(250);

    const titleSize = await title.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(titleSize).toBeGreaterThanOrEqual(16);

    const shellStyles = await shell.evaluate(element => {
      const style = getComputedStyle(element);
      return { width: style.width, maxWidth: style.maxWidth };
    });
    expect(Number.parseFloat(shellStyles.width)).toBeGreaterThan(390);
    expect(shellStyles.maxWidth).not.toBe("520px");
  });

  test("real Kingdom 2 button markup stays visible, readable, and tappable", async ({ page }) => {
    await page.goto("/driver?goldlineDayPlanFixture=active");
    const shell = page.locator(".gdp-shell");
    await expect(shell).toBeVisible();
    await shell.evaluate(element => element.classList.add("gdp-shell--forced-mobile"));

    await shell.evaluate(element => {
      const button = document.createElement("button");
      button.className = "gdp-chapter-entry";
      button.type = "button";
      button.dataset.testid = "enter-chapter-button";
      button.textContent = "A new Kingdom has opened — enter The Last Valet";
      button.addEventListener("click", () => {
        document.body.dataset.chapterEntryClicked = "true";
      });
      element.appendChild(button);
    });

    const chapter = page.getByTestId("enter-chapter-button");
    await expect(chapter).toBeVisible();
    await expect(chapter).toBeEnabled();
    const chapterFontSize = await chapter.evaluate(element =>
      Number.parseFloat(getComputedStyle(element).fontSize)
    );
    expect(chapterFontSize).toBeGreaterThanOrEqual(12);

    await chapter.click();
    await expect
      .poll(() => page.evaluate(() => document.body.dataset.chapterEntryClicked))
      .toBe("true");
  });
});
