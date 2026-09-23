import { expect, test, type Page } from "@playwright/test";

/*
  The Wayward voyage, behind the compile-time Goldline test harness.

  `waywardRook=preview` is the explicit testing seam that puts Rook aboard;
  without it the stage fails closed exactly as production does until the
  server progression read is wired. `waywardStart` picks the beat.

  CI-safe by construction (see the goldline touch-timing note): no tap-vs-hold
  boundaries, no per-frame timing. The game is driven through its test API,
  and the one timing-sensitive act — casting on a clean line — is decided and
  performed inside the page in a single polling turn, so CDP latency on a slow
  runner cannot spend the window between "clean" and "cast".
*/
const fixture = (query: string) => `/driver?goldlineStageFixture=wayward&${query}`;

type WaywardState = {
  stage: string;
  beat: string;
  mode: string;
  side: string;
  rook: { state: string } | null;
  aim: { inRange: boolean; clear: boolean } | null;
};

async function ready(page: Page) {
  const stage = page.getByTestId("wayward-stage");
  await expect(stage).toBeVisible();
  await expect(stage).toHaveAttribute("data-runtime-ready", "true", { timeout: 45_000 });
}

const state = (page: Page) =>
  page.evaluate(() => (window as unknown as { __wayward: { state: () => WaywardState } }).__wayward.state());

test.describe("The Wayward voyage", () => {
  // A slow runner renders WebGL in software: the game clock runs slower than
  // the wall clock there, so these budgets are generous on purpose.
  test.describe.configure({ timeout: 180_000 });

  test("asset failure leaves a visible retry instead of a blank deck", async ({ page }) => {
    await page.route("**/assets/goldline/wayward/bridge-to-mooring-city.webp", route => route.abort());
    await page.goto(fixture("waywardRook=preview"));
    await expect(page.getByRole("alert")).toContainText("THE DECK DID NOT LOAD");
    await expect(page.getByRole("button", { name: "RETRY APPROACH" })).toBeVisible();
  });

  test("fails closed without the seam: no Rook, and the outer tether stays sealed", async ({ page }) => {
    await page.goto(fixture("waywardStart=span"));
    await ready(page);
    expect((await state(page)).rook).toBeNull();
    await page.evaluate(() => (window as unknown as { __wayward: { skipTo: (b: string) => void } }).__wayward.skipTo("parley"));
    await expect.poll(async () => (await state(page)).beat, { timeout: 15_000 }).toBe("sealed");
  });

  test("with Rook aboard, a clean cast bites, the span falls away, and Rook takes the barrier", async ({ page }) => {
    await page.goto(fixture("waywardRook=preview&waywardStart=span"));
    await ready(page);
    expect((await state(page)).rook).not.toBeNull();
    // Stand where the line can be clean, and cast the moment it is.
    await page.waitForFunction(
      () => {
        const api = (window as unknown as { __wayward: { state: () => WaywardState; teleport: (x: number, y: number) => void; act: () => void } }).__wayward;
        const s = api.state();
        if (s.beat !== "hold") return true;
        if (s.mode === "free" && s.side === "ship") {
          api.teleport(596, 426);
          const now = api.state();
          if (now.aim?.inRange && now.aim.clear) api.act();
        }
        return false;
      },
      undefined,
      { timeout: 60_000, polling: 50 }
    );
    await expect.poll(async () => (await state(page)).beat, { timeout: 45_000 }).toBe("parley");
    await expect(page.getByText("Wait here.", { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("casting off ends under sail, whichever way she gets back aboard", async ({ page }) => {
    await page.goto(fixture("waywardRook=preview&waywardStart=span"));
    await ready(page);
    await page.evaluate(() => (window as unknown as { __wayward: { skipTo: (b: string) => void } }).__wayward.skipTo("castoff"));
    await expect.poll(async () => (await state(page)).beat, { timeout: 15_000 }).toBe("castoff");
    // No input: the mooring stage goes out from under her and the Line recoils her aboard.
    await expect.poll(async () => (await state(page)).stage, { timeout: 90_000 }).toBe("sail");
    await expect(page.getByTestId("wayward-stage")).toHaveAttribute("data-beat", "sail");
  });
});
