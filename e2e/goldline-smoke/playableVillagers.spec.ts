import { expect, test, type Page } from "@playwright/test";
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
    const scheduleBtn = desk.locator('[data-testid="schedule-slot-morning"]');
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

/**
 * Reunion quests (docs/goldline/silver-lake-3d-slice/REUNION_QUESTS.md).
 * The opening errand is Hazel the squirrel's HOA complaint: a tea cosy for a glove, shake Pip the porcupine, pick up the
 * shed quill, dip it in the ink well, and write Hazel her letter. The letter appeases Hazel and Mei Lin appears; the
 * Letter Desk opens; Cleo (next in line) stays on a one-liner until the operator makes a real decision on Mei Lin.
 */
const MEI = "synthetic:customer:mei_lin";
const SARAH = "synthetic:customer:sarah_jenkins";
type CourtyardHook = {
  state(): { intro: boolean; near: string | null };
  teleportNear(key: string): boolean;
  teleportToItem(key: string): boolean;
  items(): string[];
};
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __silverLake3d: CourtyardHook }).__silverLake3d.items());

async function enterCourtyard(page: Page, url = "/growth/lantern-city?cozy=1&territory=silver-lake&preview=synthetic") {
  // reduced motion: no intro fly-in and no bobbing prompts, so clicks land on a still target
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(url);
  await expect(page.locator('[data-testid="silver-lake-3d"]')).toBeVisible({ timeout: 15000 });
  const world = page.locator('[data-testid="silver-lake-3d-canvas"], [data-testid="silver-lake-3d-unavailable"]').first();
  await expect(world).toBeVisible({ timeout: 30000 });
  if (await page.locator('[data-testid="silver-lake-3d-unavailable"]').isVisible()) return false;
  await page.waitForFunction(
    () => (window as unknown as { __silverLake3d?: CourtyardHook }).__silverLake3d?.state().intro === true,
    undefined,
    // software WebGL on CI can take well over a minute to load the courtyard
    { timeout: 120_000 }
  );
  return true;
}

async function talkTo(page: Page, key: string, name: string | RegExp) {
  // the giver appears once the visit's quests are assigned (for real customers, after saved progress loads)
  await expect
    .poll(() => page.evaluate(k => (window as unknown as { __silverLake3d: CourtyardHook }).__silverLake3d.teleportNear(k), key))
    .toBe(true);
  const prompt = page.locator('[data-testid="silver-lake-3d-talk"]');
  await expect(prompt).toContainText(typeof name === "string" ? `Talk to ${name}` : name);
  await prompt.click();
}

async function useProp(page: Page, key: string, prompt: string, note: string | RegExp) {
  await expect.poll(() => hook(page)).toContain(key);
  await page.evaluate(k => (window as unknown as { __silverLake3d: CourtyardHook }).__silverLake3d.teleportToItem(k), key);
  const pick = page.locator('[data-testid="silver-lake-3d-pick"]');
  await expect(pick).toContainText(prompt);
  await pick.click();
  await expect(page.locator('[data-testid="quest-note"]')).toContainText(note);
}

/** Hazel's errand, in order, including Pip saying ow to a bare hand */
async function writeHazelsLetter(page: Page, customerId: string) {
  const tasks = page.locator('[data-testid="quest-tasks"]');
  await expect(tasks).toContainText("Shake the porcupine");
  await expect(tasks).toContainText("Dip its shed quill in the ink well");
  await expect(tasks).toContainText("Write a letter to the squirrel to appease its HOA complaint");
  await useProp(page, `item:${customerId}#shake`, "Shake the porcupine", "OW");
  await useProp(page, `item:${customerId}#glove`, "Put on the tea cosy", "tea cosy");
  await expect(tasks).toContainText("Wearing: a tea cosy, as a glove");
  await useProp(page, `item:${customerId}#shake`, "Shake the porcupine", "one shed quill floats down");
  await expect(tasks.locator('li[data-done="true"]')).toHaveCount(1);
  await useProp(page, `item:${customerId}#quill`, "Pick up the quill", "Freshly shed");
  await useProp(page, `item:${customerId}#dip`, "Dip the quill in the ink well", "ready to write");
  await expect(tasks.locator('li[data-done="true"]')).toHaveCount(2);
}

