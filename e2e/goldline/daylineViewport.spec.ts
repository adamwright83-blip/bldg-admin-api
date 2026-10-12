import { devices, expect, test, type Page } from "@playwright/test";

const android = {
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: devices["Pixel 7"].deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
};
const desktop = {
  userAgent: devices["Desktop Chrome"].userAgent,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

async function expectViewportWorld(page: Page) {
  await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute(
    "data-art-ready",
    "true"
  );
  const metrics = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return {
      viewport: {
        width: visualViewport!.width,
        height: visualViewport!.height,
        scale: visualViewport!.scale,
      },
      frame: rect(".gdp-viewport-frame"),
      art: rect(".gdp-art-scene"),
      dock: rect(".gdp-approved-dock"),
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    };
  });
  expect(metrics.frame.x).toBeCloseTo(0, 0);
  expect(metrics.frame.width / metrics.viewport.width).toBeCloseTo(1, 2);
  expect(metrics.frame.height).toBeGreaterThanOrEqual(
    metrics.viewport.height - 2
  );
  expect(metrics.document.width).toBeLessThanOrEqual(
    metrics.viewport.width + 2
  );
  // No empty shell below the painted world. Long days are tested separately.
  expect(metrics.document.height - metrics.frame.bottom).toBeLessThanOrEqual(2);
  expect(metrics.art.width).toBeCloseTo(metrics.frame.width, 0);
  expect(metrics.art.height / metrics.art.width).toBeCloseTo(1672 / 941, 2);
  expect(metrics.dock.height / metrics.frame.width).toBeCloseTo(128 / 941, 2);
  expect(
    (metrics.frame.bottom - metrics.dock.bottom) / metrics.frame.width
  ).toBeCloseTo(36 / 941, 2);
  for (const name of [
    "Open Navigation Menu",
    "Claire, AI Guide",
    "LANTERN CITY",
    "DAY LINE",
    "COLLECTION",
    "BRIEFINGS",
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(-2);
    expect(box.x + box.width).toBeLessThanOrEqual(metrics.viewport.width + 2);
  }
  return metrics;
}

for (const [width, height, mobile] of [
  [360, 800, true],
  [393, 852, true],
  [430, 932, true],
  [529, 1237, false],
  [794, 1856, false],
] as const) {
  test.describe(`viewport ${width}x${height}`, () => {
    test.use({
      ...(mobile ? android : desktop),
      viewport: { width, height },
      screen: { width, height },
    });
    test("the approved world fills the viewport without a miniature canvas or black tail", async ({
      page,
    }) => {
      await page.goto("/driver?goldlineDayPlanFixture=art-approved");
      await expectViewportWorld(page);
      await page
        .getByRole("button", { name: "Open Navigation Menu", exact: true })
        .click();
      await expect(page.locator("#goldline-world-navigation")).toBeVisible();
    });
  });
}

test.describe("Android desktop-site viewport", () => {
  test.use({
    ...android,
    viewport: { width: 393, height: 852 },
    screen: { width: 393, height: 852 },
  });
  test("a 980px layout on a phone still gives the world the entire visible viewport", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Reproduce Chrome's desktop-site/legacy ideal viewport algorithm, not
      // merely a desktop browser resized to a phone-sized window.
      const observer = new MutationObserver(() => {
        const meta = document.querySelector('meta[name="viewport"]');
        if (!meta) return;
        meta.setAttribute("content", "width=980");
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    await page.goto("/driver?goldlineDayPlanFixture=active");
    await expect(page.locator(".gdp-shell")).toHaveClass(
      /gdp-shell--forced-mobile/
    );
    const first = await expectViewportWorld(page);
    expect(first.viewport.width).toBeGreaterThan(900);
    expect(first.viewport.scale).toBeLessThan(0.5);
    await page.reload();
    await expectViewportWorld(page);
  });
});

test.describe("viewport changes after artwork loads", () => {
  test.use({ ...android, viewport: { width: 393, height: 852 } });
  test("browser toolbar and orientation changes retain the world and its task actions", async ({
    page,
  }) => {
    await page.goto("/driver?goldlineDayPlanFixture=art-approved");
    await expectViewportWorld(page);
    const scene = await page.locator(".gdp-art-scene").elementHandle();
    for (const viewport of [
      { width: 393, height: 740 },
      { width: 852, height: 393 },
      { width: 393, height: 852 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page
            .locator(".gdp-shell")
            .evaluate(element =>
              parseFloat(element.style.getPropertyValue("--goldline-vvw"))
            )
        )
        .toBe(viewport.width);
      await expectViewportWorld(page);
      expect(
        await page
          .locator(".gdp-art-scene")
          .evaluate((element, original) => element === original, scene)
      ).toBe(true);
    }
    await page.locator(".gdp-object--pickup").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Los Feliz Towers");
    await scene?.dispose();
  });
});
