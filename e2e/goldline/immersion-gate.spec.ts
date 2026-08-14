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
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
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

/**
 * The harness's test-only controls render outside (before) the game shell,
 * which is a full-viewport overlay — same pointer-interception issue the
 * existing `goldline-fixture-toggle-world` control already solves via a raw
 * DOM click rather than a simulated pointer click.
 */
async function clickFixtureButton(page: Page, testId: string) {
  await page.getByTestId(testId).evaluate(node => {
    (node as HTMLButtonElement).click();
  });
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
    await expect(panel).toContainText("A device has compromised this sector");
    await expect(panel).toContainText(
      "Visit each of the 5 marked commercial locations"
    );
    await expect(panel).toContainText("commercial visit outcome is saved");
    await expect(panel).toContainText("5"); // real fixture count of route stops

    const text = (await panel.textContent()) ?? "";
    for (const banned of [
      "distribute 25 flyers",
      "deliver door hangers",
      "do laundry work",
      "marketing task",
      "pause the mission",
      "pause game",
      "marked tags",
      "front doors",
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

    for (let i = 0; i < 5; i += 1) {
      await clickFixtureButton(page, "fixture-mark-stop-covered");
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

test.describe("NEUTRALIZE route stops stay in-game", () => {
  test("CASE A — PREP INCOMPLETE: required field prep is completed in-game, with no fallback to the legacy sales-mission page anywhere in the VISIT lifecycle", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await enterNeutralizeMission(page);

    const panel = page.locator(".fiction-mission-panel");
    await expect(panel).toBeVisible();
    const firstStop = page
      .locator(".fiction-route-stops button")
      .filter({ hasText: "OPEN VISIT" })
      .first();
    await expect(firstStop).toBeVisible();

    const urlBeforeSelect = page.url();
    await firstStop.click();

    // Same page, canvas still mounted — no navigation to the legacy
    // /driver/sales-mission/:id page.
    expect(page.url()).toBe(urlBeforeSelect);
    expect(page.url()).not.toContain("/driver/sales-mission/");
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);

    const surface = page.locator(".goldline-action-surface");
    await expect(surface).toBeVisible();
    await expect(surface).toContainText("VISIT");

    await surface.getByRole("button", { name: /PREPARE VISIT/ }).click();

    // Genuine field prep starts incomplete (fixture mirrors production's
    // fieldStartPreparation seeding a required, pending checklist item) —
    // DEPART must not be available yet, and the surface must expose the
    // required checklist item in-game rather than a link out of Goldline.
    const departButton = surface.getByRole("button", { name: /^DEPART/ });
    await expect(departButton).toHaveCount(0);
    expect(await surface.locator("a[href*='/driver/sales-mission/']").count()).toBe(
      0
    );
    const checklistItem = surface.getByRole("button", {
      name: /Confirm address/,
    });
    await expect(checklistItem).toBeVisible();
    expect(page.url()).not.toContain("/driver/sales-mission/");
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);

    // Complete genuine required prep in-game — the same canonical
    // fieldChecklist mutation CommercialSalesMission.tsx uses.
    await checklistItem.click();
    await expect(departButton).toBeVisible({ timeout: 5_000 });

    // Same page, same mounted canvas, still no legacy-page escape anywhere
    // in the lifecycle so far.
    expect(page.url()).toBe(urlBeforeSelect);
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
    expect(await surface.locator("a[href*='/driver/sales-mission/']").count()).toBe(
      0
    );

    await departButton.click();
    await surface
      .getByRole("button", { name: /ARRIVED · RECORD VISIT/ })
      .click();
    await surface.getByLabel("WHAT HAPPENED").fill("Real visit completed.");
    await surface.locator("input[type='datetime-local']").fill(
      "2026-08-20T10:00"
    );
    await surface
      .getByRole("button", { name: "RECORD VISIT RESULT" })
      .click();

    // The canonical write completes, the surface closes, and the player is
    // back at the SAME NEUTRALIZE mission with server-derived coverage
    // increased by exactly one real stop.
    await expect(surface).not.toBeVisible({ timeout: 5_000 });
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-authoritative-count", "1");
    await expect(page.getByTestId("fixture-covered-count")).toHaveText("1");
    expect(page.url()).not.toContain("/driver/sales-mission/");
  });

  test("CASE B — NO REAL ADDRESS: a genuinely address-less route stop fails closed and never opens the legacy page", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await clickFixtureButton(page, "fixture-strip-first-stop-address");
    await enterNeutralizeMission(page);

    const unavailableStop = page
      .locator(".fiction-route-stops button")
      .filter({ hasText: "UNAVAILABLE" })
      .first();
    await expect(unavailableStop).toBeVisible();
    await expect(unavailableStop).toBeDisabled();

    await unavailableStop.click({ force: true });

    // No authoritative visit write, no legacy-page fallback, no fabricated
    // address — the stop simply never opens an action surface.
    expect(page.url()).not.toContain("/driver/sales-mission/");
    await expect(page.locator(".goldline-action-surface")).not.toBeVisible();
    await expect(page.getByTestId("fixture-covered-count")).toHaveText("0");
  });

  test("CASE C — ALREADY COVERED: a recorded stop stays disabled/read-only, with no duplicate action or evidence", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await enterNeutralizeMission(page);

    // Mark every real stop covered so the panel resolves to success, then
    // confirm a covered stop remains disabled rather than reopening the
    // surface — the recorded-evidence path stays a truthful terminal state.
    for (let i = 0; i < 5; i += 1) {
      await clickFixtureButton(page, "fixture-mark-stop-covered");
    }
    const recordedStop = page
      .locator(".fiction-route-stops button")
      .filter({ hasText: "VISIT RECORDED" })
      .first();
    await expect(recordedStop).toBeVisible();
    await expect(recordedStop).toBeDisabled();
    await recordedStop.click({ force: true });
    expect(page.url()).not.toContain("/driver/sales-mission/");
    await expect(page.locator(".goldline-action-surface")).not.toBeVisible();
    await expect(page.getByTestId("fixture-covered-count")).toHaveText("5");
  });
});

test.describe("Stronghold home base", () => {
  test("route table, driver-safe intel, agents, and chronicle render from real projections", async ({
    page,
  }) => {
    await loginToNeutralizeFixture(page);
    await page.waitForTimeout(800);
    await openMenu(page);
    await page.getByRole("button", { name: "STRONGHOLD", exact: true }).click();

    await expect(page.getByTestId("stronghold-panel")).toBeVisible();
    await expect(page.getByTestId("stronghold-route-table")).toBeVisible();
    await expect(page.getByTestId("stronghold-intel")).toContainText(
      "3 accepted teachings"
    );
    await expect(page.getByTestId("stronghold-intel")).toContainText(
      "discovery · 2"
    );
    await expect(page.getByTestId("stronghold-chronicle")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("goldline-shell")).toBeVisible();
    await openMenu(page);
    await page.getByRole("button", { name: "STRONGHOLD", exact: true }).click();
    await expect(page.getByTestId("stronghold-intel")).toContainText(
      "3 accepted teachings"
    );

    await clickFixtureButton(page, "fixture-remove-stronghold-intel");
    await expect(page.getByTestId("stronghold-intel")).toHaveText(
      "No reviewed sales intelligence is available."
    );
    await expect(page.getByTestId("stronghold-intel")).not.toContainText(
      "discovery"
    );
  });
});