async function findItem(page: Page, customerId: string, item = "old garden hose", giver = "Cleo") {
  await expect.poll(() => hook(page)).toContain(`item:${customerId}`);
  await page.evaluate(
    k => (window as unknown as { __silverLake3d: CourtyardHook }).__silverLake3d.teleportToItem(k),
    `item:${customerId}`
  );
  const pick = page.locator('[data-testid="silver-lake-3d-pick"]');
  await expect(pick).toContainText(`Pick up the ${item}`);
  await pick.click();
  await expect(page.locator('[data-testid="quest-note"]')).toContainText(`You found the ${item}! Bring it to ${giver}.`);
}

async function reunite(page: Page, customerId = MEI, giver: string | RegExp = "Hazel") {
  await talkTo(page, `quest:${customerId}`, giver);
  const dialog = page.locator('[data-testid="quest-dialog"]');
  await expect(dialog).toHaveAttribute("data-quest-phase", "carrying");
  await dialog.locator('[data-testid="quest-give"]').click();
  const vignette = page.locator('[data-testid="reunion-vignette"]');
  await expect(vignette).toBeVisible();
  while (await vignette.locator('[data-testid="reunion-next"]').isVisible()) {
    await vignette.locator('[data-testid="reunion-next"]').click();
  }
  return vignette;
}

