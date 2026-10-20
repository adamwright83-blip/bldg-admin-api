import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

test.describe.configure({ mode: "serial" });

test.describe("Silver Lake Playable Villager Outreach Experience (Phase 3)", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("1. Mounts playable Silver Lake experience with mode toggle, characters, and courtyard", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/growth/lantern-city?cozy=1&dev=1");

    // Encounter container is visible
    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 15000 });

    // Mode toggles exist: Playable vs Classic, Real vs Synthetic
    const modeSelector = page.locator('[data-testid="experience-mode-selector"]');
    await expect(modeSelector).toBeVisible();
    await expect(page.locator('[data-testid="mode-playable-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="mode-classic-button"]')).toBeVisible();

    // Courtyard interactive feature spot is visible
    const courtyardSpot = page.locator('[data-testid="neighborhood-courtyard-spot"]');
    await expect(courtyardSpot).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("2. Proves two distinct character performances: Barnaby the Fox (Enthusiastic) vs Bramble the Badger (Concise)", async ({
    page,
  }) => {
    // Navigate with synthetic preview enabled for deterministic character slots
    await page.goto("/growth/lantern-city?cozy=1&preview=synthetic");

    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 15000 });

    // --- Performance A: Barnaby the Fox (Slot 1 / Mei Lin) ---
    const slot1 = page.locator('[data-testid="silver-lake-villager"][data-house-title*="Blue Two-Story"]').first();
    await expect(slot1).toBeVisible({ timeout: 10000 });
    await slot1.click();

    // Verify Playable Letter Desk opens with Fox personality
    const desk = page.locator('[data-testid="playable-letter-desk"]');
    await expect(desk).toBeVisible();
    await expect(desk).toHaveAttribute("data-villager-variant", "fox");
    await expect(desk).toHaveAttribute("data-personality-style", "enthusiastic");

    // Dialogue reflects Barnaby's warm, heartfelt greeting
    const dialogue = desk.locator('[data-testid="villager-dialogue"]');
    await expect(dialogue).toContainText(/Barnaby|heartfelt/i);

    // Click "Helpful & Detailed" approach: Barnaby reacts enthusiastically
    const detailedApproach = desk.locator('[data-testid="approach-helpful_detailed"]');
    await detailedApproach.click();
    await expect(dialogue).toContainText(/hug in an envelope|love this one/i);

    // Verify live letter ink updates with customer name and lapsed days
    const letterTextarea = desk.locator('[data-testid="cozy-message-draft-textarea"]');
    const letterContent = await letterTextarea.inputValue();
    expect(letterContent).toContain("Mei");
    expect(letterContent).toContain("42 days");

    // Close desk before selecting Slot 5
    await desk.locator('button[aria-label="Close writing desk"]').click();
    await expect(desk).toBeHidden();

    // --- Performance B: Bramble the Badger (Slot 5 / Marcus Vance) ---
    // Select Slot 5 (Lower Stone Cottage)
    const slot5 = page.locator('[data-testid="silver-lake-villager"][data-house-title*="Lower Purple Stone Cottage"]').first();
    await expect(slot5).toBeVisible();
    await slot5.click();
    await expect(desk).toBeVisible();

    // Verify Playable Letter Desk switches to Badger personality
    await expect(desk).toHaveAttribute("data-villager-variant", "badger");
    await expect(desk).toHaveAttribute("data-personality-style", "concise");

    // Dialogue reflects Bramble's dry, pragmatic personality
    await expect(dialogue).toContainText(/Bramble|don't want a novel|zero fuss/i);

    // Click "Warm & Brief" approach: Bramble approves of brevity
    const briefApproach = desk.locator('[data-testid="approach-warm_brief"]');
    await briefApproach.click();
    await expect(dialogue).toContainText(/proper message|before we start adding extra adjectives/i);
  });

  test("3. Proves persistent neighborhood consequence: courtyard placement is remembered across return visits", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1&preview=synthetic");

    const courtyardSpot = page.locator('[data-testid="neighborhood-courtyard-spot"]');
    await expect(courtyardSpot).toBeVisible({ timeout: 10000 });

    // Click courtyard spot to open placement modal
    await courtyardSpot.click();
    const modal = page.locator('[data-testid="neighborhood-choice-modal"]');
    await expect(modal).toBeVisible();

    // Choose Option A: Cozy Cedar Tea Table
    const chooseTeaTable = page.locator('[data-testid="choose-tea-table"]');
    await chooseTeaTable.click();

    // Modal closes and spot reflects placed Tea Table
    await expect(modal).toBeHidden();
    await expect(courtyardSpot).toHaveAttribute("data-chosen-feature", "tea_table");
    await expect(courtyardSpot).toContainText("Cozy Cedar Tea Table");

    // Leave to Wide City
    const exitBtn = page.getByRole("button", { name: /Return to (Wide )?City/i });
    await exitBtn.click();

    // Re-enter Silver Lake
    await page.goto("/growth/lantern-city?cozy=1&preview=synthetic");
    const reenteredSpot = page.locator('[data-testid="neighborhood-courtyard-spot"]');
    await expect(reenteredSpot).toBeVisible({ timeout: 10000 });

    // Assert that the choice was remembered!
    await expect(reenteredSpot).toHaveAttribute("data-chosen-feature", "tea_table");
    await expect(reenteredSpot).toContainText("Cozy Cedar Tea Table");
  });

  test("4. Proves development comparison toggle between Playable Letter Desk (New) and Classic Composer (Old)", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1&preview=synthetic");

    const slot1 = page.locator('[data-testid="silver-lake-villager"][data-house-title*="Blue Two-Story"]').first();
    await expect(slot1).toBeVisible({ timeout: 10000 });
    await slot1.click();

    // Currently on Playable Letter Desk
    const letterDesk = page.locator('[data-testid="playable-letter-desk"]');
    await expect(letterDesk).toBeVisible();
    await expect(letterDesk.locator('[data-testid="approach-warm_brief"]')).toBeVisible();

    // Toggle to Classic Composer (Phase 1)
    const classicBtn = page.locator('[data-testid="mode-classic-button"]');
    await classicBtn.click();

    // Classic drawer is mounted, approach selector is absent
    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();
    await expect(page.locator('[data-testid="playable-letter-desk"]')).toHaveCount(0);

    // Toggle back to Playable Letter Desk (Phase 3)
    const playableBtn = page.locator('[data-testid="mode-playable-button"]');
    await playableBtn.click();
    await expect(page.locator('[data-testid="playable-letter-desk"]')).toBeVisible();
  });

  test("5. Proves scheduling dispatch interaction and state transitions in synthetic preview", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1&preview=synthetic");

    const slot1 = page.locator('[data-testid="silver-lake-villager"][data-house-title*="Blue Two-Story"]').first();
    await expect(slot1).toBeVisible({ timeout: 10000 });
    await slot1.click();

    const desk = page.locator('[data-testid="playable-letter-desk"]');
    await expect(desk).toBeVisible();

    // Commit future schedule
    const scheduleBtn = desk.locator('[data-testid="commit-schedule-button"]');
    await expect(scheduleBtn).toBeEnabled();
    await scheduleBtn.click();

    // Banner confirms letter is scheduled on the dispatch shelf
    const scheduledBanner = desk.locator('[data-testid="banner-scheduled"]');
    await expect(scheduledBanner).toBeVisible();
    await expect(scheduledBanner).toContainText(/Scheduled — not sent/i);
    await expect(desk).toHaveAttribute("data-communication-state", "scheduled");
  });

  test("6. Proves Phase 4 evolving villager relationship and in-progress draft continuity", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1&preview=synthetic");

    const slot1 = page.locator('[data-testid="silver-lake-villager"][data-house-title*="Blue Two-Story"]').first();
    await expect(slot1).toBeVisible({ timeout: 10000 });
    await slot1.click();

    const desk = page.locator('[data-testid="playable-letter-desk"]');
    await expect(desk).toBeVisible();

    // Verify relationship tier pill is displayed on the desk
    const relationshipTier = desk.locator('[data-testid="villager-relationship-tier"]');
    await expect(relationshipTier).toBeVisible();
    await expect(relationshipTier).toContainText(/New Acquaintance|Familiar Friend|Cherished Partner/i);

    // Edit custom text in letter
    const textarea = desk.locator('[data-testid="cozy-message-draft-textarea"]');
    await textarea.fill("Mei, our team would love to wash your linens tomorrow morning!");

    // Close desk without sending
    await desk.locator('button[aria-label="Close writing desk"]').click();
    await expect(desk).toBeHidden();

    // Re-open Slot 1 for Mei Lin
    await slot1.click();
    await expect(desk).toBeVisible();

    // Verify unfinished draft was preserved and banner shows restoration
    const restoredBanner = desk.locator('[data-testid="restored-draft-banner"]');
    await expect(restoredBanner).toBeVisible();
    await expect(restoredBanner).toContainText(/Restored unfinished letter draft/i);

    // Text content is exactly the modified draft
    const restoredText = await textarea.inputValue();
    expect(restoredText).toBe("Mei, our team would love to wash your linens tomorrow morning!");
  });

  test("7. Proves courtyard placement with Amber Lantern Post and persistent consequence", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1&preview=synthetic");

    const courtyardSpot = page.locator('[data-testid="neighborhood-courtyard-spot"]');
    await expect(courtyardSpot).toBeVisible({ timeout: 10000 });

    // Open choice modal
    await courtyardSpot.click();
    const modal = page.locator('[data-testid="neighborhood-choice-modal"]');
    await expect(modal).toBeVisible();

    // Select Option C: Amber Lantern Post
    const chooseLanternPost = page.locator('[data-testid="choose-lantern-post"]');
    await expect(chooseLanternPost).toBeVisible();
    await chooseLanternPost.click();

    // Modal closes and spot reflects placed Lantern Post
    await expect(modal).toBeHidden();
    await expect(courtyardSpot).toHaveAttribute("data-chosen-feature", "lantern_post");
    await expect(courtyardSpot).toContainText("Amber Lantern Post");
  });
});
