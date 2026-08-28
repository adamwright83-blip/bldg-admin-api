import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const origin = process.env.ADMIN_CAPTURE_ORIGIN || "http://127.0.0.1:5173";
const outputDir = path.resolve(process.cwd(), "screenshots");

const emptyContestTotals = {
  grand: { stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, clearentXplorPayRevenue: 0, totalOperationalRevenue: 0 },
  properties: {
    opus_la: { propertyDisplayName: "OPUS LA", stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, clearentXplorPayRevenue: 0, totalOperationalRevenue: 0, towers: {
      opus_south_3545: { towerDisplayName: "South Tower", buildingAddressCanonical: "3545 Wilshire Blvd", totalOperationalRevenue: 0 },
      opus_north_3650: { towerDisplayName: "North Tower", buildingAddressCanonical: "3650 W 6th Street", totalOperationalRevenue: 0 },
      unknown: { towerDisplayName: "Unknown Tower", buildingAddressCanonical: null, totalOperationalRevenue: 0 },
    } },
    century_park_east: { propertyDisplayName: "Century Park East", stripeVerifiedRevenue: 0, legacyCleanCloudRevenue: 0, clearentXplorPayRevenue: 0, totalOperationalRevenue: 0, towers: {
      cpe_south_2170: { towerDisplayName: "South Tower", buildingAddressCanonical: "2170 Century Pk E", totalOperationalRevenue: 0 },
      cpe_north_2160: { towerDisplayName: "North Tower", buildingAddressCanonical: "2160 Century Pk E", totalOperationalRevenue: 0 },
    } },
  },
};

function fixtureFor(procedure) {
  if (procedure === "auth.me") return { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" };
  if (procedure === "admin.listCustomers") return { customers: [], buildingSummary: {}, contestTotals: emptyContestTotals };
  if (procedure === "admin.getCollectedToday" || procedure === "admin.getAwaitingPayment") return { dbAvailable: false, cents: null, processorLabel: null };
  if (procedure === "admin.dashboardSummary") return null;
  if (procedure === "system.dayDirector.state") return null;
  if (/\.count|count[A-Z]/.test(procedure)) return 0;
  if (/\.list|list[A-Z]|search[A-Z]/.test(procedure)) return [];
  return null;
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", error => consoleErrors.push(error.message));
await page.route("**/api/trpc/**", async route => {
  const requestUrl = new URL(route.request().url());
  const encoded = requestUrl.pathname.split("/api/trpc/")[1] || "";
  const procedures = decodeURIComponent(encoded).split(",").filter(Boolean);
  const payload = procedures.map(procedure => ({ result: { data: { json: fixtureFor(procedure) } } }));
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
});

const captures = [
  ["home.png", "/home", "Persistent World Control"],
  ["growth-lantern-city.png", "/growth/lantern-city", "Lantern City Atlas"],
  ["growth-tower-wars.png", "/growth/tower-wars", "Tower Wars"],
  ["operations.png", "/operations", "Operations"],
  ["customers.png", "/customers", "Customers"],
  ["growth-driver-intelligence.png", "/growth/driver-intelligence", "Admin governs the machinery"],
];

const report = [];
for (const [file, route, expectedText] of captures) {
  consoleErrors.length = 0;
  await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const bodyText = await page.locator("body").innerText();
  const overlay = await page.locator(".vite-error-overlay, #webpack-dev-server-client-overlay").count();
  await page.screenshot({ path: path.join(outputDir, file), fullPage: true });
  report.push({ route, file, hasContent: bodyText.trim().length > 0, expectedTextPresent: bodyText.includes(expectedText), errorOverlay: overlay > 0, consoleErrors: [...consoleErrors] });
}

await fs.writeFile(path.join(outputDir, "browser-verification.json"), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(report, null, 2));
