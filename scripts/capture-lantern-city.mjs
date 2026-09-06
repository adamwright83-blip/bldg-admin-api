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
 *   LANTERN_CUSTOMER_STATE=frontier node scripts/capture-lantern-city.mjs # five active guardians
 */
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const origin = process.env.LANTERN_CAPTURE_ORIGIN || "http://127.0.0.1:5173";
const outputDir = path.resolve(process.cwd(), "screenshots", "lantern-city-v2");
const scenario = process.env.TOWER_WARS_STATE || "live";
const customerScenario = process.env.LANTERN_CUSTOMER_STATE || "full";
const territoryScenario = process.env.LANTERN_TERRITORY_STATE || "fixture";
const territoryDebug = process.env.LANTERN_TERRITORY_DEBUG === "1";
const worldTruth = process.env.LANTERN_WORLD_TRUTH === "1";

const VIEWPORTS = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1440x1000", width: 1440, height: 1000 },
  { name: "1536x1024", width: 1536, height: 1024 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "390x844", width: 390, height: 844 },
];

const WEST = -118.445, EAST = -118.225, SOUTH = 34.02, NORTH = 34.135;
const mercY = lat => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function project(latitude, longitude) {
  const x = ((longitude - WEST) / (EAST - WEST)) * 100;
  const y = ((mercY(NORTH) - mercY(latitude)) / (mercY(NORTH) - mercY(SOUTH))) * 100;
  return { x, y, outOfBounds: x < 0 || x > 100 || y < 0 || y > 100 };
}

/*
  Real Laundry Farm customers, when a local export is present.

  `LANTERN_FIXTURE` points at a JSON file produced from the CleanCloud export
  with every address resolved through Google Address Validation — the same
  provider the production geographic-truth pipeline reaches for first. It is
  read from disk and never committed: those rows are real names, emails, phones
  and home addresses, and this repository is not where that belongs.

  Without it the script falls back to the small synthetic seed below, so the
  harness still runs for anyone who does not have the export.
*/
const fixturePath = process.env.LANTERN_FIXTURE;
let realCustomers = null;
if (fixturePath) {
  const raw = JSON.parse(await fs.readFile(fixturePath, "utf8"));
  realCustomers = raw.map((row, index) => ({
    identityKey: `lf-${row.customerId ?? index}`,
    phone: row.phone ?? null,
    displayName: row.name,
    address: row.address,
    unit: null,
    cadence: { state: row.state, daysSinceLastOrder: row.daysSince ?? 999 },
    totalOrders: row.totalOrders ?? 0,
    lastOrderAt: null,
    location: {
      latitude: row.latitude,
      longitude: row.longitude,
      canonicalAddress: row.formatted ?? row.address,
      ...project(row.latitude, row.longitude),
    },
    geocodeStatus: "success",
  }));
  console.error(`[fixture] ${realCustomers.length} real customers loaded`);
}

/** Fallback seed. Real LA coordinates, but invented people. */
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


