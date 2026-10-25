import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const CAPTURE_DIR = process.env.SC_CAPTURE_DIR;
async function maybeSnap(page: import("@playwright/test").Page, name: string) {
  if (!CAPTURE_DIR) return;
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(CAPTURE_DIR, name) });
}

test("Tin Can House opens the current plate and exit preserves tenant customer state", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => { errors.push(error.message); console.error(error.message); });
  await page.goto("/e2e/lantern-islands/fixture.html");
  const board = page.getByLabel("Lantern City island board");
  await expect(board).toHaveAttribute("data-customer-keys", "fixture-customer");
  await page.getByRole("button", { name: "Tin Can House · Small Comforts" }).click();
  const plate = page.locator('[data-small-comforts="plate"]');
  await expect(plate).toBeVisible();
  await expect(board).toHaveAttribute("data-paused", "true");
  const art = plate.getByRole("img");
  await expect(art).toHaveAttribute("src", "/assets/joystick-home/tin-can-house.webp");
  expect(await art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
  await plate.click({ position: { x: 200, y: 200 } });
  await expect(plate.locator(".scp-ripple")).toHaveCount(1);
  await plate.getByRole("button").click();
  await expect(plate).toHaveCount(0);
  await expect(board).toHaveAttribute("data-paused", "false");
  await expect(board).toHaveAttribute("data-focus-island", "Hollywood");
  await expect(board).toHaveAttribute("data-customer-keys", "fixture-customer");
  expect(errors).toEqual([]);
});

test("Small Comforts Chapters 1-4 play through Breakfast in Bed, This Is a Sign, Leftovers, and The Heimlich with singing glass shards", async ({
  page,
}, testInfo) => {
  if (CAPTURE_DIR) test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", error => {
    errors.push(error.message);
    console.error(error.message);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/e2e/lantern-islands/fixture.html");
  await page.getByRole("button", { name: "Tin Can House · Small Comforts" }).click();

  const plate = page.locator('[data-small-comforts="plate"]');
  await expect(plate).toBeVisible();

  // Chapter 1 — Breakfast in Bed
  const card1 = page.getByTestId("sc-chapter-card-1");
  await expect(card1).toContainText("Breakfast in Bed");
  await expect(card1).toContainText("His lunch is on top of the tin.");
  await expect(card1).toContainText("Pip’s bed is up on the shelf.");
  await maybeSnap(page, "01-ch1-card-breakfast-in-bed.png");
  await page.getByTestId("sc-begin-chapter-1").click();
  await maybeSnap(page, "02-ch1-scene-breakfast-in-bed.png");

  for (let i = 0; i < 5; i++) {
    await page.getByTestId("sc-ch1-zipper-tooth").click();
  }
  await page.getByTestId("sc-ch1-place-cap").click();
  await page.getByTestId("sc-ch1-fire-sling").click();
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("sc-ch1-stack-shell").click();
  }
  await page.getByTestId("sc-ch1-place-whoopee").click();
  await page.getByTestId("sc-ch1-biscuit-cannonball").click();
  await page.getByTestId("sc-ch1-pull-toaster").click();
  await expect(page.getByTestId("sc-ch1-complete")).toBeVisible();
  await page.getByTestId("sc-ch1-next-chapter").click();

  // Chapter 2 — This Is a Sign
  const card2 = page.getByTestId("sc-chapter-card-2");
  await expect(card2).toContainText("This Is a Sign");
  await expect(card2).toContainText("His beard is in the way.");
  await page.getByTestId("sc-begin-chapter-2").click();
  await page.getByTestId("sc-ch2-carve-pass").click();
  await page.getByTestId("sc-ch2-wake-mirror").click();
  await expect(page.getByTestId("sc-ch2-sign-quote")).toContainText("…this is a sign.");
  await maybeSnap(page, "03-ch2-this-is-a-sign.png");
  await page.getByTestId("sc-ch2-bumper-accept").click();
  await page.getByTestId("sc-ch2-bumper-voicemail").click();
  await page.getByTestId("sc-ch2-bumper-speaker").click();
  await expect(page.getByTestId("sc-ch2-complete")).toBeVisible();
  await page.getByTestId("sc-ch2-next-chapter").click();

  // Chapter 3 — Leftovers
  const card3 = page.getByTestId("sc-chapter-card-3");
  await expect(card3).toContainText("Leftovers");
  await expect(card3).toContainText("The mice owe him dinner.");
  await page.getByTestId("sc-begin-chapter-3").click();
  await maybeSnap(page, "04-ch3-leftovers-in-breath.png");
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("sc-ch3-load-spoon").click();
    await page.getByTestId("sc-ch3-fire-inhale").click();
  }
  await expect(page.getByTestId("sc-ch3-choking-transition")).toBeVisible();
  await page.getByTestId("sc-ch3-to-ch4").click();

  // Chapter 4 — The Heimlich (+ Free Singing Glass Shards)
  const card4 = page.getByTestId("sc-chapter-card-4");
  await expect(card4).toContainText("The Heimlich");
  await expect(card4).toContainText("The broken glass is finally free.");
  await maybeSnap(page, "05-ch4-card-the-heimlich.png");
  await page.getByTestId("sc-begin-chapter-4").click();

  // Advance through choking -> window shatter -> falls on ass -> neighbour with broken arm cast -> Heimlich sync
  await page.getByTestId("sc-ch4-advance-beat").click(); // stands & backs up
  await page.getByTestId("sc-ch4-advance-beat").click(); // breaks bedroom window -> shards are free!
  await expect(page.getByTestId("sc-ch4-shard-choir")).toBeVisible();
  await page.getByTestId("sc-ch4-advance-beat").click(); // falls outside onto ass
  await page.getByTestId("sc-ch4-advance-beat").click(); // neighbour rushes in (broken arm in cast)
  await page.getByTestId("sc-ch4-advance-beat").click(); // begin one-armed Heimlich sync

  // Three mouse jumps in sync with her one-armed compression -> shards sing on every jump!
  await page.getByTestId("sc-ch4-jump-sync").click();
  await expect(page.getByTestId("sc-ch4-shard-syllable")).toContainText("FA-LA-FREE!");
  await maybeSnap(page, "06-ch4-heimlich-singing-glass-shards.png");
  await page.getByTestId("sc-ch4-jump-sync").click();
  await expect(page.getByTestId("sc-ch4-shard-syllable")).toContainText("OO-WAH-BREEZE!");
  await page.getByTestId("sc-ch4-jump-sync").click();
  await expect(page.getByTestId("sc-ch4-shard-syllable")).toContainText("HAL-LE-LU-GLASS!");

  await page.getByTestId("sc-ch4-finale-hats").click();
  await expect(page.getByTestId("sc-ch4-complete")).toBeVisible();
  await maybeSnap(page, "07-ch4-complete-finale.png");
  if (CAPTURE_DIR) {
    const v = page.video();
    await page.close();
    if (v) await v.saveAs(path.join(CAPTURE_DIR, "small-comforts-chapters-1-4-390x844.webm"));
  }
  expect(errors).toEqual([]);
  void testInfo;
});

