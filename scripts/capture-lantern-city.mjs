/**
 * Lantern City desktop visual QA.
 *
 * Renders the real Lantern City route against FIXTURE tRPC responses and
 * captures the four desktop viewports the combat pass is designed for.
 *
 * Why fixtures: the Railway MySQL that backs the real atlas is private-network
 * only, so a local run has no customers, no pursued buildings and no compiled
 * Tower Wars ledger — the page lays out empty and proves nothing. The fixtures
 * below are shaped exactly like the server's own responses and use REAL Los
 * Angeles coordinates, so the composition under test is the one real data
 * produces. They exist to make the screen renderable, never to make it look
 * better than it is.
 *
 * Everything the fixtures assert is deliberately modest: a handful of customers
 * at real addresses, one pursued building, and a small live Tower Wars day.
 *
 *   node scripts/capture-lantern-city.mjs
 *   TOWER_WARS_STATE=empty node scripts/capture-lantern-city.mjs   # no truth yet
 *   TOWER_WARS_STATE=heavy node scripts/capture-lantern-city.mjs   # damaged plates
 */
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const origin = process.env.LANTERN_CAPTURE_ORIGIN || "http://127.0.0.1:5173";
const outputDir = path.resolve(process.cwd(), "screenshots", "lantern-city-v2");
const scenario = process.env.TOWER_WARS_STATE || "live";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1536x1024", width: 1536, height: 1024 },
  { name: "1920x1080", width: 1920, height: 1080 },
];

/** Real LA addresses with real coordinates. Nothing here is a made-up place. */
const CUSTOMER_SEED = [
  ["Beverly Hills resident", 34.0736, -118.4004, "active"],
  ["Century City resident", 34.0554, -118.4162, "active"],
  ["West Hollywood resident", 34.09, -118.3617, "dimming"],
  ["Hollywood resident", 34.0928, -118.3287, "active"],
  ["Koreatown resident", 34.0578, -118.3009, "dark"],
  ["Los Feliz resident", 34.1182, -118.2865, "active"],
  ["Silver Lake resident", 34.0869, -118.2702, "dimming"],
  ["Echo Park resident", 34.0782, -118.2606, "dark"],
  ["Downtown resident", 34.0505, -118.2479, "active"],
  ["Miracle Mile resident", 34.0622, -118.3561, "active"],
  ["Larchmont resident", 34.0757, -118.3232, "dimming"],
  ["Fairfax resident", 34.0762, -118.3614, "active"],
];

const WEST = -118.445, EAST = -118.225, SOUTH = 34.02, NORTH = 34.135;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function project(latitude, longitude) {
  const x = ((longitude - WEST) / (EAST - WEST)) * 100;
  const y = ((mercY(NORTH) - mercY(latitude)) / (mercY(NORTH) - mercY(SOUTH))) * 100;
  return { x, y, outOfBounds: x < 0 || x > 100 || y < 0 || y > 100 };
}

const customers = CUSTOMER_SEED.map(([displayName, latitude, longitude, state], index) => ({
  identityKey: `fixture-${index}`,
  phone: `555010${String(index).padStart(4, "0")}`,
  displayName,
  address: `${displayName} address`,
  unit: null,
  cadence: { state, daysSinceLastOrder: state === "dark" ? 71 : state === "dimming" ? 24 : 4 },
  totalOrders: state === "dark" ? 3 : 14,
  lastOrderAt: new Date().toISOString(),
  location: { latitude, longitude, canonicalAddress: `${displayName} canonical`, ...project(latitude, longitude) },
  geocodeStatus: "success",
}));

/*
  Internally consistent: one side's attacks are the other side's incoming, and
  the damage word is what damageStateForIncomingAttacks() returns for that
  incoming count. A fixture that contradicted the reducer would be testing a
  screen the real data can never produce.
*/
const TOWER_WARS = {
  live: { cpe: { revenueCents: 41850, orderCount: 9, attacks: 1, incoming: 2, damage: "cracked" },
          opus: { revenueCents: 28400, orderCount: 6, attacks: 2, incoming: 1, damage: "chipped" }, sufficient: true },
  heavy: { cpe: { revenueCents: 12300, orderCount: 3, attacks: 0, incoming: 4, damage: "critical" },
           opus: { revenueCents: 91250, orderCount: 18, attacks: 4, incoming: 0, damage: "pristine" }, sufficient: true },
  empty: null,
};

