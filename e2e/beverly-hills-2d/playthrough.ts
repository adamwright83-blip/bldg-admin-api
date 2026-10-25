import { expect, type Page } from "@playwright/test";
/** Exercises the real controls and collision/puzzle rules; no state injection or teleport. */
export async function playOtherRodeo(page: Page) {
  const root = page.getByTestId("beverly-hills-2d");
  await page.getByRole("button", { name: "Follow your nose" }).click();
  async function go(x: number) {
    await root.focus();
    const current = Number(await root.getAttribute("data-player-x"));
    const right = x > current;
    const key = right ? "ArrowRight" : "ArrowLeft";
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(
        ({ target, right }) => {
          const n = Number(
            document
              .querySelector('[data-testid="beverly-hills-2d"]')
              ?.getAttribute("data-player-x")
          );
          return right ? n >= target : n <= target;
        },
        { target: x, right },
        { timeout: 20_000 }
      );
    } finally {
      await page.keyboard.up(key);
    }
  }
  async function interact() {
    await root.focus();
    await page.keyboard.press("e");
  }
  await go(480);
  await interact();
  await expect(root).toHaveAttribute("data-item", "ball");
  await page.keyboard.press("f");
  await go(1450); // The boxer reaches the ball while the terrier follows.
  await go(1670);
  await interact();
  await expect(root).toHaveAttribute("data-chapter", "pasture");
  await go(1080);
  await interact();
  await go(1250);
  await interact();
  await expect(root).toHaveAttribute("data-item", "stick");
  await go(1400);
  await page.keyboard.press("f");
  await expect(root).toHaveAttribute("data-gate", "true", { timeout: 10_000 });
  await go(1740);
  await root.focus();
  await page.keyboard.down("ArrowRight");
  await page.keyboard.press("Space");
  try {
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector('[data-testid="beverly-hills-2d"]')
            ?.getAttribute("data-player-x")
        ) > 1900,
      undefined,
      { timeout: 5000 }
    );
  } finally {
    await page.keyboard.up("ArrowRight");
  }
  await go(2010);
  await interact();
  await expect(root).toHaveAttribute("data-water", "true");
  await go(2720);
  await interact();
  await expect(root).toHaveAttribute("data-chapter", "distortion");
  await go(400);
  await interact();
  await expect(root).toHaveAttribute("data-item", "rope");
  await go(700);
  await interact();
  await expect(root).toHaveAttribute("data-tether", "true");
  await go(1070);
  await interact();
  await expect(root).toHaveAttribute("data-water", "true");
  await go(1490);
  await interact();
  await expect(root).toHaveAttribute("data-chapter", "home", {
    timeout: 15_000,
  });
  await page
    .getByRole("button", { name: "Open Claire’s field notes" })
    .waitFor();
}
