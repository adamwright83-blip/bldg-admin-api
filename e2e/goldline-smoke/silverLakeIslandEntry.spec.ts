import { expect, test, type Page } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

/**
 * The normal way in: open Lantern City (the island board), click Silver Lake, and walk straight into the
 * 3D courtyard. No query parameters, no preview mode. The archived 2D encounter must never appear.
 */

type Point = { x: number; y: number; visible: boolean };

async function settledIsland(page: Page, name: string): Promise<Point> {
  // Aim where a person would: the island's name tag. Silver Lake's tag is placed before every other tag, so
  // it must be showing at every viewport (on a phone, Koreatown's tag once hid it and took the tap).
  // Compare like with like across two reads, so a tag that flickers in and out never stalls the wait.
  type Read = { tag: Point | null };
  const read = () =>
    page.evaluate(n => {
      const probe = (window as unknown as {
        __lanternIslands?: { islandLabelScreen(n: string): Point | null };
      }).__lanternIslands;
      return probe ? { tag: probe.islandLabelScreen(n) } : null;
    }, name) as Promise<Read | null>;
  const vw = page.viewportSize();
  const onScreen = (p: Point | null) => !!p && p.visible && (!vw || (p.x >= 0 && p.x <= vw.width && p.y >= 0 && p.y <= vw.height));
  const same = (p: Point | null, q: Point | null) => !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) < 2;
  let settled: Point | null = null;
  await expect
    .poll(
      async () => {
        const a = await read();
        await page.waitForTimeout(500);
        const b = await read();
        if (!a || !b) return false;
        if (same(a.tag, b.tag) && onScreen(b.tag)) settled = b.tag;
        return settled !== null;
      },
      { timeout: 150_000, intervals: [1000] }
    )
    .toBe(true);
  return settled!;
}

test.describe("Lantern City → Silver Lake", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("clicking Silver Lake on the Lantern City board walks into the 3D courtyard", async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));

    await page.goto("/growth/lantern-city");
    await expect(page.locator('[data-lantern-city="islands"]')).toBeVisible({ timeout: 30_000 });
    // a person waits for "Loading Lantern City…" to clear before tapping; so does this test
    await expect(page.locator('[data-lantern-state="loading"]')).toHaveCount(0, { timeout: 180_000 });

    const point = await settledIsland(page, "Silver Lake");
    const box = await page.locator('[aria-label="Lantern City island board"]').boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + point.x;
    const y = box!.y + point.y;
    if (testInfo.project.name === "mobile") await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);

    await expect(page.locator('[data-testid="silver-lake-3d"]')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/growth\/lantern-city\?cozy=1&territory=silver-lake/);
    await expect(
      page.locator('[data-testid="silver-lake-3d-canvas"], [data-testid="silver-lake-3d-unavailable"]').first()
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="silver-lake-roster"]')).toBeVisible();

    // walk back out to the board
    await page.getByRole("button", { name: /Return to (Wide )?City/i }).click();
    await expect(page.locator('[data-lantern-city="islands"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="silver-lake-3d"]')).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("the painted 2D encounter has no route, even from old deep links", async ({ page }) => {
    for (const url of [
      "/growth/lantern-city?cozy=1",
      "/growth/lantern-city?cozy=1&territory=silver-lake&walk=0",
      "/growth/lantern-city?scene=v6&cozy=1",
      "/growth/lantern-city?encounter=1&territory=silver-lake",
    ]) {
      await page.goto(url);
      await expect(page.locator('[data-testid="silver-lake-3d"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toHaveCount(0);
    }
  });
});