function towerWarsToday() {
  const spec = TOWER_WARS[scenario];
  const building = (buildingId, s) => ({
    buildingId, revenueCents: s?.revenueCents ?? 0, orderCount: s?.orderCount ?? 0,
    attackCount: s?.attacks ?? 0, incomingAttackCount: s?.incoming ?? 0, unspentValueCents: 0,
    damage: s?.damage ?? "pristine", lastRevenueEventAt: null,
  });
  return {
    tenantId: "fixture", businessDate: "2026-09-05", seasonId: "2026-09-01", timeZone: "America/Los_Angeles",
    window: { startUtc: new Date().toISOString(), endExclusiveUtc: new Date().toISOString() },
    thresholdCents: 5000,
    evidenceSufficient: Boolean(spec?.sufficient),
    ledger: [], exclusions: [], promises: [],
    state: {
      buildings: { century_park_east: building("century_park_east", spec?.cpe), opus_la: building("opus_la", spec?.opus) },
      processedEventIds: [], attacks: [],
    },
    sourceBreakdown: { opus_la: {}, century_park_east: {} },
  };
}

function fixtureFor(procedure) {
  switch (procedure) {
    case "auth.me": return { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" };
    case "system.geographicTruth.atlas":
      return {
        tenantId: "fixture", businessDate: "2026-09-05", timeZone: "America/Los_Angeles",
        provider: { status: "configured", variable: "GOOGLE_GEOCODING_API_KEY" },
        statusCounts: { success: customers.length }, lastRunAt: new Date().toISOString(),
        customers,
        pursued: [{
          pipelineId: 1, accountId: 1, name: "Wilshire Grand", address: "900 Wilshire Blvd",
          stage: "proposal", updatedAt: new Date().toISOString(), geocodeStatus: "success",
          location: { latitude: 34.0489, longitude: -118.2596, canonicalAddress: "900 Wilshire Blvd", ...project(34.0489, -118.2596) },
        }],
      };
    case "system.towerWars.today": return towerWarsToday();
    case "system.goldlineWorld.cityEntities": return [];
    case "system.google.atmosphere": return null;
    case "system.google.opportunityPressure": return null;
    case "system.towerWars.sandboxCapability": return { enabled: false };
    case "system.dayDirector.state": return null;
    case "admin.dashboardSummary": return null;
    default: break;
  }
  if (/\.count|count[A-Z]/.test(procedure)) return 0;
  if (/\.list|list[A-Z]|search[A-Z]/.test(procedure)) return [];
  return null;
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: VIEWPORTS[0], deviceScaleFactor: 1 });
await context.route("**/api/trpc/**", async route => {
  const requestUrl = new URL(route.request().url());
  const encoded = requestUrl.pathname.split("/api/trpc/")[1] || "";
  const procedures = decodeURIComponent(encoded).split(",").filter(Boolean);
  const payload = procedures.map(procedure => ({ result: { data: { json: fixtureFor(procedure) } } }));
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
});

const page = await context.newPage();
const consoleErrors = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push(e.message));

const report = [];
for (const viewport of VIEWPORTS) {
  consoleErrors.length = 0;
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(`${origin}/growth/lantern-city`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  /*
    JPEG, not PNG. These are visual QA artifacts of a photographic map: the
    PNG set weighed 26MB, which is permanent repo weight for something the
    script regenerates on demand. Quality 82 keeps every detail this pass is
    judged on and costs ~400KB a frame.
  */
  const file = `lantern-city-${scenario}-${viewport.name}.jpg`;
  await page.screenshot({ path: path.join(outputDir, file), type: "jpeg", quality: 82 });
  report.push({
    viewport: viewport.name, file, scenario,
    towers: await page.locator("[data-combat='true']").count(),
    lanterns: await page.locator(".lc-lantern").count(),
    hud: await page.locator(".lc-rivalry-hud").count(),
    dock: await page.locator(".gl-command-dock .gl-command").count(),
    projectiles: await page.locator(".pwc-combat-round").count(),
    damagedPlates: await page.locator("[data-damaged='true']").count(),
    legacyPortals: await page.locator(".gl-world-portal:visible").count(),
    consoleErrors: [...consoleErrors],
  });
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
