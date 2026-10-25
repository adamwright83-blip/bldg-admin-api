import { expect, type Page } from "@playwright/test";

/**
 * Plays The Lost Creek with the real controls (no state injection, no teleport), Solution A: park the boxer at the
 * landing with a long throw while the creek is dry, open the sluice, go back through the seam and open the hose, and
 * wait for the water to bring the trough up to the calf. Then walk the three through the seam and lie down with them.
 * The boxer is not ours to steer, so the helper waits on him the way a player would.
 */
export async function playOtherRodeo(page: Page) {
  const root = page.getByTestId("beverly-hills-2d");
  await page.getByRole("button", { name: "Follow your nose" }).click();
  const num = async (name: string) => Number(await root.getAttribute(name));
  async function hold(key: string, done: string, timeout: number) {
    await root.focus();
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(done, undefined, { timeout });
    } finally {
      await page.keyboard.up(key);
    }
  }
  const attr = (name: string) => `Number(document.querySelector('[data-testid="beverly-hills-2d"]')?.getAttribute("${name}"))`;
  /** left or right until she is there */
  async function go(x: number, timeout = 25_000) {
    const current = await num("data-player-x");
    if (Math.abs(current - x) < 6) return;
    const right = x > current;
    await hold(right ? "ArrowRight" : "ArrowLeft", right ? `${attr("data-player-x")} >= ${x}` : `${attr("data-player-x")} <= ${x}`, timeout);
  }
  /** deeper into the picture (up) or nearer (down) until she is at that depth */
  async function depth(d: number) {
    const current = await num("data-player-d");
    if (Math.abs(current - d) < 0.03) return;
    const deeper = d < current;
    await hold(deeper ? "ArrowUp" : "ArrowDown", deeper ? `${attr("data-player-d")} <= ${d}` : `${attr("data-player-d")} >= ${d}`, 5000);
  }
  async function act() {
    await root.focus();
    await page.keyboard.press("e");
  }

  // 2026: the ball, carried past the sleeping boxer and through the seam
  await go(470);
  await act();
  await expect(root).toHaveAttribute("data-item", "ball");
  await depth(0.32);
  await go(3000, 30_000);
  await expect(root).toHaveAttribute("data-side", "then");
  // 1890s: a long throw (hold F, let go) across the dry ford to the landing; he chases it and naps where he caught it
  await root.focus();
  await page.keyboard.down("f");
  await page.waitForTimeout(1100);
  await page.keyboard.up("f");
  await expect(root).toHaveAttribute("data-item", "none");
  await page.waitForFunction(`document.querySelector('[data-testid="beverly-hills-2d"]')?.getAttribute("data-boxer") === "nap" && ${attr("data-boxer-x")} > 3450`, undefined, { timeout: 30_000 });
  // the sluice, so the creek will run down the old channel into the hole
  await depth(0.41);
  await go(3650);
  await act();
  await expect(root).toHaveAttribute("data-sluice", "true");
  // back through the seam to the hose: drain the fountain into the 1890s
  await depth(0.46);
  await go(965, 40_000);
  await act();
  await expect(root).toHaveAttribute("data-hose", "true");
  await expect(root).toHaveAttribute("data-rescued", "true", { timeout: 45_000 });
  await expect(root).toHaveAttribute("data-calf-ledge", "false");
  // the calf (and the boxer) come to her; the three walk through the seam together
  await go(1780, 20_000);
  await page.waitForFunction(`${attr("data-calf-x")} < 2100 && ${attr("data-boxer-x")} < 2150`, undefined, { timeout: 40_000 });
  await hold("ArrowRight", `document.querySelector('[data-testid="beverly-hills-2d"]')?.getAttribute("data-chapter") === "home"`, 10_000);
  await page.waitForTimeout(1600); // the paper tear
  // home is a place: walk to the oak and lie down with them
  await go(640);
  await act();
  await expect(root).toHaveAttribute("data-ended", "true", { timeout: 10_000 });
  await page.getByRole("button", { name: "Open Claire’s field notes" }).waitFor({ timeout: 10_000 });
}
