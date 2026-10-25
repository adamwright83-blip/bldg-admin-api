import { expect, type Page } from "@playwright/test";

/**
 * Plays The Other Rodeo with the real controls (no state injection, no teleport): the boxer's habits are the
 * puzzles, so the helper waits on him the way a player would.
 */
export async function playOtherRodeo(page: Page) {
  const root = page.getByTestId("beverly-hills-2d");
  await page.getByRole("button", { name: "Follow your nose" }).click();
  const num = async (name: string) => Number(await root.getAttribute(name));
  async function go(x: number, timeout = 25_000) {
    await root.focus();
    const current = await num("data-player-x");
    if (Math.abs(current - x) < 6) return;
    const right = x > current;
    const key = right ? "ArrowRight" : "ArrowLeft";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ target, right }) => {
          const n = Number(document.querySelector('[data-testid="beverly-hills-2d"]')?.getAttribute("data-player-x"));
          return right ? n >= target : n <= target;
        },
        { target: x, right },
        { timeout }
      );
    } finally {
      await page.keyboard.up(key);
    }
  }
  async function act() {
    await root.focus();
    await page.keyboard.press("e");
  }
  async function faceLeft() {
    await root.focus();
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(60);
    await page.keyboard.up("ArrowLeft");
  }
  /** walk up to the boxer and offer it whatever she carries, until the flag comes up */
  async function toTheBoxer(flag: string) {
    for (let i = 0; i < 25 && (await root.getAttribute(flag)) !== "true"; i++) {
      await go((await num("data-boxer-x")) + 50, 4000).catch(() => undefined);
      await act();
      await page.waitForTimeout(500);
    }
    await expect(root).toHaveAttribute(flag, "true", { timeout: 15_000 });
  }

  // the courtyard: he sleeps across the stairs; throw the ball away from them
  await go(470);
  await act();
  await expect(root).toHaveAttribute("data-item", "ball");
  await go(700);
  await faceLeft();
  await page.keyboard.press("f");
  await expect(root).toHaveAttribute("data-stairs", "true", { timeout: 30_000 });
  await go(1660);
  await act();
  await expect(root).toHaveAttribute("data-chapter", "pasture");
  await page.waitForTimeout(1600); // the paper tear

  // the pasture: the calf picks him; he steals the latch rope and drags the gate open
  await go(1000);
  await act();
  // a held arrow key can carry her past the rope; walk back and try again, as a player would
  for (let i = 0; i < 6 && (await root.getAttribute("data-item")) !== "rope"; i++) {
    await go(1330);
    await act();
    await page.waitForTimeout(300);
  }
  await expect(root).toHaveAttribute("data-item", "rope");
  await toTheBoxer("data-gate");
  // he will not cross the water; she does, and pulls the sluice
  await go(1790);
  await act();
  await expect(root).toHaveAttribute("data-water", "true");
  await go(1820);
  await act();
  await expect(root).toHaveAttribute("data-chapter", "distortion");
  await page.waitForTimeout(1600);

  // two times, one field: the rope, given to him this time; the old waterway; the calf
  await go(380);
  await act();
  await expect(root).toHaveAttribute("data-item", "rope");
  await toTheBoxer("data-tether");
  await go(1030);
  await act();
  await expect(root).toHaveAttribute("data-water", "true");
  await go(1500);
  await act();
  await expect(root).toHaveAttribute("data-rescued", "true");
  await expect(root).toHaveAttribute("data-chapter", "home", { timeout: 20_000 });
  await page.getByRole("button", { name: "Open Claire’s field notes" }).waitFor({ timeout: 10_000 });
}
