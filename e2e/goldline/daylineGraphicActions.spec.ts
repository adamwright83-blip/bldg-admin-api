import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const output =
  process.env.DAYLINE_CAPTURE_DIR ?? "artifacts/goldline-graphic-actions";
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
              sceneWidth: el
                .closest(".gdp-illustrated-world")!
                .getBoundingClientRect().width,
            };
          });
          expect(metrics.background).toBe("rgba(0, 0, 0, 0)");
          expect(metrics.border).toBe("0px");
          expect(metrics.overflow).toBeLessThanOrEqual(2);
          // Type remains proportional to the approved 941px artwork, without
          // changing the outer viewport/page scale owned by the Driver shell.
          expect(metrics.font / metrics.sceneWidth).toBeCloseTo(0.0196, 3);
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
    test("post-ready projection updates retain the approved scene", async ({
      page,
    }) => {
      await page.goto("/driver?goldlineDayPlanFixture=art-mixed");
      const world = page.locator(".gdp-illustrated-world");
      const scene = page.locator(".gdp-art-scene");
      const objects = page.locator(".gdp-object");
      await expect(world).toHaveAttribute("data-art-ready", "true");
      await expect(objects).toHaveCount(5);
      await expect(page.locator(".gdp-approved-art-layer")).toBeVisible();
      await expect(page.locator(".gdp-approved-header")).toBeVisible();
      await expect(page.locator(".gdp-approved-dock")).toBeVisible();

      const initialScene = await scene.elementHandle();
      const initialIds = await objects.evaluateAll(elements =>
        elements.map(element => element.getAttribute("data-action-slot-id"))
      );
      expect(initialScene).not.toBeNull();

      // The fixture delivers a new projection after the artwork is already
      // visible. Updating verified status must preserve the restored renderer.
      await page.getByTestId("fixture-record-completion").click();
      await expect(objects.first()).toHaveAttribute(
        "data-visual-state",
        "ready_to_open"
      );
      await expect(world).toHaveAttribute("data-art-ready", "true");
      expect(
        await scene.evaluate(
          (element, original) => element === original,
          initialScene
        )
      ).toBe(true);
      expect(
        await objects.evaluateAll(elements =>
          elements.map(element => element.getAttribute("data-action-slot-id"))
        )
      ).toEqual(initialIds);
      await expect(page.locator(".gdp-approved-art-layer")).toBeVisible();
      await expect(page.locator(".gdp-approved-header")).toBeVisible();
      await expect(page.locator(".gdp-approved-dock")).toBeVisible();
      await expect(
        page.locator(
          ".gdp-enter-overworld-btn, .gdp-castle-destination, .gdp-walkable-route, .gdp-v2-header"
        )
      ).toHaveCount(0);
      await objects.first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      await initialScene?.dispose();
    });

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
  const url = "**/goldline/dayline-v2/ui/approved-reference.png";
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

test("approved scene retains source geometry and each native task dialog", async ({
  page,
}) => {
  await page.goto("/driver?goldlineDayPlanFixture=art-approved");
  const world = page.locator(".gdp-illustrated-world");
  await expect(world).toHaveAttribute("data-art-ready", "true");
  const expected = [
    ["pickup", 198, 256, 275],
    ["dropoff", 631, 402, 268],
    ["sales", 559, 677, 301],
    ["growth", 629, 961, 238],
    ["marketing", 559, 1238, 334],
  ] as const;
  const scene = (await page.locator(".gdp-art-scene").boundingBox())!;
  expect(scene.height / scene.width).toBeCloseTo(1672 / 941, 2);
  for (const [kind, left, top, width] of expected) {
    const card = page.locator(`.gdp-object--${kind}`);
    await card.scrollIntoViewIfNeeded();
    const geometry = await card.evaluate(element => {
      const cardRect = element.getBoundingClientRect();
      const sceneRect = element
        .closest(".gdp-art-scene")!
        .getBoundingClientRect();
      return {
        left: (cardRect.x - sceneRect.x) / sceneRect.width,
        top: (cardRect.y - sceneRect.y) / sceneRect.height,
        width: cardRect.width / sceneRect.width,
      };
    });
    expect(geometry.left).toBeCloseTo(left / 941, 2);
    expect(geometry.top).toBeCloseTo(top / 1672, 2);
    expect(geometry.width).toBeCloseTo(width / 941, 2);
    await card.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  }
  await page.locator(".gdp-approved-map").click();
  await expect(page.locator("#goldline-world-navigation")).toBeVisible();
});

test("empty and long days do not add source sample work or lose live actions", async ({
  page,
}) => {
  await page.goto("/driver?goldlineDayPlanFixture=art-empty");
  await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute(
    "data-art-ready",
    "true"
  );
  await expect(page.locator(".gdp-object")).toHaveCount(0);
  await page.goto("/driver?goldlineDayPlanFixture=art-twelve-long");
  await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute(
    "data-art-ready",
    "true"
  );
  await expect(page.locator(".gdp-object")).toHaveCount(12);
  const cards = page.locator(".gdp-object");
  const boxes = await cards.evaluateAll(els =>
    els.map(el => el.getBoundingClientRect().toJSON())
  );
  for (let i = 1; i < boxes.length; i++)
    expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i - 1].bottom);
  await cards.last().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("United States");
});