const syntheticCustomers = CUSTOMER_SEED.map(([displayName, latitude, longitude, state], index) => ({
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
const allCustomers = realCustomers ?? syntheticCustomers;
const customers = customerScenario === "frontier"
  ? allCustomers.filter(customer =>
      /Beverly Hills|Koreatown|Silver Lake/i.test(customer.displayName)
    )
  : allCustomers;

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


/*
  Territory board fixtures.

  Six territories anchored on REAL Los Angeles coordinates, one per readiness
  state plus repeats, so the board can be judged on the four states it actually
  renders. Shapes match `TerritoryDefinition` / `TerritoryDerivedState` exactly;
  nothing here is a convenience object the real server could not produce.
*/
const TERRITORY_SEED = [
  ["Silver Vault", "Beverly Hills", "cleared", "thunder_king", 34.0736, -118.4004],
  ["The Quiet Mile", "West Hollywood", "confrontation_ready", "cloud_duchess", 34.09, -118.3617],
  ["Lantern Reach", "Hollywood", "in_progress", "sleepy_one_eye", 34.0928, -118.3287],
  ["Hollow Ward", "Echo Park", "veiled", "tiny_emperor", 34.0782, -118.2606],
  ["The Long Wire", "Downtown", "in_progress", "gust_jester", 34.0505, -118.2479],
  ["Still Harbour", "Silver Lake", "cleared", "drizzle_detective", 34.0869, -118.2702],
];

const boardEntities = TERRITORY_SEED.map(([title, , , , latitude, longitude], index) => ({
  id: `entity-${index}`,
  displayName: `${title} anchor`,
  identityStatus: "confirmed",
  aliases: [], bindings: [], events: [], evidence: [],
  canonicalAsset: null,
  location: { latitude, longitude, ...project(latitude, longitude) },
  residents: [],
  pursuit: null,
  projection: { attentionReasons: [] },
  presentation: { veil: "none", marks: [], prominenceTier: "ambient", attentionSummary: null },
  obligations: null,
}));

const territories = TERRITORY_SEED.map(([fantasyTitle, realGeographyLabel, readiness, guardianId], index) => {
  const memberId = `entity-${index}`;
  const cleared = readiness === "cleared";
  return {
    definition: {
      id: `00000000-0000-4000-8000-00000000000${index}`,
      tenantId: "fixture",
      stableKey: `territory-key-${index}`,
      version: 1,
      fantasyTitle,
      realGeographyLabel,
      grammar: "visit_hunt",
      guardianId,
      members: [{ physicalEntityId: memberId, requiredAction: "visit", order: 0, sourceReason: "fixture" }],
      geometryMode: "cluster",
      createdFrom: "fixture",
      publishedAt: new Date().toISOString(),
      classification: "game_projection",
    },
    state: {
      territoryId: `00000000-0000-4000-8000-00000000000${index}`,
      stableKey: `territory-key-${index}`,
      version: 1,
      readiness,
      completedMemberIds: readiness === "veiled" ? [] : [memberId],
      remainingMemberIds: readiness === "veiled" ? [memberId] : [],
      members: [{ physicalEntityId: memberId, requiredAction: "visit", completed: readiness !== "veiled", evidenceEventId: null, evidenceOccurredAt: null }],
      confrontationReady: readiness === "confrontation_ready",
      cleared,
      clearedAt: cleared ? new Date().toISOString() : null,
      clearedEventId: null,
      guardianId,
      evidenceRevisedAfterClear: false,
    },
  };
});

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
    case "system.goldlineWorld.cityEntities": return boardEntities;
    case "system.goldlineWorld.territories": return territoryScenario === "empty" ? [] : territories;
    case "system.goldlineWorld.campaign": return null;
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
  const query = new URLSearchParams();
  if (territoryDebug) query.set("territoryDebug", "1");
  if (worldTruth) query.set("worldTruth", "1");
  const queryString = query.toString();
  await page.goto(`${origin}/growth/lantern-city${queryString ? `?${queryString}` : ""}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  /*
    JPEG, not PNG. These are visual QA artifacts of a photographic map: the
    PNG set weighed 26MB, which is permanent repo weight for something the
    script regenerates on demand. Quality 82 keeps every detail this pass is
    judged on and costs ~400KB a frame.
  */
  const file = `lantern-city-${scenario}-${customerScenario}${territoryDebug ? "-territory-debug" : ""}${worldTruth ? "-world-truth" : ""}-${viewport.name}.jpg`;
  await page.screenshot({ path: path.join(outputDir, file), type: "jpeg", quality: 82 });

  // Browser-level zoom QA for the real Admin composition. The camera uses
  // factor = exp(-deltaY * .0016), so these wheel deltas are approximately
  // 2x and then 3x relative to the default pose. This exercises the actual
  // Goldline camera instead of merely cropping the generated master.
  if (viewport.name === "1920x1080" && !worldTruth && !territoryDebug) {
    const host = page.locator(".cr-world-camera");
    const box = await host.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.52);
      await page.mouse.wheel(0, -433);
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.join(outputDir, "lantern-city-vector-fantasy-zoom-200.jpg"),
        type: "jpeg",
        quality: 88,
      });
      await page.mouse.wheel(0, -253);
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.join(outputDir, "lantern-city-vector-fantasy-zoom-300.jpg"),
        type: "jpeg",
        quality: 88,
      });
    }
  }
  let briefing = 0;
  if (customerScenario === "frontier" && viewport === VIEWPORTS[0]) {
    await page.locator(".gl-freedom-object-hit").first().click();
    briefing = await page.locator(".lc-frontier-briefing").count();
    await page.locator(".lc-frontier-briefing img").waitFor({ state: "visible" });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(outputDir, "lantern-city-frontier-briefing.jpg"),
      type: "jpeg",
      quality: 82,
    });
  }
  report.push({
    viewport: viewport.name, file, scenario, customerScenario, worldTruth, briefing,
    towers: await page.locator("[data-combat='true']").count(),
    lanterns: await page.locator(".lc-lantern").count(),
    veil: await page.locator(".gl-world-veil").count(),
    veilHoles: await page.locator(".gl-world-veil circle").count(),
    hud: await page.locator(".lc-rivalry-hud").count(),
    dock: await page.locator(".gl-command-dock .gl-command").count(),
    freedomObjects: await page.locator(".gl-freedom-object").count(),
    futureObjectives: await page.locator(".gl-future-objective").count(),
    projectiles: await page.locator(".pwc-combat-round").count(),
    islands: await page.locator(".gl-board-island").count(),
    guardianArt: await page.locator(".gl-guardian-art").count(),
    veilGuardianIds: await page.locator(".gl-veil-guardian .gl-guardian").evaluateAll(els => els.map(el => el.getAttribute("data-testid"))),
    legacyGuardianSvg: await page.locator(".gl-guardian-svg").count(),
    bridges: await page.locator(".gl-board-bridge").count(),
    islandVariants: await page.locator(".gl-board-island").evaluateAll(els => [...new Set(els.map(e => e.dataset.variant))].sort()),
    damagedPlates: await page.locator("[data-damaged='true']").count(),
    legacyPortals: await page.locator(".gl-world-portal:visible").count(),
    consoleErrors: [...consoleErrors],
  });
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
