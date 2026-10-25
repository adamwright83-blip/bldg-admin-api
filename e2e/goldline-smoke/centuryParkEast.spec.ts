import { expect, test, type Page } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

/**
 * Century Park East, the game: a building character's errand ends at the Letter Desk for a real resident; a dazed
 * zombie is led into a closet and locked in with the broom; dogs stack on her shoulders and are saved at the dog spa;
 * the first bite turns her into paper. Cozy night is the default and the choice is remembered. This runs on the
 * isolated synthetic preview, which never writes: the test asserts no tRPC mutation is posted.
 */

type Hook = {
  ready: boolean;
  state(): { floor: number; carried: number; saved: number; trapped: number; flat: number; prompt: string | null; charges: number; climbing: number | null; stamina: number | null };
  teleport(f: number, x: number, z: number): void;
  calm(): void;
  bite(): void;
  errand(slot: number): { floor: number; x: number; z: number; itemFloor: number; itemX: number; itemZ: number };
  lureInto(closet: number): void;
  dogs: { floor: number; x: number; z: number }[];
  ropes: { floor: number; x: number; z: number }[];
};

const call = <K extends keyof Hook>(page: Page, fn: K, ...args: unknown[]) =>
  page.evaluate(([f, a]) => {
    const h = (window as unknown as { __centuryParkEast: Record<string, unknown> }).__centuryParkEast;
    const v = h[f as string];
    return typeof v === "function" ? (v as (...x: unknown[]) => unknown)(...(a as unknown[])) : v;
  }, [fn, args] as const) as Promise<Hook[K] extends (...a: never[]) => infer R ? R : Hook[K]>;

