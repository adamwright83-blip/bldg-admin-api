import { expect, test, type Page } from "@playwright/test";

/**
 * Proves the empty-day experience is truthful end to end in a real browser.
 * A field-tester with genuinely zero missions, pickups, deliveries, or
 * cold-call work opened Goldline and saw fabricated traversal prompts
 * (JUMP/CLIMB/VAULT with no obstacle) and a lying "MOVE TO NEXT ACTION
 * ZONE" prompt while "NO ACTIVE MISSION" was also shown. This suite proves
 * that specific failure cannot recur: the world is honest about having no
 * real work, movement is genuinely free, and no fictional claim appears.
 *
 * `?goldlineEmptyDay=1` zeroes every real-work source in the NEUTRALIZE
 * fixture harness (missions, route stops, pickups, deliveries, cold-call
 * eligibility) — see GoldlineFictionHarness.tsx's readEmptyDayFlag.
 */
test.describe.configure({ timeout: 90_000 });

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page) {
  // First-entry explainer only shows once per player identity — suppress it
  // here since this suite is proving the empty-day world state, not the
  // first-30-seconds onboarding flow (see firstThirtySeconds.spec.ts).
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
  await page.goto("/driver?goldlineFixture=NEUTRALIZE&goldlineEmptyDay=1");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
}

async function holdJoystickForward(page: Page, ms: number) {
  const box = await page.getByTestId("goldline-joystick").boundingBox();
  if (!box) throw new Error("Goldline joystick is unavailable");
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe("empty-day truth boundary", () => {
  test("a genuinely empty day never shows fake traversal prompts, fake encounter prep, or the MOVE TO NEXT ACTION ZONE lie", async ({
    page,
  }) => {
    await login(page);
    await page.waitForTimeout(1000);

    // No JUMP/CLIMB/VAULT prompt should ever appear on an empty day —
    // there is no authored obstacle requiring them (the only remaining
    // corridor trigger is the INTERACT-only fortress gate, which nulls
    // out entirely when no mission/order embodiment exists).
    for (const label of ["JUMP", "CLIMB", "VAULT"]) {
      await expect(
        page.locator(".context-actions button").filter({ hasText: label })
      ).toHaveCount(0);
    }

    // Genuine free movement: holding the joystick forward for a few
    // seconds must actually advance the player's progress with nothing
    // blocking it.
    const progressBefore = await page
      .getByTestId("goldline-world")
      .getAttribute("data-player-progress");
    await holdJoystickForward(page, 2000);
    await page.waitForTimeout(200);
    const progressAfter = await page
      .getByTestId("goldline-world")
      .getAttribute("data-player-progress");
    expect(Number(progressAfter)).toBeGreaterThan(Number(progressBefore));

    // No encounter-prep claim: there is no active mission, so this UI
    // must never appear regardless of lane/progress.
    await expect(page.getByText("ENCOUNTER PREP REVEALED")).toHaveCount(0);

    // The old lie is gone everywhere in the DOM.
    await expect(page.getByText("MOVE TO NEXT ACTION ZONE")).toHaveCount(0);

    // The truthful empty state is shown and readable instead.
    const noActiveObjective = page.getByTestId("no-active-objective");
    await expect(noActiveObjective).toBeVisible();
    await expect(noActiveObjective).toContainText("NO ACTIVE OBJECTIVE");
    await expect(noActiveObjective).toContainText(
      "No unresolved route work right now."
    );

    // Top bar is truthful too — no fabricated mission name.
    await expect(page.locator(".game-topbar b")).toContainText(
      "NO ACTIVE MISSION"
    );

    // No offscreen objective cue either — there is nothing to point at.
    await expect(
      page.getByTestId("objective-direction-cue")
    ).toHaveCount(0);
    await expect(page.getByTestId("goldline-world")).toHaveAttribute(
      "data-objective-offscreen",
      "NONE"
    );

    // Field Console remains reachable but is never required to understand
    // the state — everything above was determined from the live world UI
    // alone, before this point.
    const consoleButton = page.getByRole("button", {
      name: "Open field utilities",
    });
    await expect(consoleButton).toBeVisible();
    await consoleButton.click();
    await expect(page.getByRole("button", { name: "LIVE ROUTE" })).toBeVisible();
  });
});
