import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Screenshots of /claire from the visual-test build, with tRPC mocked. Nothing here is real: no database, no customers,
 * placeholder story lines (Season 0 style) and sample business numbers.
 *
 *   VITE_ADMIN_VISUAL_TEST=1 npx vite --host 127.0.0.1 --port 5178 --strictPort
 *   node scripts/capture-claire-desk.mjs
 *
 * Images go to $CLAIRE_DESK_CAPTURE_DIR (default: a temp folder), never into the repository. The run fails on a page
 * error, a horizontal overflow, or a story request that leaves the story namespace.
 */

const origin = process.env.CLAIRE_DESK_ORIGIN || "http://127.0.0.1:5178";
const outputDir = process.env.CLAIRE_DESK_CAPTURE_DIR || path.join(os.tmpdir(), "claire-desk-captures");
const STORY_HEADER = "x-joystick-story";

const chapterOne = {
  number: 1,
  title: "Placeholder chapter one",
  gameKey: "cpe.monitor-desk",
  location: "century_park_east",
  anomaly: "lit_floor",
  before: [
    { key: "b1", text: "Placeholder hook line, read from the story source.", still: null },
    { key: "b2", text: "Placeholder note line.", still: null },
  ],
};

const metric = (value, previous, precision = "exact") => ({
  value,
  previous,
  changePct: value == null || previous == null || previous === 0 ? null : Math.round(((value - previous) / previous) * 1000) / 10,
  precision: value == null ? "unavailable" : precision,
});
// Sample numbers only.
const snapshot = {
  generatedAt: "2026-10-28T03:00:00.000Z", timeZone: "America/Los_Angeles", today: "2026-10-27", monthName: "October", city: "Los Angeles",
  week: { key: "week", label: "Week to date", start: "2026-10-26", end: "2026-10-27", comparison: { start: "2026-10-19", end: "2026-10-20", label: "the same days last week" }, revenueCents: metric(48200, 41000), orders: metric(9, 8), newCustomers: metric(null, null) },
  month: { key: "month", label: "Month to date", start: "2026-10-01", end: "2026-10-27", comparison: { start: "2026-09-01", end: "2026-09-27", label: "the same days last month" }, revenueCents: metric(612400, 655000, "recorded"), orders: metric(118, 121), newCustomers: metric(null, null) },
};

const desk = (status = "awaiting_approval") => ({
  timeZone: "America/Los_Angeles",
  businessDate: "2026-10-27",
  tomorrow: "2026-10-28",
  tomorrowLabel: "Wednesday, October 28",
  objective: "Placeholder objective",
  area: "Sample area",
  territoryId: null,
  items: [
    { id: "i1", date: "2026-10-27", title: "Placeholder mission", objective: "Placeholder mission objective.", status, when: "6:00 PM" },
    { id: "i2", date: "2026-10-28", title: "Placeholder second mission", objective: "Placeholder.", status: status === "needs_reschedule" ? "completed" : "awaiting_approval", when: null },
  ],
  pendingApproval: { proposalId: "p1", revision: "r1", itemIds: ["i1", "i2"], expiresAt: null },
  preparation: { planned: ["Placeholder preparation"], saved: [] },
  uncertain: [],
  adaptations: [],
  heard: [],
  promised: [],
  rationale: {
    diagnosis: "Placeholder diagnosis from stored evidence.",
    approach: "Placeholder approach.",
    evidence: [{ id: "e1", source: "analyzeBusinessData", description: "Placeholder evidence", classification: "observed_fact", value: "sample" }],
    completionCondition: "Placeholder completion condition.",
  },
  winBack: null,
  tomorrowConfirmedAt: null,
  outcomes: [],
  recentChange: null,
  dailyCalls: null,
});

