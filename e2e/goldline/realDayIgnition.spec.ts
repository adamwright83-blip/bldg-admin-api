import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

/**
 * This is intentionally NOT a Goldline harness fixture. It boots the live
 * driver controller against CI's disposable MySQL and proves the missing
 * front door end to end:
 *
 * empty authoritative day -> operator briefing -> persisted draft -> human
 * approval -> first real user-supplied objective -> canonical completion ->
 * second objective.
 *
 * The briefing text itself is the evidence. No customer, dollar value,
 * address, appointment, or obligation may appear unless the operator supplied
 * it here and approved the resulting draft.
 */
test.describe("real-day ignition on the live driver controller", () => {
  test.setTimeout(120_000);

  async function loginEmptyDriver(page: Page) {
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
    await page.goto("/driver");
    await expect(page.getByTestId("goldline-shell")).toBeVisible({
      timeout: 30_000,
    });
  }

  test("briefing creates only reviewed real objectives and completion advances the board", async ({
    page,
  }) => {
    await loginEmptyDriver(page);

    // Fresh disposable DB has no route work. Goldline must not call that a
    // finished experience; the briefing is the first obvious action.
    await expect(page.getByTestId("no-active-objective")).toBeVisible({
      timeout: 30_000,
    });
    const briefing = page.getByTestId("empty-day-briefing");
    await expect(briefing).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog", { name: "Open Channel mission briefing" })).toHaveAttribute("data-auto-ignition", "true");
    await expect(briefing).toContainText("BRIEF ME");

    const suppliedBriefing =
      "Today I need to visit Sunset Towers leasing office and ask about the laundry amenity. Tomorrow I must call Russell with the real result.";
    await page.getByLabel("TYPE, CORRECT, OR ADD CONTEXT").fill(suppliedBriefing).catch(async () => {
      await briefing.locator("textarea").fill(suppliedBriefing);
    });

    await page
      .getByRole("button", { name: /TURN THIS INTO A DRAFT MISSION/i })
      .click();

    // Anthropic is optional in CI. The deterministic fallback must preserve
    // the actual supplied sentences rather than invent replacement work.
    await expect(page.getByText(/DRAFT MISSION/i)).toBeVisible({
      timeout: 20_000,
    });
    const firstTitle = page.getByLabel("Step 1 title");
    const secondTitle = page.getByLabel("Step 2 title");
    await expect(firstTitle).toHaveValue(/Sunset Towers/i);
    await expect(secondTitle).toHaveValue(/Russell/i);

    // Nothing is active until the operator explicitly reviews/approves it.
    await page
      .getByRole("button", { name: /CONFIRM THIS IS MY DAY/i })
      .click();

    const current = page.getByTestId("open-channel-current-objective");
    await expect(current).toBeVisible({ timeout: 20_000 });
    await expect(current).toContainText(/Sunset Towers/i);
    await expect(current).toContainText("CURRENT REAL OBJECTIVE");

    // Leaving the full briefing never returns the player to an aimless world:
    // the approved first objective remains a readable world CTA.
    await page.getByRole("button", { name: /RETURN TO WORLD/i }).click();
    const ignition = page.getByTestId("open-channel-ignition-cta");
    await expect(ignition).toBeVisible();
    await expect(ignition).toContainText(/Sunset Towers/i);
    await expect(ignition).toContainText(/CURRENT REAL OBJECTIVE/i);

    await ignition.click();
    await expect(current).toContainText(/Sunset Towers/i);

    // This is the real Open Channel completion mutation, not a fixture
    // counter. Fresh authoritative state must advance to the next approved
    // user-supplied objective.
    await page.getByRole("button", { name: /I DID THIS — ADVANCE/i }).click();
    await expect(current).toContainText(/Russell/i, { timeout: 20_000 });
    await expect(current).not.toContainText(/Sunset Towers/i);
  });
});
