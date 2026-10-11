import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const output = "artifacts/goldline-graphic-actions";
mkdirSync(output, { recursive: true });
for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    for (const [state, count] of [
      ["one", 1],
      ["three", 3],
      ["sales", 4],
      ["mixed", 5],
      ["eight", 8],
      ["eight-sales", 8],
      ["long", 5],
      ["missing", 5],
      ["completed", 5],
    ] as const) {
      test(`${state}: readable physical objects retain data and independent actions`, async ({
        page,
      }) => {
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto(`/driver?goldlineDayPlanFixture=art-${state}`);
        const world = page.locator(".gdp-illustrated-world");
        const objects = page.locator(".gdp-object");
        await expect(objects).toHaveCount(count);
        await expect(world).toHaveAttribute("data-art-ready", "true");
        expect(
          await objects.evaluateAll(
            els =>
              new Set(els.map(e => e.getAttribute("data-action-slot-id"))).size
          )
        ).toBe(count);
        expect(
          await page.locator(".gdp-v3-action,.gdp-v3-inscriptions").count()
        ).toBe(0);
        for (let i = 0; i < count; i++) {
          const object = objects.nth(i);
          await object.scrollIntoViewIfNeeded();
          await expect(object).toBeVisible();
          const metrics = await object.evaluate(el => {
            const surface = el.querySelector(".gdp-object-surface")!;
            const style = getComputedStyle(surface);
            const box = surface.getBoundingClientRect(),
              objectBox = el.getBoundingClientRect();
            const title = surface.querySelector("strong")!;
            return {
              id: el.getAttribute("data-action-slot-id"),
              title: title.textContent!,
              background: style.backgroundColor,
              border: style.borderTopWidth,
              overflow: surface.scrollHeight - surface.clientHeight,
              left: box.left,
              right: box.right,
              objectLeft: objectBox.left,
              objectRight: objectBox.right,
              font: parseFloat(getComputedStyle(title).fontSize),
            };
          });
          expect(metrics.background).toBe("rgba(0, 0, 0, 0)");
          expect(metrics.border).toBe("0px");
          expect(metrics.overflow).toBeLessThanOrEqual(2);
          expect(metrics.font).toBeGreaterThanOrEqual(13);
          expect(metrics.left).toBeGreaterThanOrEqual(metrics.objectLeft - 2);
          expect(metrics.right).toBeLessThanOrEqual(metrics.objectRight + 2);
          await object.click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          await expect(dialog.getByRole("heading")).toHaveText(metrics.title);
          if (state === "long")
            await expect(dialog).toContainText("United States");
          await page.keyboard.press("Escape");
          await expect(dialog).toBeHidden();
        }
        if (state === "sales" || state === "eight-sales")
          await expect(page.locator('[data-art-landmark="sales"]')).toHaveCount(
            1
          );
        if (state === "missing")
          expect(await page.locator(".gdp-object-address").count()).toBe(0);
        if (state === "completed")
          expect(
            await page.locator('[data-visual-state="ready_to_open"]').count()
          ).toBe(3);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${output}/${state}-${viewport.width}.png`,
          fullPage: true,
        });
        expect(errors).toEqual([]);
      });
    }
    test("cold async load, scrolling and verified-only progress", async ({
      page,
    }) => {
      await page.goto("/driver?goldlineDayPlanFixture=art-mixed", {
        waitUntil: "domcontentloaded",
      });
      const start = Date.now();
      for (const seconds of [0, 1, 3, 8]) {
        if (seconds)
          await page.waitForTimeout(
            Math.max(0, seconds * 1000 - (Date.now() - start))
          );
        await page.screenshot({
          path: `${output}/cold-${viewport.width}-${seconds}s.png`,
        });
      }
      await expect(page.locator(".gdp-object")).toHaveCount(5);
      await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute(
        "data-art-ready",
        "true"
      );
      const avatar = page.locator(".gdp-world-avatar");
      await expect(avatar).toBeVisible();
      await expect(avatar).toHaveAttribute("data-verified-progress", "0");
      await page.evaluate(() => window.scrollTo(0, 550));
      await expect(avatar).toBeInViewport();
      await page.screenshot({
        path: `${output}/scrolled-${viewport.width}.png`,
      });
      await expect(avatar).toHaveAttribute("data-verified-progress", "0");
      await page.locator(".gdp-object").first().click();
      await page.keyboard.press("Escape");
      await expect(avatar).toHaveAttribute("data-verified-progress", "0");
      await page.getByTestId("fixture-record-completion").click();
      await expect(avatar).toHaveAttribute("data-verified-progress", "0.2");
      await page.reload();
      await expect(page.locator(".gdp-object")).toHaveCount(5);
      await expect(avatar).toHaveAttribute("data-verified-progress", "0");
    });
  });
}
test("failed artwork remains unready and can be retried", async ({ page }) => {
  const url = "**/goldline/dayline-v2/objects/dropoff.webp";
  await page.route(url, route => route.abort());
  await page.goto("/driver?goldlineDayPlanFixture=art-mixed");
  await expect(page.getByRole("alert")).toContainText("artwork could not load");
  await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute(
    "data-art-ready",
    "false"
  );
  await page.unroute(url);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute(
    "data-art-ready",
    "true"
  );
});