let missionStatus = "awaiting_approval";
let storyMode = "available";
function tonight() {
  if (storyMode === "off") return { enabled: false };
  const base = { enabled: true, seasonTitle: "Season 0 (placeholder)", chapterCount: 3, daysAway: 0 };
  if (storyMode === "complete") return { ...base, state: "season_complete", chapter: null };
  return { ...base, state: "available", chapter: chapterOne };
}

function respond(procedure) {
  switch (procedure) {
    case "auth.me": return { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" };
    case "system.story.tonight": return tonight();
    case "system.accountSnapshot.get": return snapshot;
    case "system.weeklyMission.deskMission": return desk(missionStatus);
    case "system.weeklyMission.deskComms": return { speak: "Placeholder reply from Claire.", heard: null, saved: [], awaitingApproval: null, end: false, transcriptionFailed: false, speechUrl: null };
    default:
      if (/\.count|count[A-Z]/.test(procedure)) return 0;
      if (/\.list|list[A-Z]|search[A-Z]/.test(procedure)) return [];
      return null;
  }
}

const violations = [];
async function mockTrpc(page) {
  await page.route("**/api/trpc/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const procedures = decodeURIComponent(url.pathname.split("/api/trpc/")[1] || "").split(",").filter(Boolean);
    const hasHeader = Object.prototype.hasOwnProperty.call(request.headers(), STORY_HEADER);
    for (const procedure of procedures) {
      const isStory = procedure.startsWith("system.story.");
      if (hasHeader && !isStory) violations.push(`story header on ${procedure}`);
      if (isStory && !hasHeader) violations.push(`${procedure} without the story header`);
    }
    const payload = procedures.map(procedure => ({ result: { data: { json: respond(procedure) } } }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

await fs.mkdir(outputDir, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const errors = [];
const shots = [];

async function session(name, viewport, run) {
  const mobile = viewport.width < 500;
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
  await mockTrpc(page);
  const shot = async (file, fullPage = false) => {
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() => {
      const root = document.querySelector(".cd-root");
      return document.documentElement.scrollWidth > innerWidth || (root ? root.scrollWidth > root.clientWidth : false);
    });
    if (overflow) violations.push(`${file}: horizontal overflow`);
    await page.screenshot({ path: path.join(outputDir, file), fullPage });
    shots.push(file);
  };
  await run(page, shot);
  await context.close();
}

const open = async page => {
  await page.goto(`${origin}/claire`, { waitUntil: "load" });
  await page.getByTestId("claire-desk-says").waitFor({ timeout: 60000 });
};

await session("desktop", { width: 1440, height: 900 }, async (page, shot) => {
  await open(page);
  await shot("desktop-1440x900.png");
  await page.getByTestId("claire-desk-why-toggle").click();
  await shot("desktop-why.png");
  await page.getByTestId("claire-desk-why-toggle").click();
  await page.getByTestId("open-comms-input").fill("Placeholder typed turn.");
  await page.getByTestId("open-comms-input").press("Enter");
  await page.getByTestId("open-comms-log").waitFor();
  await shot("desktop-comms.png");
  await page.getByTestId("claire-desk-drawer-open").click();
  await page.getByTestId("claire-desk-runway").waitFor();
  await shot("desktop-drawer.png");
  await page.keyboard.press("Escape");
  if (await page.getByTestId("claire-desk-drawer").isVisible()) violations.push("Esc did not close the drawer");
  storyMode = "off";
  missionStatus = "needs_reschedule";
  await open(page);
  await shot("desktop-no-story-reschedule.png");
});

await session("phone", { width: 390, height: 844 }, async (page, shot) => {
  storyMode = "available";
  missionStatus = "awaiting_approval";
  await open(page);
  await shot("phone-390x844.png");
  await page.locator(".cd-root").evaluate(root => root.scrollTo(0, root.scrollHeight));
  await shot("phone-390x844-dock.png");
});

await browser.close();
console.log(JSON.stringify({ outputDir, shots, errors, violations }, null, 2));
if (errors.length || violations.length) process.exitCode = 1;
