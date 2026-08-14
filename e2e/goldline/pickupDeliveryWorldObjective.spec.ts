import { expect, test, type Page } from "@playwright/test";

/**
 * Proves pickup/delivery are genuine playable-world objectives, not a
 * list-row-opens-a-modal experience. A genuine order becomes a real Pixi
 * world marker bound to an authored corridor anchor (see
 * populationProjection.ts's bindOrderToPopulation / PopulationSystem's
 * setOrder), and the primary PICKUP/DELIVERY completion action is gated on
 * Trailblazer's real proximity to that anchor — exactly the same
 * `stagingRadius`/`isOrderApproachable` mechanism already proven for
 * commercial-mission encounters (see authoritativeBusinessChains.spec.ts).
 *
 * The NEUTRALIZE fixture (GoldlineFictionHarness.tsx) authors two real
 * pickup orders and two real delivery orders with no commercial missions at
 * all, so the world's single embodiment slot is unambiguously the order
 * objective for this proof.
 */
test.describe.configure({ timeout: 90_000 });

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";
const CHECKPOINT_KEY = "goldline:checkpoint:v2:goldline-fiction-e2e";

async function loginWithPreTraversalCheckpoint(page: Page) {
  // Restores before the order anchor cluster (~0.7-0.75) so this test
  // still exercises genuine forward movement to reach it, rather than
  // spawning already inside the staging radius.
  await page.addInitScript(
    ({ key }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          corridorId: "corridor_01",
          progress: 0.21,
          lateral: 0,
          branch: "intel",
          savedAt: "2026-08-14T00:00:00.000Z",
        })
      );
    },
    { key: CHECKPOINT_KEY }
  );
  // First-entry explainer only shows once per player identity (see
  // onboardingProgress.ts) and would otherwise intercept pointer events
  // for every test that doesn't care about it.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["first_entry_explained"])
    );
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/driver?goldlineFixture=NEUTRALIZE");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
}

async function moveForwardUntil(page: Page, contextActionText: string) {
  const actionButton = page
    .locator(".context-actions button")
    .filter({ hasText: contextActionText });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await actionButton.isVisible().catch(() => false)) return;
    const box = await page.getByTestId("goldline-joystick").boundingBox();
    if (!box) throw new Error("Goldline joystick is unavailable");
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
  }
  await expect(actionButton).toBeVisible({ timeout: 5_000 });
}

async function openLiveRoute(page: Page) {
  await page.getByRole("button", { name: "Open field utilities" }).click();
  await page.getByRole("button", { name: "LIVE ROUTE" }).click();
}

test.describe("Pickup/delivery are proximity-gated world objectives", () => {
  test("CASE OUTSIDE ZONE: opening the surface before reaching the world objective shows a truthful move-closer state, not a completion button", async ({
    page,
  }) => {
    await loginWithPreTraversalCheckpoint(page);
    await page.waitForTimeout(800);

    // Still at the checkpoint's starting position — genuinely nowhere near
    // any authored order anchor (all cluster around progress 0.7-0.75).
    await openLiveRoute(page);
    const row = page
      .locator(".live-route-list article")
      .filter({ has: page.getByText("Pickup Alpha") });
    await row.getByRole("button", { name: "RETRIEVE CARGO" }).click();

    const surface = page.locator(".goldline-action-surface");
    await expect(surface).toBeVisible();
    await expect(surface).toContainText("PICKUP");
    // The real completion mechanic is not offered outside the zone — no
    // MARK COLLECTED, and no genuine RETRIEVE button either.
    await expect(
      surface.getByRole("button", { name: "RETRIEVE" })
    ).toHaveCount(0);
    await expect(
      surface.getByRole("button", { name: /MARK COLLECTED/i })
    ).toHaveCount(0);
    await expect(surface).toContainText(
      "Move Trailblazer to the retrieval point"
    );

    // No canonical write occurred and the objective is still on the route.
    await surface.getByRole("button", { name: "Close action" }).click();
    await openLiveRoute(page);
    await expect(
      page.locator(".live-route-list").getByText("Pickup Alpha")
    ).toBeVisible();
  });

  test("CASE IN ZONE: physically reaching the world objective exposes the primary in-world mechanic, and completing it writes real truth and advances the world", async ({
    page,
  }) => {
    await loginWithPreTraversalCheckpoint(page);
    await page.waitForTimeout(800);

    // Real navigation guidance: the order's anchor sits well ahead of the
    // checkpoint's restored progress (0.21), so the world must honestly
    // signal "objective ahead, not yet visible" before Trailblazer reaches
    // proximity — never a fabricated GPS distance, just the same proximity
    // math driving the marker's own visibility.
    await expect(page.getByTestId("objective-direction-cue")).toBeVisible();
    await expect(page.getByTestId("goldline-world")).toHaveAttribute(
      "data-objective-offscreen",
      "ahead"
    );

    // Genuine physical movement toward the order's authored anchor — the
    // same movement grammar CALL/VISIT/FOLLOW_UP/RECOVER already use for a
    // commercial-mission encounter.
    // The order's context-action prompt (not "approach human scene" — that
    // is the mission-only label) appears once Trailblazer enters the
    // authored staging radius.
    await moveForwardUntil(page, "INTERACT");

    // Real proximity resolved the guidance signal — the objective is now
    // close enough to be genuinely visible, so the directional cue clears.
    await expect(page.getByTestId("objective-direction-cue")).toHaveCount(0);
    await expect(page.getByTestId("goldline-world")).toHaveAttribute(
      "data-objective-offscreen",
      "NONE"
    );
    const interactButton = page
      .locator(".context-actions button")
      .filter({ hasText: "INTERACT" });
    await expect(interactButton).toContainText(/retrieval point/i);

    const urlBeforeInteract = page.url();
    await interactButton.click();

    // Genuine world interaction opened the surface — same page, canvas
    // stays mounted, no internal dispatch page.
    expect(page.url()).toBe(urlBeforeInteract);
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
    const surface = page.locator(".goldline-action-surface");
    await expect(surface).toBeVisible();
    await expect(surface).toContainText("PICKUP");

    // Reaching the zone genuinely exposes the primary mechanic this time.
    const retrieve = surface.getByRole("button", { name: "RETRIEVE" });
    await expect(retrieve).toBeVisible();
    await retrieve.click();

    // Canonical write completes, the surface closes, canvas remains
    // mounted, and the world objective genuinely resolves — it disappears
    // from the real route and the next genuine objective becomes current.
    await expect(surface).not.toBeVisible({ timeout: 5_000 });
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
    await openLiveRoute(page);
    await expect(
      page.locator(".live-route-list").getByText("Pickup Alpha")
    ).toHaveCount(0);
    // The next genuine order becomes the "NEXT OBJECTIVE" — reality, not a
    // client-authored guess.
    await expect(
      page.locator(".live-route-list article[data-next-objective='true']")
    ).toContainText("Delivery Paid");
  });
});
