import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = "http://127.0.0.1:4177";
const ADMIN_PASSWORD = "goldline-proof-admin-pass";
const OUT = path.resolve("artifacts/lantern-city-v5-qa");

async function login(page) {
  const login = await page.request.post(`${BASE}/api/auth/login`, {
    data: { password: ADMIN_PASSWORD, role: "admin" },
  });
  if (login.status() !== 200) {
    throw new Error(`Admin login failed: ${login.status()}`);
  }
}

async function waitForCity(page) {
  await page.goto(`${BASE}/growth/lantern-city`);
  await page.locator(".lc-page.lc-v5-game").waitFor({ timeout: 60_000 });
  await page.locator(".lc-map").waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".lc-lantern, .lc-pursued-building").length > 0,
    undefined,
    { timeout: 60_000 }
  );
  await page.waitForTimeout(1500);
}

async function shot(page, name) {
  await page.screenshot({
    path: path.join(OUT, name),
    fullPage: false,
  });
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await mkdir(OUT, { recursive: true });

await login(page);

await page.setViewportSize({ width: 1920, height: 1080 });
await waitForCity(page);
await shot(page, "01-default-1920x1080.png");

await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(800);
await shot(page, "02-default-1440x900.png");

await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(800);
await shot(page, "02b-default-1280x900.png");

// Territory gels visible at default zoom
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(500);
await shot(page, "03-territory-state.png");

// Frontier WHAT COULD BE objects
const frontier = page.locator(".lc-frontier-object").first();
if (await frontier.count()) {
  await frontier.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
}
await shot(page, "04-frontier-what-could-be.png");

// Lost ground WHAT WAS — proof seed fixture in Silver Lake
await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto(`${BASE}/growth/lantern-city`);
await waitForCity(page);
const lost = page.locator('[data-territory-id="silver-lake"].lc-lost-ground-object');
await lost.waitFor({ timeout: 30_000 });
await lost.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await shot(page, "05-lost-ground-what-was.png");

// Rekindling / Arsenal on proof cooling lantern (Los Feliz standalone cluster)
await page.goto(`${BASE}/growth/lantern-city`);
await waitForCity(page);
const cooling = page.locator(".lc-v5-lantern.state-dimming").first();
await cooling.waitFor({ timeout: 30_000 });
await cooling.click({ force: true });
await page.locator(".lc-v5-rekindling").waitFor({ timeout: 10_000 });
await page.waitForTimeout(800);
await shot(page, "06-rekindling-arsenal.png");
await page.keyboard.press("Escape").catch(() => {});

// Command rooms
await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".lc-v5-command-btn"));
  buttons[4]?.click();
});
await page.waitForTimeout(600);
await shot(page, "07-command-room.png");

await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".lc-v5-command-btn"));
  buttons[5]?.click();
});
await page.waitForTimeout(600);
await shot(page, "07b-conquest-room.png");

await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll(".lc-v5-command-btn"));
  buttons[0]?.click();
});
await page.waitForTimeout(400);

await page.goto(`${BASE}/growth/lantern-city?worldTruth=1`);
await page.locator(".lc-page").waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);
await shot(page, "08-world-truth.png");

await page.goto(`${BASE}/growth/lantern-city?territoryDebug=1`);
await page.locator(".lc-page").waitFor({ timeout: 30_000 });
await page.waitForTimeout(800);
await shot(page, "09-territory-debug.png");

await browser.close();
console.log(`Saved Lantern City QA shots to ${OUT}`);
