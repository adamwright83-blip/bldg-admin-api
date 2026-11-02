import { test, expect } from "@playwright/test";

/**
 * The Round-Up: real controls move the terrier and bark, the boxer reacts, and a whole round ends in a results card
 * with stars, all without a single business write. The bot shepherd (visual-test builds only) finishes the round so
 * the test does not depend on a human's herding.
 */
test("round-up plays with real controls, ends with stars, and writes nothing", async ({ page, isMobile }) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => {
    if (r.method() === "POST" && r.url().includes("/api/trpc/")) writes.push(r.url());
  });
  await page.goto("/growth/lantern-city?level=beverly-hills");
  await page.evaluate(() => localStorage.removeItem("joystick.round-up.best.v1"));
  await page.getByTestId("start-round-up").click({ timeout: 60_000 });
  const round = page.getByTestId("round-up");
  await expect(round).toBeVisible();
  await expect(round).toHaveAttribute("data-total", "6");
  // let the title card clear, then walk into the herd and bark with the real controls
  await page.waitForTimeout(2200);
  if (isMobile) {
    const right = round.getByRole("button", { name: "Walk right" });
    const box = (await right.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1200);
    await page.mouse.up();
    await round.getByRole("button", { name: "Bark" }).tap();
  } else {
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(2200);
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    // run back away from the herd: the boxer charges it
    await page.keyboard.up("ArrowRight");
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("ArrowLeft");
    await expect(round).toHaveAttribute("data-boxer", "charge", { timeout: 6_000 });
    await page.keyboard.up("ArrowLeft");
    await page.keyboard.up("ShiftLeft");
  }
  await page.evaluate(() => Object.assign(window, { __roundUpAuto: true, __roundUpSpeed: 6 }));
  const results = page.getByTestId("round-up-results");
  await expect(results).toBeVisible({ timeout: 90_000 });
  await expect(round).toHaveAttribute("data-over", "yes");
  expect(Number(await round.getAttribute("data-penned"))).toBeGreaterThan(0);
  await expect(results.getByLabel(/of 3 stars/)).toBeVisible();
  const best = await page.evaluate(() => localStorage.getItem("joystick.round-up.best.v1"));
  expect(best).toContain('"stars"');
  // again starts a fresh round; back returns to the story's title
  await page.evaluate(() => Object.assign(window, { __roundUpAuto: false, __roundUpSpeed: 1 }));
  await page.getByTestId("round-up-again").click();
  await expect(round).toHaveAttribute("data-over", "no");
  await expect(round).toHaveAttribute("data-penned", "0");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Back to the story" }).click();
  await expect(round).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
