import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Screenshots of the story-season main page from the visual-test build, with tRPC mocked to Season 0 and sample
 * business numbers. Nothing here is real: no database, no customers, no season beyond the public placeholder.
 *
 *   VITE_ADMIN_VISUAL_TEST=1 npx vite --port 5178 --strictPort     (.claude/launch.json: goldline-verify-visual)
 *   node scripts/story/capture-story-home.mjs
 *
 * Images go to $STORY_HOME_CAPTURE_DIR (default: a temp folder), never into the repository. The run also checks the
 * isolation rule end to end: every request carrying the story header names only system.story.*, and every
 * system.story.* request carries it.
 */

const origin = process.env.STORY_HOME_ORIGIN || "http://127.0.0.1:5178";
const outputDir = process.env.STORY_HOME_CAPTURE_DIR || path.join(os.tmpdir(), "story-home-captures");
const STORY_HEADER = "x-joystick-story";

// Season 0, chapter 1, exactly as server/story/fixtures/season-0.json resolves it.
const chapterOne = {
  number: 1,
  title: "Placeholder chapter one",
  gameKey: "fixture.button",
  before: [
    { key: "b1", text: "Placeholder before-line one. Lorem ipsum dolor sit amet.", still: null },
    { key: "b2", text: "Placeholder before-line two. Consectetur adipiscing elit.", still: null },
  ],
};
const after = [{ key: "a1", text: "Placeholder after-line. Sed do eiusmod tempor.", still: null }];
const question = (answered) => ({
  key: "s0.first",
  text: "Placeholder question: left or right?",
  options: [
    { key: "left", text: "Left" },
    { key: "right", text: "Right" },
  ],
  answered,
});

const metric = (value, previous, precision = "exact") => ({
  value,
  previous,
  changePct: value == null || previous == null || previous === 0 ? null : Math.round(((value - previous) / previous) * 1000) / 10,
  precision: value == null ? "unavailable" : precision,
});

// Sample numbers only.
const snapshot = {
  generatedAt: "2026-10-28T03:00:00.000Z",
  timeZone: "America/Los_Angeles",
  today: "2026-10-27",
  monthName: "October",
  city: "Los Angeles",
  week: {
    key: "week",
    label: "Week to date",
    start: "2026-10-26",
    end: "2026-10-27",
    comparison: { start: "2026-10-19", end: "2026-10-20", label: "the same days last week" },
    revenueCents: metric(48200, 41000),
    orders: metric(9, 8),
    newCustomers: metric(null, null),
  },
  month: {
    key: "month",
    label: "Month to date",
    start: "2026-10-01",
    end: "2026-10-27",
    comparison: { start: "2026-09-01", end: "2026-09-27", label: "the same days last month" },
    revenueCents: metric(612400, 655000, "recorded"),
    orders: metric(118, 121),
    newCustomers: metric(14, 9),
  },
};

const territory = (id, name, revenueCents, locatedCustomers) => ({
  id, name, revenueCents, previousRevenueCents: null, revenueChangeCents: null, paidOrderCount: null,
  activeCustomers: null, dormantCustomers: null, locatedCustomers, direction: "unknown", directionReliable: false,
  evidenceNote: "", customers: [],
});
const territoryReport = {
  tenantId: "visual", figuresAreLive: false, windowDays: 30, periodLabel: "the last 30 days", comparisonLabel: null,
  status: "ready", reason: null, geographyBasis: "tenant_location",
  source: { bookStatus: "fresh", completeness: "complete", loadedSources: [], failedSources: [], checkedAt: null, mayStateExact: true, notes: [] },
  comparison: { mostRecordedRevenue: null, steepestDecline: null, dormantOpportunities: [], insufficient: [], withheldReason: null },
  territories: [
    territory("silver-lake", "Silver Lake", 214500, 38),
    territory("los-feliz", "Los Feliz", 132000, 21),
    territory("echo-park", "Echo Park", 98000, 17),
    territory("koreatown", "Koreatown", 76500, 12),
    territory("century-city", "Century City", 54000, 6),
    territory("beverly-hills", "Beverly Hills", null, 4),
    territory("bel-air", "Bel Air", null, 0),
  ],
  unattributed: { revenueCents: 0, orderCount: 0 }, ambiguous: { revenueCents: 0, orderCount: 0 },
  outsideService: { revenueCents: 0, orderCount: 0 }, missingPaymentEvidence: { orderCount: 0, cents: 0 },
  partitionedRevenueCents: null,
};

let story = "available"; // available | won | answered | complete | off
function tonight() {
  if (story === "off") return { enabled: false };
  const base = { enabled: true, seasonTitle: "Season 0 (placeholder)", chapterCount: 3, daysAway: 0 };
  if (story === "complete") return { ...base, state: "season_complete", chapter: null };
  if (story === "available") return { ...base, state: "available", chapter: chapterOne };
  return { ...base, state: "won_tonight", chapter: { ...chapterOne, after, question: question(story === "answered" ? "left" : null) } };
}

