import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end fiction integrity gate (Slice 102). Drives the canonical
 * NEUTRALIZE journey through the deterministic browser fixture
 * (GoldlineFictionHarness.tsx, ?goldlineFixture=NEUTRALIZE) and proves the
 * required success journey plus the two required failure/real-work-wins
 * variants from the mission-fiction run's acceptance criteria.
 */
const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function loginToNeutralizeFixture(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/driver?goldlineFixture=NEUTRALIZE");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({ timeout: 30_000 });
}

async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Open field utilities" }).click();
}

async function enterNeutralizeMission(page: Page) {
  await openMenu(page);
  const enterButton = page.getByTestId("enter-fiction-mission");
  await expect(enterButton).toBeVisible({ timeout: 10_000 });
  await enterButton.click();
}

test.describe("Fiction Integrity Copy Gate", () => {
  test("NEUTRALIZE title, briefing, and physical instruction pass the copy gate", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openMenu(page);

    const enterButton = page.getByTestId("enter-fiction-mission");
    await expect(enterButton).toBeVisible({ timeout: 10_000 });
    await expect(enterButton).toHaveText("NEUTRALIZE");
    await enterButton.click();

    const panel = page.locator(".fiction-mission-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("NEUTRALIZE");
    await expect(panel).toContainText(
      "A device has been hidden somewhere inside this sector"
    );
    await expect(panel).toContainText("marked tags");
    await expect(panel).toContainText("5"); // real fixture count of route stops

    const text = (await panel.textContent()) ?? "";
    for (const banned of [
      "distribute 25 flyers",
      "deliver door hangers",
      "do laundry work",
      "marketing task",
      "pause the mission",
      "pause game",
    ]) {
      expect(text.toLowerCase()).not.toContain(banned);
    }
  });

  test("no intermediate 'leave the game to do work' screen exists before the mission", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    // The canvas stays mounted continuously — entering the fiction mission
    // never navigates away from the playable world.
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
    await enterNeutralizeMission(page);
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
  });
});

test.describe("real evidence resolves the mission, not fictional performance", () => {
  test("REAL-WORK-WINS: marking all real stops covered resolves the fiction to success regardless of the timer", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await enterNeutralizeMission(page);

    const covered = page.getByTestId("fixture-mark-stop-covered");
    for (let i = 0; i < 5; i += 1) {
      await covered.click();
    }

    const panel = page.locator(".fiction-mission-panel");
    await expect(panel).toHaveAttribute("data-fiction-outcome", "success", {
      timeout: 5_000,
    });
    await expect(panel).toHaveAttribute("data-authoritative-count", "5");
  });

  test("TWO-CLOCK: zero real evidence never resolves the mission to success on its own", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await enterNeutralizeMission(page);

    const panel = page.locator(".fiction-mission-panel");
    await page.waitForTimeout(1500);
    await expect(panel).not.toHaveAttribute("data-fiction-outcome", "success");
    await expect(panel).toHaveAttribute("data-authoritative-count", "0");
  });
});

test.describe("Stronghold home base", () => {
  test("route table, agents, and chronicle render from real projections", async ({ page }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openMenu(page);
    await page.getByRole("button", { name: "STRONGHOLD" }).click();

    await expect(page.getByTestId("stronghold-panel")).toBeVisible();
    await expect(page.getByTestId("stronghold-route-table")).toBeVisible();
    await expect(page.getByTestId("stronghold-chronicle")).toBeVisible();
  });
});