async function expectCleoLocked(page: Page) {
  await talkTo(page, `quest:${SARAH}`, "Cleo");
  const dialog = page.locator('[data-testid="quest-dialog"]');
  await expect(dialog).toHaveAttribute("data-quest-phase", "locked");
  await expect(dialog.locator('[data-testid="quest-line"]')).toHaveText("Shh. I'm tuning a stick. Come back in a bit?");
  await expect(dialog.locator('[data-testid="quest-skip"]')).toHaveText("Just write to Sarah");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test.describe("Silver Lake reunion quests", () => {
  test.beforeEach(async ({ page }) => {
    // walking the courtyard under software WebGL on CI takes 1–2 minutes a test, test 11 loads it twice, and Hazel's
    // errand is five props long; the suite default is 90s
    test.setTimeout(480_000);
    await resetGoldlineProofWorld(page.request);
  });

  test("8. Hazel's HOA letter: tea cosy, porcupine, quill, ink well; the reunion shows Mei Lin's real numbers, the Letter Desk opens, and only scheduling unlocks Cleo", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    test.skip(!(await enterCourtyard(page)), "this runner has no WebGL, so the courtyard (and its quests) cannot start");

    // the roster still opens every customer directly
    await expect(page.locator('[data-testid="silver-lake-villager"]')).toHaveCount(8);

    // Hazel's need, with the always-visible skip
    await talkTo(page, `quest:${MEI}`, "Hazel");
    const dialog = page.locator('[data-testid="quest-dialog"]');
    await expect(dialog).toHaveAttribute("data-quest-id", "squirrel_hoa_letter");
    await expect(dialog).toHaveAttribute("data-quest-phase", "need");
    await expect(dialog.locator('[data-testid="quest-line"]')).toContainText("formal complaint with the Silver Lake HOA");
    await expect(dialog.locator('[data-testid="quest-skip"]')).toHaveText("Just write to Mei");
    await page.keyboard.press("Escape");

    // the next giver only has a one-liner
    await expectCleoLocked(page);

    // the errand, then the letter: the reunion plays with real numbers only
    await writeHazelsLetter(page, MEI);
    const vignette = await reunite(page);
    const beats = vignette.locator('[data-testid="reunion-beat"]');
    await expect(beats.filter({ hasText: "You write the letter in your best quill handwriting" })).toHaveCount(1);
    await expect(beats.filter({ hasText: "Mei Lin is there." })).toHaveCount(1);
    await expect(beats.filter({ hasText: "42 days since the last pickup" })).toHaveCount(1);
    await expect(beats.filter({ hasText: "5 orders, then nothing" })).toHaveCount(1);
    await expect(vignette).toContainText("Your letter to Mei Lin stays plain and truthful.");

    // Hazel introduces Mei Lin; the existing Letter Desk opens with the pre-drafted text, free of fiction
    await vignette.locator('[data-testid="reunion-write"]').click();
    const desk = page.locator('[data-testid="playable-letter-desk"]');
    await expect(desk).toBeVisible();
    const letter = await desk.locator('[data-testid="cozy-message-draft-textarea"]').inputValue();
    expect(letter).toContain("Mei");
    expect(letter).toContain("42 days");
    expect(letter).not.toMatch(/quill|porcupine|Pip|Hazel|squirrel|HOA|tea cosy|ink well|courtyard/i);

    // solving the puzzle and opening the desk is not a decision: Cleo is still locked
    await desk.locator('button[aria-label="Close writing desk"]').click();
    await expect(desk).toBeHidden();
    await expectCleoLocked(page);

    // a real decision (schedule) unlocks Cleo
    await page.locator('[data-testid="silver-lake-villager"][data-customer-id="synthetic:customer:mei_lin"]').click();
    await expect(desk).toBeVisible();
    await desk.locator('[data-testid="schedule-slot-morning"]').click();
    await expect(desk.locator('[data-testid="banner-scheduled"]')).toContainText(/Scheduled — not sent/i, { timeout: 20_000 });
    await desk.locator('button[aria-label="Close writing desk"]').click();
    await talkTo(page, `quest:${SARAH}`, "Cleo");
    await expect(dialog).toHaveAttribute("data-quest-phase", "need");
    await expect(dialog.locator('[data-testid="quest-line"]')).toContainText("flute");
    expect(errors).toEqual([]);
  });

  test("9. Passing on Mei Lin is a real decision: Cleo opens up, and nothing is sent", async ({ page }) => {
    test.skip(!(await enterCourtyard(page)), "this runner has no WebGL, so the courtyard (and its quests) cannot start");
    await writeHazelsLetter(page, MEI);
    const vignette = await reunite(page);
    await vignette.locator('[data-testid="reunion-pass"]').click();
    await expect(vignette).toBeHidden();
    await expect(page.locator('[data-testid="quest-note"]')).toContainText("You passed on Mei Lin for now. Nothing was sent.");
    const mei = page.locator('[data-testid="silver-lake-villager"][data-customer-id="synthetic:customer:mei_lin"]');
    await expect(mei).toHaveAttribute("data-communication-state", "draft_prepared");
    await talkTo(page, `quest:${SARAH}`, "Cleo");
    await expect(page.locator('[data-testid="quest-dialog"]')).toHaveAttribute("data-quest-phase", "need");
    // and Cleo's hose is a single find, as before
    await page.keyboard.press("Escape");
    await findItem(page, SARAH);
  });

  test("10. Just write to them: the skip opens the Letter Desk before any puzzle", async ({ page }) => {
    test.skip(!(await enterCourtyard(page)), "this runner has no WebGL, so the courtyard (and its quests) cannot start");
    await talkTo(page, `quest:${MEI}`, "Hazel");
    await page.locator('[data-testid="quest-skip"]').click();
    const desk = page.locator('[data-testid="playable-letter-desk"]');
    await expect(desk).toBeVisible();
    await expect(desk).toHaveAttribute("data-villager-variant", "fox");
  });

  test("11. Real customers: the reunion and a pass are saved on the server and survive a reload; nothing is sent", async ({
    page,
  }) => {
    const real = "/growth/lantern-city?cozy=1&territory=silver-lake";
    test.skip(!(await enterCourtyard(page, real)), "this runner has no WebGL, so the courtyard (and its quests) cannot start");
    await expect.poll(async () => (await hook(page)).length, { timeout: 15000 }).toBeGreaterThan(0);
    const keys = await hook(page);
    const first = keys[0];
    const customerId = first.slice("item:".length).replace(/#[^#]*$/, "");
    const roster = page.locator(`[data-testid="silver-lake-villager"][data-customer-id="${customerId}"]`);
    const stateBefore = await roster.getAttribute("data-communication-state");

    // the opening errand is Hazel's, unless this customer's own villager is a squirrel (then it's Cleo's hose)
    const hazel = keys.some(k => k.includes("#"));
    const giver = hazel ? "Hazel" : "Cleo";
    if (hazel) await writeHazelsLetter(page, customerId);
    else await findItem(page, customerId);
    const vignette = await reunite(page, customerId, giver);
    await expect(vignette).not.toContainText(/undefined|NaN|null/);
    await vignette.locator('[data-testid="reunion-pass"]').click();
    await expect(page.locator('[data-testid="quest-note"]')).toContainText("for now. Nothing was sent.");
    await expect(roster).toHaveAttribute("data-communication-state", stateBefore ?? "");

    // the pass is on the server: after a reload the errand is done, and the next errand (if any) is the open one
    await enterCourtyard(page, real);
    await talkTo(page, `quest:${customerId}`, giver);
    await expect(page.locator('[data-testid="quest-dialog"]')).toHaveAttribute("data-quest-phase", "done");
    await page.keyboard.press("Escape");
    expect((await hook(page)).some(k => k.startsWith(`item:${customerId}`))).toBe(false);
    await expect(roster).toHaveAttribute("data-communication-state", stateBefore ?? "");
  });
});
