import { chromium } from "@playwright/test";
import { join } from "node:path";

const ARTIFACT_DIR = "/Users/adamwrightpfi/.gemini/antigravity/brain/4225332e-ba0b-4c4e-a6da-8387ff1eea60";
const BASE_URL = "http://localhost:4177";

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  console.log("Logging in as admin...");
  const loginRes = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: { password: "goldline-proof-admin-pass", role: "admin" },
  });
  console.log("Admin login status:", loginRes.status());

  console.log("Navigating to Silver Lake Playable Experience...");
  await page.goto(`${BASE_URL}/growth/lantern-city?cozy=1&preview=synthetic`);
  await page.waitForSelector('[data-testid="cozy-neighborhood-encounter"]', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Capture Wide Neighborhood View
  await page.screenshot({
    path: join(ARTIFACT_DIR, "silver_lake_neighborhood_overview.png"),
    fullPage: false,
  });
  console.log("Captured silver_lake_neighborhood_overview.png");

  // 2. Open Courtyard feature and select Cozy Cedar Tea Table
  const courtyardSpot = page.locator('[data-testid="neighborhood-courtyard-spot"]');
  await courtyardSpot.click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(ARTIFACT_DIR, "courtyard_placement_modal.png"),
  });
  console.log("Captured courtyard_placement_modal.png");

  await page.locator('[data-testid="choose-tea-table"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(ARTIFACT_DIR, "courtyard_consequence_tea_table.png"),
  });
  console.log("Captured courtyard_consequence_tea_table.png");

  // 3. Open Barnaby the Fox (Slot 1 / Mei Lin)
  const slot1 = page.locator('div[role="button"][data-house-title*="Blue Two-Story"]').first();
  await slot1.click();
  await page.waitForSelector('[data-testid="playable-letter-desk"]', { timeout: 5000 });
  await page.waitForTimeout(400);

  // Select "Helpful & Detailed" approach
  await page.locator('[data-testid="approach-helpful_detailed"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(ARTIFACT_DIR, "barnaby_fox_letter_desk.png"),
  });
  console.log("Captured barnaby_fox_letter_desk.png");

  // 4. Close and open Bramble the Badger (Slot 5 / Marcus Vance)
  await page.locator('button[aria-label="Close writing desk"]').click();
  await page.waitForTimeout(300);

  const slot5 = page.locator('div[role="button"][data-house-title*="Lower Purple Stone Cottage"]').first();
  await slot5.click();
  await page.waitForSelector('[data-testid="playable-letter-desk"]', { timeout: 5000 });
  await page.waitForTimeout(400);

  // Select "Warm & Brief" approach
  await page.locator('[data-testid="approach-warm_brief"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(ARTIFACT_DIR, "bramble_badger_letter_desk.png"),
  });
  console.log("Captured bramble_badger_letter_desk.png");

  // 5. Commit schedule
  await page.locator('[data-testid="commit-schedule-button"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(ARTIFACT_DIR, "scheduled_dispatch_shelf.png"),
  });
  console.log("Captured scheduled_dispatch_shelf.png");

  // 6. Switch to Classic Composer Comparison
  await page.locator('[data-testid="mode-classic-button"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: join(ARTIFACT_DIR, "classic_composer_comparison.png"),
  });
  console.log("Captured classic_composer_comparison.png");

  await browser.close();
  console.log("Browser evidence captured successfully!");
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});