test.describe("Lantern City → Century Park East", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("errand to Letter Desk, closet trap, dog tower, paper bite, remembered vibe; nothing written", async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    const writes: string[] = [];
    page.on("request", r => {
      if (r.method() === "POST" && r.url().includes("/api/trpc/")) writes.push(r.url());
    });

    await page.goto("/growth/lantern-city?level=century-park-east&preview=synthetic");
    const root = page.locator('[data-testid="century-park-east-3d"]');
    await expect(root).toBeVisible({ timeout: 30_000 });
    await expect(root).toHaveAttribute("data-vibe", "cozy");

    const isReady = () => page.evaluate(() => !!(window as unknown as { __centuryParkEast?: Hook }).__centuryParkEast?.ready);
    await expect
      .poll(async () => (await isReady()) || (await page.locator('[data-testid="century-park-east-unavailable"]').count()) > 0, { timeout: 180_000, intervals: [1000] })
      .toBe(true);
    test.skip(!(await isReady()), "no WebGL on this runner");
    await call(page, "calm");

    // the vibe toggle, remembered across a reload
    await page.getByTestId("century-park-east-vibe").click();
    await expect(root).toHaveAttribute("data-vibe", "zombie");
    await page.reload();
    await expect(root).toHaveAttribute("data-vibe", "zombie", { timeout: 30_000 });
    await expect.poll(isReady, { timeout: 180_000, intervals: [1000] }).toBe(true);
    await call(page, "calm");

    // the open errand: ask, find, hand over, and the real resident's Letter Desk opens
    const open = page.getByTestId("century-park-east-open-slot");
    await expect(open).toHaveAttribute("data-phase", "need", { timeout: 30_000 });
    const slot = Number(await open.getAttribute("data-slot"));
    const e = await call(page, "errand", slot);
    const prompt = page.getByTestId("century-park-east-prompt");
    const talkThrough = async () => {
      const d = page.getByTestId("century-park-east-dialogue");
      for (let i = 0; i < 10 && (await d.count()); i++) await page.getByTestId("century-park-east-dialogue-next").click();
      await expect(d).toHaveCount(0);
    };
    await call(page, "teleport", e.floor, e.x + 0.9, e.z);
    await expect(prompt).toHaveAttribute("data-prompt", "talk", { timeout: 15_000 });
    await prompt.click();
    await talkThrough();
    await call(page, "teleport", e.itemFloor, e.itemX + 0.7, e.itemZ);
    await expect(prompt).toHaveAttribute("data-prompt", "item", { timeout: 15_000 });
    await prompt.click();
    await expect(open).toHaveAttribute("data-phase", "carrying");
    await call(page, "teleport", e.floor, e.x + 0.9, e.z);
    await expect(prompt).toHaveAttribute("data-prompt", "talk", { timeout: 15_000 });
    await prompt.click();
    await talkThrough();
    await page.getByTestId("century-park-east-write").click();
    await expect(page.getByTestId("century-park-east-desk")).toBeVisible();
    await page.getByTestId("century-park-east-desk").getByRole("button", { name: /close/i }).first().click();
    await expect(page.getByTestId("century-park-east-desk")).toHaveCount(0);

    // a dazed zombie in the closet, locked with the broom
    await call(page, "lureInto", 1);
    await expect(prompt).toHaveAttribute("data-prompt", "closet", { timeout: 15_000 });
    await prompt.click();
    await expect.poll(async () => (await call(page, "state")).trapped).toBe(1);

    // the dog tower, then the spa
    const dogs = await call(page, "dogs");
    for (const i of [4, 5, 6]) {
      await call(page, "teleport", dogs[i].floor, dogs[i].x, dogs[i].z);
      await expect.poll(async () => (await call(page, "state")).carried, { timeout: 10_000 }).toBeGreaterThan(i - 5);
    }
    await call(page, "teleport", 1, 33, -1.6);
    await expect.poll(async () => (await call(page, "state")).saved, { timeout: 10_000 }).toBe(3);

    // the first bite: paper
    await call(page, "bite");
    await expect.poll(async () => (await call(page, "state")).flat).toBe(1);
    await expect(page.getByTestId("century-park-east-lives")).toContainText("paper");

    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("ropes: hand over hand up through the fire-station hole, rest to get grip back, slide back down; the spray works from the start", async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.goto("/growth/lantern-city?level=century-park-east&preview=synthetic");
    const isReady = () => page.evaluate(() => !!(window as unknown as { __centuryParkEast?: Hook }).__centuryParkEast?.ready);
    await expect
      .poll(async () => (await isReady()) || (await page.locator('[data-testid="century-park-east-unavailable"]').count()) > 0, { timeout: 180_000, intervals: [1000] })
      .toBe(true);
    test.skip(!(await isReady()), "no WebGL on this runner");
    await call(page, "calm");

    // she arrives with sprays; one goes
    await expect.poll(async () => (await call(page, "state")).charges).toBe(3);
    await page.keyboard.press("KeyF");
    await expect.poll(async () => (await call(page, "state")).charges).toBe(2);

    // the rope up from the ground floor
    const ropes = await call(page, "ropes");
    await call(page, "teleport", ropes[0].floor, ropes[0].x + 0.6, ropes[0].z);
    const prompt = page.getByTestId("century-park-east-prompt");
    await expect(prompt).toHaveAttribute("data-prompt", "rope_up", { timeout: 15_000 });
    await prompt.click();
    await expect(page.getByTestId("century-park-east-climb")).toBeVisible();
    // pulling climbs and costs grip; hanging still never slips, and the grip comes back
    for (let i = 0; i < 4; i++) await page.keyboard.press("Space");
    const high = (await call(page, "state")).climbing ?? 0;
    expect(high).toBeGreaterThan(0.2);
    const spent = (await call(page, "state")).stamina ?? 1;
    expect(spent).toBeLessThan(1);
    await page.waitForTimeout(1500);
    expect((await call(page, "state")).climbing ?? 0).toBeGreaterThanOrEqual(high - 0.001);
    await expect.poll(async () => (await call(page, "state")).stamina ?? 0, { timeout: 5_000 }).toBeGreaterThan(spent);
    await expect(page.getByTestId("century-park-east-climb")).toHaveAttribute("data-resting", "yes");
    // keep pulling all the way up (alternating hands, like the game asks)
    await expect
      .poll(
        async () => {
          await page.keyboard.press("KeyA");
          await page.waitForTimeout(120);
          await page.keyboard.press("KeyD");
          return (await call(page, "state")).floor;
        },
        { timeout: 40_000, intervals: [120] }
      )
      .toBe(1);
    await expect(page.getByTestId("century-park-east-climb")).toHaveCount(0);

    // and the slide back down
    await call(page, "teleport", 1, ropes[0].x + 0.6, ropes[0].z);
    await expect(prompt).toHaveAttribute("data-prompt", "rope_down", { timeout: 15_000 });
    await prompt.click();
    await expect.poll(async () => (await call(page, "state")).floor, { timeout: 10_000 }).toBe(0);

    // the laundry-room rope up to the roof: she must land where she can walk, not inside the pool (regression, #710)
    await call(page, "teleport", ropes[1].floor, ropes[1].x + 0.6, ropes[1].z);
    await expect(prompt).toHaveAttribute("data-prompt", "rope_up", { timeout: 15_000 });
    await prompt.click();
    await expect
      .poll(
        async () => {
          await page.keyboard.press("KeyA");
          await page.waitForTimeout(120);
          await page.keyboard.press("KeyD");
          return (await call(page, "state")).floor;
        },
        { timeout: 40_000, intervals: [120] }
      )
      .toBe(2);
    const landed = await call(page, "state");
    const walk = async (key: string, ms: number) => {
      await page.keyboard.down(key);
      await page.waitForTimeout(ms);
      await page.keyboard.up(key);
      return call(page, "state");
    };
    // off the hole toward the front of the deck, then east along the pool, then back west: none of it may stick
    const forward = await walk("KeyS", 400);
    expect(forward.z).toBeGreaterThan(landed.z + 0.4);
    const east = await walk("KeyD", 700);
    expect(east.x).toBeGreaterThan(forward.x + 1.0);
    const west = await walk("KeyA", 1000);
    expect(west.x).toBeLessThan(east.x - 1.0);
    expect(west.floor).toBe(2);
    // and she can get back to the hole to slide down
    await call(page, "teleport", 2, ropes[1].x + 0.6, ropes[1].z);
    await expect(prompt).toHaveAttribute("data-prompt", "rope_down", { timeout: 15_000 });
    expect(errors).toEqual([]);
  });
});