function respond(procedure, input) {
  switch (procedure) {
    case "auth.me": return { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" };
    case "system.story.tonight": return tonight();
    case "system.story.start": return { chapterNumber: input?.chapterNumber ?? 1, gameKey: "fixture.button", config: { fixture: true } };
    case "system.story.finish":
      if (input?.outcome !== "win") return { advanced: false, after: null, question: null };
      if (story === "available") story = "won";
      return { advanced: true, after, question: question(story === "answered" ? "left" : null) };
    case "system.story.answer": story = "answered"; return { answered: input?.optionKey };
    case "system.accountSnapshot.get": return snapshot;
    case "system.geographicTruth.territoryReport": return territoryReport;
    case "system.claire.analysisInbox": return [];
    default:
      if (/\.count|count[A-Z]/.test(procedure)) return 0;
      if (/\.list|list[A-Z]|search[A-Z]/.test(procedure)) return [];
      return null;
  }
}

const violations = [];
const storyCalls = [];

async function mockTrpc(page) {
  await page.route("**/api/trpc/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const procedures = decodeURIComponent(url.pathname.split("/api/trpc/")[1] || "").split(",").filter(Boolean);
    const hasHeader = Object.prototype.hasOwnProperty.call(request.headers(), STORY_HEADER);
    for (const procedure of procedures) {
      const isStory = procedure.startsWith("system.story.");
      if (isStory) storyCalls.push(procedure);
      if (hasHeader && !isStory) violations.push(`story header on ${procedure}`);
      if (isStory && !hasHeader) violations.push(`${procedure} without the story header`);
    }
    let inputs = {};
    if (request.method() === "POST") inputs = JSON.parse(request.postData() || "{}");
    else if (url.searchParams.get("input")) inputs = JSON.parse(url.searchParams.get("input"));
    const payload = procedures.map((procedure, i) => ({ result: { data: { json: respond(procedure, inputs[String(i)]?.json) } } }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

await fs.mkdir(outputDir, { recursive: true });
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a preinstalled Chromium when the pinned Playwright has no browser of its own.
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const shots = [];
const errors = [];

async function session(name, viewport, run) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
  await mockTrpc(page);
  const shot = async (file, fullPage = true) => {
    await settle(page);
    await page.screenshot({ path: path.join(outputDir, file), fullPage });
    shots.push(file);
  };
  await run(page, shot);
  await context.close();
}

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

story = "available";
await session("desktop", desktop, async (page, shot) => {
  await page.goto(`${origin}/home`);
  await page.getByTestId("story-home-hero").waitFor();
  await shot("desktop-available.png");
  await page.getByTestId("story-home-play").click();
  await page.getByTestId("story-fixture-game").waitFor();
  await shot("desktop-host-playing.png", false);
  await page.getByTestId("story-fixture-lose").click();
  await page.getByTestId("story-host-lost").waitFor();
  await shot("desktop-host-lost.png", false);
  await page.getByTestId("story-host-retry").click();
  await page.getByTestId("story-fixture-win").click();
  await page.getByTestId("story-host-ended").waitFor();
  await shot("desktop-host-ending.png", false);
  await page.getByTestId("story-host-option-left").click();
  await page.getByTestId("story-host-done").click();
  await page.locator('[data-testid="story-home-hero"][data-state="won_tonight"]').waitFor();
  await shot("desktop-won-tonight.png");
});

story = "available";
await session("phone", phone, async (page, shot) => {
  await page.goto(`${origin}/home`);
  await page.getByTestId("story-home-hero").waitFor();
  await shot("phone-available.png");
});

story = "answered";
await session("phone-won", phone, async (page, shot) => {
  await page.goto(`${origin}/home`);
  await page.locator('[data-testid="story-home-hero"][data-state="won_tonight"]').waitFor();
  await shot("phone-won-tonight.png");
});

story = "complete";
await session("season-complete", desktop, async (page, shot) => {
  await page.goto(`${origin}/home`);
  await page.locator('[data-testid="story-home-hero"][data-state="season_complete"]').waitFor();
  await shot("desktop-season-complete.png", false);
});

story = "off";
let gateOffRendersStoryHome = null;
await session("gate-off", desktop, async (page, shot) => {
  await page.goto(`${origin}/home`);
  await settle(page);
  gateOffRendersStoryHome = (await page.getByTestId("story-home").count()) > 0;
  await shot("desktop-gate-off.png", false);
});

await browser.close();

const report = { outputDir, shots, storyCalls, violations, pageErrors: errors, gateOffRendersStoryHome };
console.log(JSON.stringify(report, null, 2));
if (violations.length || gateOffRendersStoryHome) process.exit(1);
