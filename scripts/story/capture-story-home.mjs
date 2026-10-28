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

// Season 0, chapter 1, as server/story/fixtures/season-0.json resolves it, but mounting the monitor desk game.
const GAME_KEY = "cpe.monitor-desk";
// placeholder hours and floors; a real season's live only in its private file
const DESK = { clockStart: "1:00", window: "1:16", windowSeconds: 90, panelFloors: 9, litFloor: 10 };
const chapterOne = {
  number: 1,
  title: "Placeholder chapter one",
  gameKey: GAME_KEY,
  location: "century_park_east",
  anomaly: "lit_floor",
  before: [
    { key: "b1", text: "Placeholder before-line one. Lorem ipsum dolor sit amet.", still: null },
    { key: "b2", text: "Placeholder before-line two. Consectetur adipiscing elit.", still: null },
  ],
};
const closing = { response: "Placeholder response to left.", keepsake: {title:"Placeholder keepsake", text:"Placeholder keepsake description."}, tomorrow:"Placeholder invitation for tomorrow." };
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
  return { ...base, state: "won_tonight", chapter: { ...chapterOne, after, closing: story === "answered" ? closing : undefined, question: question(story === "answered" ? "left" : null) } };
}

function respond(procedure, input) {
  switch (procedure) {
    case "auth.me": return { openId: "visual-test", name: "Admin Preview", email: null, role: "admin" };
    case "system.story.tonight": return tonight();
    case "system.story.start": return { chapterNumber: input?.chapterNumber ?? 1, gameKey: GAME_KEY, config: { location: "century_park_east", anomaly: "lit_floor", desk: DESK } };
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
    const payload = procedures.map((procedure, i) => procedure === "system.geographicTruth.myAtlas" ? { error: { json: { message: "Development atlas fixture", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } } } : ({ result: { data: { json: respond(procedure, inputs[String(i)]?.json) } } }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

// ---------------------------------------------------------------- the monitor desk, driven through its own controls
// (the dev-only hook `window.__storyMonitorDesk` only reads the night and skips its clock ahead)
async function deskReady(page) {
  await page.getByTestId("story-monitor-desk").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => window.__storyMonitorDesk && !document.querySelector(".md-loading"), null, { timeout: 60000 });
  await page.waitForTimeout(600);
}
const desk = (page, fn, arg) => page.evaluate(([source, a]) => new Function("d", "a", `return (${source})(d, a)`)(window.__storyMonitorDesk, a), [fn.toString(), arg]);
const deskJump = (page, pick) => desk(page, (d, src) => d.jump(new Function("s", `return (${src})(s)`)(d.snapshot())), pick.toString());
async function pull(page, cam, touch) {
  if (touch) await page.getByTestId(`story-monitor-cam-${cam}`).tap();
  else await page.keyboard.press(String(cam));
}
/** The first motion alert of the shift, pulled up on the main monitor. */
async function deskRound(page, touch) {
  await deskJump(page, s => s.timeline.alerts[0].at + 1.5);
  const cam = await desk(page, d => d.snapshot().timeline.alerts[0].cam + 1);
  await pull(page, cam, touch);
}
/** The lobby, zoomed and panned onto the lift, while the indicator is lit. */
async function deskOnTheLift(page, touch) {
  await deskJump(page, s => s.timeline.windowStart + 1);
  await pull(page, 1, touch);
  if (touch) {
    await page.getByRole("button", { name: "Zoom in" }).tap();
    await desk(page, d => d.pan(2.5));
  } else {
    await page.keyboard.press("ArrowUp");
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(800);
    await page.keyboard.up("ArrowRight");
  }
  // settle between two of the lobby feed's signal drops
  await deskJump(page, s => s.timeline.drops.find(d => d.at > s.t + 1.6).until + 0.15);
  await page.waitForTimeout(400);
}
/** Waits for the figure, then takes stills until one holds; returns how many it took. */
async function deskWin(page, touch) {
  await deskOnTheLift(page, touch);
  await deskJump(page, s => s.timeline.figure.out - 0.6);
  for (let i = 1; i <= 14; i++) {
    if (touch) await page.getByTestId("story-monitor-still").tap();
    else await page.keyboard.press(" ");
    await page.waitForTimeout(150);
    if (await page.getByTestId("story-monitor-win").count()) return i;
    await page.waitForTimeout(1100);
  }
  violations.push("the monitor desk was never won");
  return null;
}
async function frameTimes(page, label) {
  return page.evaluate(label => new Promise(resolve => {
    const samples = []; let last = performance.now();
    function frame(now) { samples.push(now - last); last = now;
      if (samples.length < 120) requestAnimationFrame(frame);
      else { samples.sort((a, b) => a - b); resolve({ viewport: label, samples: 120, medianMs: samples[60], p95Ms: samples[114], medianFps: 1000 / samples[60] }); }
    } requestAnimationFrame(frame);
  }), label);
}

async function settle(page) {
  // The home's live 3D board refreshes its map data on a timer, so the network is never idle: wait for load instead.
  await page.waitForLoadState("load");
  await page.waitForTimeout(Number(process.env.STORY_HOME_CAPTURE_WAIT_MS || 10000));
}

await fs.mkdir(outputDir, { recursive: true });
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a preinstalled Chromium when the pinned Playwright has no browser of its own.
const browser = await chromium.launch({ args: ["--use-angle=metal"], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const shots = [];
const deskStills = {};
const errors = [];
const frames = [];

async function session(name, viewport, run) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(`${name}: ${error.message}`));
  await mockTrpc(page);
  const capture = async (file, fullPage) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if(overflow) violations.push(`${file}: horizontal page overflow`);
    await page.screenshot({ path: path.join(outputDir, file), fullPage });
    shots.push(file);
  };
  const shot = async (file, fullPage = true) => {
    await settle(page);
    await capture(file, fullPage);
  };
  // a game moment: the page is long settled, and the game's clock must not run on for ten seconds
  const snap = async file => {
    await page.waitForTimeout(500);
    await capture(file, false);
  };
  shot.snap = snap;
  await run(page, shot);
  await context.close();
}

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };
for (const viewport of [{width:1280,height:800}, {width:360,height:740}]) {
  await session(`size-${viewport.width}`, viewport, async(page,shot) => {
    await page.goto(`${origin}/home`);
    await page.getByTestId("story-home-hero").waitFor();
    await shot(`available-${viewport.width}.png`,false);
  });
}

story = "available";
await session("desktop", desktop, async (page, shot) => {
  await page.goto(`${origin}/home`);
  await page.getByTestId("story-home-hero").waitFor();
  await shot("desktop-available.png");
  frames.push(await page.evaluate(() => new Promise(resolve => {
    const samples = []; let last = performance.now();
    function frame(now) { samples.push(now-last);last=now;
      if(samples.length<120) requestAnimationFrame(frame);
      else { samples.sort((a,b)=>a-b);resolve({viewport:"1440x900", samples:120, medianMs:samples[60], p95Ms:samples[114], medianFps:1000/samples[60]}); }
    } requestAnimationFrame(frame);
  })));
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto(`${origin}/home?intro=1`);
  await shot("desktop-reduced-motion.png",false);
  await page.emulateMedia({reducedMotion:"no-preference"});
  await page.getByTestId("story-home-play").click();
  await deskReady(page);
  await shot.snap("desktop-desk-boot.png");
  await deskRound(page, false);
  await shot.snap("desktop-host-playing.png");
  frames.push(await frameTimes(page, "1440x900 monitor desk"));
  await deskOnTheLift(page, false);
  await shot.snap("desktop-desk-lit.png");
  // a loss: the doors shut with no still
  await deskJump(page, s => s.timeline.figure.doorsShut + 1.4);
  await page.getByTestId("story-monitor-lose").waitFor();
  await shot.snap("desktop-desk-no-still.png");
  await page.getByTestId("story-host-lost").waitFor();
  await shot("desktop-host-lost.png", false);
  // the retry starts half a minute before the window
  await page.getByTestId("story-host-retry").click();
  await deskReady(page);
  deskStills.desktop = await deskWin(page, false);
  await shot.snap("desktop-desk-win.png");
  await page.getByTestId("story-host-ended").waitFor();
  await shot("desktop-host-ending.png", false);
  await page.getByTestId("story-host-option-left").click();
  await shot("desktop-host-answered.png", false);
  await page.getByTestId("story-host-done").click();
  await page.locator('[data-testid="story-home-hero"][data-state="won_tonight"]').waitFor();
  await shot("desktop-won-tonight.png");
});

story = "available";
await session("phone", phone, async (page, shot) => {
  await page.goto(`${origin}/home`);
  await page.getByTestId("story-home-hero").waitFor();
  await shot("phone-available.png");
  await page.getByTestId("story-home-play").click();
  await deskReady(page);
  await deskRound(page, true);
  await shot.snap("phone-host-playing.png");
  deskStills.phone = await deskWin(page, true);
  await shot.snap("phone-desk-win.png");
  await page.getByTestId("story-host-ended").waitFor();
  await shot("phone-host-ending.png", false);
  await page.getByTestId("story-host-option-left").tap();
  await page.getByTestId("story-host-closing").waitFor();
  await shot("phone-host-closing.png", false);
});

story = "available";
await session("desk-reduced-motion", desktop, async (page, shot) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${origin}/home`);
  await page.getByTestId("story-home-play").waitFor();
  await page.getByTestId("story-home-play").click();
  await deskReady(page);
  await deskOnTheLift(page, false);
  await shot.snap("desktop-desk-reduced-motion.png");
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

story = "available";
const originalTitle = chapterOne.title;
const originalHook = chapterOne.before[0].text;
chapterOne.title = "Placeholder chapter with an unusually long title for layout verification";
chapterOne.before[0].text = "Placeholder opening text. ".repeat(12);
await session("long-content", phone, async(page,shot) => {
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto(`${origin}/home?intro=1`);
  await page.getByTestId("story-home-hero").waitFor();
  await shot("phone-long-content.png");
  await page.getByTestId("story-home-play").scrollIntoViewIfNeeded();
  await page.getByTestId("story-home-play").click();
  await page.getByTestId("story-monitor-desk").waitFor();
  await page.keyboard.press("Escape");
  if(await page.getByTestId("story-chapter-host").count()) violations.push("Escape did not close the chapter");
});
chapterOne.title = originalTitle;
chapterOne.before[0].text = originalHook;
await browser.close();

const report = { outputDir, shots, storyCalls, frames, deskStills, violations, pageErrors: errors, gateOffRendersStoryHome };
console.log(JSON.stringify(report, null, 2));
if (violations.length || gateOffRendersStoryHome) process.exit(1);
