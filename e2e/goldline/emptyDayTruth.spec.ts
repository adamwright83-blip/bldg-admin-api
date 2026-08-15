import { expect, test, type Page } from "@playwright/test";

/**
 * An empty business day is truthful but it must not be dead gameplay.
 * When there is no mission/order/cold-call work, Goldline immediately opens
 * the existing Open Channel briefing so the operator can tell it what today
 * and tomorrow actually contain. The resulting plan remains a DRAFT until
 * the operator approves it; no work is fabricated merely to fill the world.
 */
test.describe.configure({ timeout: 90_000 });

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page) {
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
  await expect(page.getByTestId("goldline-shell")).toBeVisible({ timeout: 30_000 });
}

async function holdJoystickForward(page: Page, ms: number) {
  const box = await page.getByTestId("goldline-joystick").boundingBox();
  if (!box) throw new Error("Goldline joystick is unavailable");
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.describe("empty-day ignition", () => {
  test("zero real work immediately asks for a truthful briefing instead of leaving Trailblazer aimless", async ({ page }) => {
    await login(page);

    // The world truth is still empty — no fabricated objective appears.
    await expect(page.getByTestId("no-active-objective")).toBeVisible();
    await expect(page.getByTestId("goldline-world")).toHaveAttribute(
      "data-objective-offscreen",
      "NONE"
    );

    // But an empty day is now an ignition state, not a successful dead-end.
    const briefing = page.getByTestId("empty-day-briefing");
    await expect(briefing).toBeVisible();
    await expect(page.locator(".open-channel-overlay")).toHaveAttribute(
      "data-auto-ignition",
      "true"
    );
    await expect(briefing).toContainText("BRIEF ME");
    await expect(briefing).toContainText(/today|tomorrow/i);
    await expect(briefing).toContainText(/tell Goldline what is actually happening/i);

    // No old fake traversal or navigation lies are reintroduced behind it.
    for (const label of ["JUMP", "CLIMB", "VAULT"]) {
      await expect(
        page.locator(".context-actions button").filter({ hasText: label })
      ).toHaveCount(0);
    }
    await expect(page.getByText("ENCOUNTER PREP REVEALED")).toHaveCount(0);
    await expect(page.getByText("MOVE TO NEXT ACTION ZONE")).toHaveCount(0);

    // The operator can deliberately dismiss the briefing; the world remains
    // truthful and movement remains free rather than being blocked by fake
    // geometry. Dismissal is a choice, not the default experience.
    await page.getByRole("button", { name: "Close Open Channel" }).click();
    await expect(briefing).toHaveCount(0);
    const progressBefore = await page
      .getByTestId("goldline-world")
      .getAttribute("data-player-progress");
    await holdJoystickForward(page, 1200);
    await page.waitForTimeout(200);
    const progressAfter = await page
      .getByTestId("goldline-world")
      .getAttribute("data-player-progress");
    expect(Number(progressAfter)).toBeGreaterThan(Number(progressBefore));
  });
});
