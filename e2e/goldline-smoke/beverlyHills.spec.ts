import { expect, test, type Page } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

/**
 * Lantern City's Beverly Hills level: cold outreach to prospective commercial clients.
 * The heroine has to get past Sterling's velvet rope; behind it are the business's REAL Beverly Hills prospects
 * (commercial accounts and the Ten Doors list) with a factual draft. The level never sends anything: every action
 * hands off to the operator's own mail app, phone or maps.
 */

type Hook = { ready: boolean; teleport(x: number, y: number, z: number): void };

const teleport = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => (window as unknown as { __beverlyHills: Hook }).__beverlyHills.teleport(px, py, 0), [x, y]);

test.describe("Lantern City → Beverly Hills", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("the doorman blocks the heroine, the rope drops, and the desk holds real prospects that are never sent", async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    // Nothing in this level may write: tRPC mutations are POSTs.
    const writes: string[] = [];
    page.on("request", r => {
      if (r.method() === "POST" && r.url().includes("/api/trpc/")) writes.push(r.url());
    });

    await page.goto("/growth/lantern-city?level=beverly-hills");
    const root = page.locator('[data-testid="beverly-hills-3d"]');
    await expect(root).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="beverly-hills-goals"]')).toBeVisible();
    await expect(root).toHaveAttribute("data-rope-phase", "arrive");

    // Software WebGL on CI is slow to load the plaza; a device without WebGL gets the honest fallback instead.
    const isReady = () => page.evaluate(() => !!(window as unknown as { __beverlyHills?: Hook }).__beverlyHills?.ready);
    await expect
      .poll(async () => (await isReady()) || (await page.locator('[data-testid="beverly-hills-unavailable"]').count()) > 0, {
        timeout: 180_000,
        intervals: [1000],
      })
      .toBe(true);
    const walkable = await isReady();

    if (walkable) {
      // Walk up to Sterling and get told about the service entrance.
      await teleport(page, 1.6, 5.2);
      const prompt = page.locator('[data-testid="beverly-hills-prompt"]');
      await expect(prompt).toHaveAttribute("data-prompt", "doorman", { timeout: 15_000 });
      await prompt.click();
      const dialogue = page.locator('[data-testid="beverly-hills-dialogue"]');
      await expect(dialogue).toBeVisible();
      await expect(dialogue).toContainText(/service entrance/i);
      for (let i = 0; i < 12 && (await dialogue.count()); i++) {
        await page.locator('[data-testid="beverly-hills-dialogue-next"]').click();
      }
      await expect(dialogue).toHaveCount(0);
      await expect(root).toHaveAttribute("data-rope-phase", "turned_away");
    }

    // A busy operator can skip straight past the rope.
    await page.locator('[data-testid="beverly-hills-skip"]').click();
    await expect(root).toHaveAttribute("data-rope-phase", "admitted");
    await page.locator('[data-testid="beverly-hills-open-desk"]').click();

    const desk = page.locator('[data-testid="beverly-hills-desk"]');
    await expect(desk).toBeVisible();
    // The proof world's book has Beverly Hills prospects on file: the desk shows one, with its facts and a draft.
    await expect(page.locator('[data-testid="beverly-hills-no-prospects"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="beverly-hills-prospect-facts"]')).toBeVisible();
    await expect(page.locator('[data-testid="beverly-hills-draft-body"]')).not.toHaveValue("");
    await expect(desk).toContainText(/not sent/i);

    // Back out to the board.
    await page.getByRole("button", { name: "Close the outreach desk" }).click();
    await page.getByRole("button", { name: /Return to City/i }).first().click();
    await expect(page.locator('[data-lantern-city="islands"]')).toBeVisible({ timeout: 60_000 });

    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});
