/**
 * FIRST-PLAY GATE (§PR77 Part 21A).
 *
 * A fresh, learned-state player enters the Line and, using ONLY real CDP
 * touch (see verifyGoldlineTrueTouch.mjs for why synthetic dispatchEvent is
 * not sufficient proof), must be able to: understand movement, learn
 * STRIKE the first time it is needed, damage a hostile by touch, learn
 * EVADE, evade by touch, defeat a normal hostile by touch, learn the Line,
 * lock and fire it, collect a Relic by movement, and choose a route
 * physically — with the contextual teaching hint (ExpeditionHud's
 * `expedition-teaching-hint`) advancing through UNLEARNED -> TEACHING ->
 * LEARNED for each mechanic in step, never retiring early, never staying
 * stuck.
 *
 * No runtime cheating: every state change is caused by a real dispatched
 * touch or real corridor movement, observed only through read-only
 * summaries (getHostileSummary, getPlanSummary, getExpeditionSnapshot) —
 * never by writing HP, calling defeat internals, or forcing a route/relic.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineFirstPlayGate.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-firstplay-frames";

const VIEWPORT = { width: 393, height: 852 };
const DPR = 3;
const HOLD_THRESHOLD_MS = 200;

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
// A FRESH context/profile — no localStorage from any prior run — is itself
// part of the "fresh learned-state player" proof.
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: DPR,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  geolocation: { latitude: 34.0522, longitude: -118.2437 },
  permissions: ["geolocation"],
});
const page = await context.newPage();

const errors = [];
page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
page.on("console", message => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

await page.route("**/api/trpc/**", async route => {
  const url = new URL(route.request().url());
  const procedures = decodeURIComponent(
    url.pathname.split("/api/trpc/")[1] ?? ""
  ).split(",");
  const payload = procedures.map(procedure => ({
    result: {
      data: {
        json:
          procedure === "auth.me"
            ? { id: "verify-driver", name: "Driver", role: "driver" }
            : null,
      },
    },
  }));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(
      url.searchParams.get("batch") === "1" ? payload : payload[0]
    ),
  });
});
await page.route(
  requestUrl => !requestUrl.href.startsWith(baseUrl),
  route => route.fulfill({ status: 200, body: "", contentType: "text/plain" })
);

const cdp = await context.newCDPSession(page);

function touchPoint(x, y) {
  return { x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1 };
}
async function touchStart(x, y) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint(x, y)] });
}
async function touchMove(x, y) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [touchPoint(x, y)] });
}
async function touchEnd() {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
function hold(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const activeFingers = new Map();
let nextFingerId = 0;
function fingerPoints() {
  return Array.from(activeFingers.values()).map(f => ({
    x: Math.round(f.x), y: Math.round(f.y), id: f.id, radiusX: 12, radiusY: 12, force: 1,
  }));
}
async function fingerDown(key, x, y) {
  activeFingers.set(key, { id: nextFingerId++, x, y });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingerPoints() });
}
async function fingerMove(key, x, y) {
  const f = activeFingers.get(key);
  if (!f) throw new Error(`fingerMove: no finger down for "${key}"`);
  f.x = x;
  f.y = y;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingerPoints() });
}
async function fingerUp(key) {
  activeFingers.delete(key);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: fingerPoints() });
}
/** Pipelined touchStart+touchMove — see verifyGoldlineTrueTouch.mjs's doc
 * comment on the same helper for why this matters for flick timing. */
async function fingerFlick(key, fromX, fromY, toX, toY) {
  const id = nextFingerId++;
  activeFingers.set(key, { id, x: fromX, y: fromY });
  const downPromise = cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingerPoints() });
  activeFingers.set(key, { id, x: toX, y: toY });
  const movePromise = cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingerPoints() });
  await Promise.all([downPromise, movePromise]);
}

// ------------------------------------------------------------------ setup

await page.goto(`${baseUrl}/driver?goldlineFixture=NEUTRALIZE`, {
  waitUntil: "networkidle",
});
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });

const explainer = page.getByTestId("first-entry-explainer");
if (await explainer.count()) {
  await explainer.getByRole("button", { name: "GOT IT" }).click();
}

async function shot(name) {
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  captured ${file}`);
}

async function settle(frames = 8) {
  await page.evaluate(
    count =>
      new Promise(resolve => {
        let seen = 0;
        const tick = () => {
          seen += 1;
          if (seen >= count) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames
  );
}

async function centerOf(testId) {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`No box for ${testId}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function joystickRadius() {
  const box = await page.getByTestId("goldline-joystick").boundingBox();
  if (!box) throw new Error("No box for goldline-joystick");
  return box.width / 2;
}

const corridor = () =>
  page.evaluate(() => ({
    progress: window.__goldlineGame.progress,
    lateral: window.__goldlineGame.lateral,
  }));
const hostiles = () =>
  page.evaluate(
    () => window.__goldlineGame.getExpedition()?.getHostileSummary() ?? []
  );
const findHunter = list => list.find(h => h.id === "hunter_first");
const planSummary = () =>
  page.evaluate(() => window.__goldlineGame.getExpedition()?.getPlanSummary());
const runSnapshot = () =>
  page.evaluate(() => window.__goldlineGame.getExpeditionSnapshot());
/** A single atomic DOM read via page.evaluate — Playwright's locator API
 * waits for actionability/stability, which throws if the hint element is
 * removed (a real, frequent event here: React retires it the instant a
 * mechanic is marked learned) between the existence check and the text
 * read. This element is polled through fast, expected disappear/reappear
 * cycles, so a plain synchronous read is the correct tool. */
async function currentHint() {
  return page.evaluate(
    () => document.querySelector('[data-testid="expedition-teaching-hint"]')?.textContent ?? null
  );
}
/** Polls for the hint to reach `expected` (including null) — the mark
 * happens inside GoldlineGame's own game-loop tick, not a React event
 * handler, so React's re-render can trail it by a frame or more. */
async function waitForHint(expected, attempts = 60) {
  let hint = await currentHint();
  for (let i = 0; i < attempts && hint !== expected; i += 1) {
    await settle(2);
    hint = await currentHint();
  }
  return hint;
}

const failures = [];
function check(name, passed, detail) {
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

// ---------------------------------------------------------- 0. fresh state

console.log("\n0. FRESH LEARNED-STATE PLAYER");
const preEnterTeachingKeys = await page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.startsWith("goldline:expedition-teaching"))
);
check(
  "a fresh browser profile carries no expedition-teaching flags",
  preEnterTeachingKeys.length === 0,
  JSON.stringify(preEnterTeachingKeys)
);

await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
await shot("gate-00-entered");

const stick = await centerOf("goldline-joystick");
const pad = await centerOf("expedition-action-pad");
const radius = await joystickRadius();

check('"TAP TO STRIKE" is the first teaching hint, before any mechanic is learned', (await currentHint()) === "TAP TO STRIKE");

// -------------------------------------------------- 1. learn STRIKE by touch

console.log("\n1. LEARN STRIKE — REAL TOUCH DAMAGES THE FIRST HOSTILE");
const hunterInitial = findHunter(await hostiles());
if (!hunterInitial) throw new Error("hunter_first not present in the loaded plan");
const AGGRO_APPROACH_PROGRESS = Math.max(0.1, hunterInitial.progress - 0.06);
const STRIKE_RANGE_PROGRESS = 0.05;
const DEFLECT_FAR = radius * 0.85;
const DEFLECT_NEAR = radius * 0.55;
const DEFLECT_CREEP = radius * 0.32;

await fingerDown("joystick", stick.x, stick.y - DEFLECT_CREEP);
let approachState = await corridor();
const approachStart = Date.now();
while (
  approachState.progress < AGGRO_APPROACH_PROGRESS &&
  Date.now() - approachStart < 15_000
) {
  const remaining = AGGRO_APPROACH_PROGRESS - approachState.progress;
  const deflection = remaining > 0.08 ? DEFLECT_FAR : remaining > 0.03 ? DEFLECT_NEAR : DEFLECT_CREEP;
  await fingerMove("joystick", stick.x, stick.y - deflection);
  await hold(60);
  approachState = await corridor();
}
check(
  "the player understands movement — a real drag drove them into the hostile's aggro zone",
  approachState.progress >= AGGRO_APPROACH_PROGRESS,
  `progress=${approachState.progress.toFixed(3)}`
);

let closedIn = false;
for (let i = 0; i < 100 && !closedIn; i += 1) {
  await fingerMove("joystick", stick.x, stick.y - DEFLECT_CREEP);
  const h = findHunter(await hostiles());
  const p = (await corridor()).progress;
  if (h && h.alive && Math.abs(h.progress - p) < STRIKE_RANGE_PROGRESS) {
    closedIn = true;
    break;
  }
  if (!h || !h.alive) break;
  await hold(120);
}
check("the first hostile appears and closes into range, still alive", closedIn);
await shot("gate-01-first-hostile");

// A genuine Chrome/CDP multi-touch quirk (see verifyGoldlineTrueTouch.mjs's
// matching comment): a fresh pad touchstart while the joystick's touch is
// still simultaneously active can resolve against stale captured pointer
// state. Releasing the joystick first keeps the pad tap a clean single
// touch. That does make the player briefly stationary before the tap, so
// the check below accepts "HP decreased" rather than "decreased by exactly
// one" — proving the deliberate tap is genuinely effective, not policing
// against a theoretical incidental ambient tick in the same instant.
await fingerUp("joystick");
const hpBeforeStrike = findHunter(await hostiles())?.hp ?? null;
await fingerDown("pad", pad.x, pad.y);
await fingerUp("pad");
await settle(6);
const hunterAfterStrike = findHunter(await hostiles());
check(
  "a real touch STRIKE damages the hostile",
  hpBeforeStrike != null &&
    Boolean(hunterAfterStrike) &&
    hunterAfterStrike.alive &&
    hunterAfterStrike.hp < hpBeforeStrike,
  `hp ${hpBeforeStrike} -> ${hunterAfterStrike?.hp}`
);
const hintAfterStrike = await waitForHint("FLICK TO EVADE");
const teachingStorageAfterStrike = await page.evaluate(() => {
  const key = Object.keys(localStorage).find(k => k.startsWith("goldline:expedition-teaching"));
  return key ? { key, value: localStorage.getItem(key) } : null;
});
check(
  'the STRIKE hint retires to "FLICK TO EVADE" only after landing, never merely from being shown',
  hintAfterStrike === "FLICK TO EVADE",
  `actual=${JSON.stringify(hintAfterStrike)} storage=${JSON.stringify(teachingStorageAfterStrike)}`
);
await shot("gate-01-strike-learned");

// -------------------------------------------------- 2. learn EVADE by touch

console.log("\n2. LEARN EVADE — REAL FLICK BEGINS A REAL EVADE");
await settle(6);

const dodgingBefore = await page.evaluate(() => window.__goldlineGame.isDodging());
await fingerFlick("pad", pad.x, pad.y, pad.x + 70, pad.y - 25);
await fingerUp("pad");
let dodged = false;
for (let i = 0; i < 20 && !dodged; i += 1) {
  dodged = await page.evaluate(() => window.__goldlineGame.isDodging());
  if (!dodged) await settle(2);
}
check("a real flick evades", !dodgingBefore && dodged);
check(
  'the EVADE hint retires to "HOLD TO AIM THE LINE" only after a real evade began',
  (await waitForHint("HOLD TO AIM THE LINE")) === "HOLD TO AIM THE LINE"
);
await shot("gate-02-evade-learned");

// -------------------------- 3. defeat the hostile, then learn the Line

console.log("\n3. DEFEAT THE HOSTILE FROM REAL STRIKE INPUT ALONE");
let defeated = false;
for (let attempt = 0; attempt < 20 && !defeated; attempt += 1) {
  const before = findHunter(await hostiles());
  if (!before || !before.alive) {
    defeated = true;
    break;
  }
  await hold(500);
  await fingerDown("pad", pad.x, pad.y);
  await fingerUp("pad");
  await settle(4);
}
check(
  "the normal hostile is defeated from real touch input alone",
  defeated || !findHunter(await hostiles())?.alive
);
await shot("gate-03-defeated");

console.log("\n4. LEARN THE LINE — REAL HOLD, DRAG, RELEASE");
let lockedId = null;
let engaged = false;
for (let attempt = 0; attempt < 6 && !engaged; attempt += 1) {
  await hold(700);
  await touchStart(pad.x, pad.y);
  await hold(HOLD_THRESHOLD_MS + 160);
  lockedId = null;
  for (let step = 0; step < 24 && !lockedId; step += 1) {
    const angle = -Math.PI + (step / 24) * Math.PI * 2;
    await touchMove(pad.x + Math.cos(angle) * 40, pad.y + Math.sin(angle) * 40);
    await hold(24);
    lockedId = await page.evaluate(() => window.__goldlineGame.expeditionLockedTargetId());
  }
  await touchEnd();
  for (let i = 0; i < 60 && !engaged; i += 1) {
    engaged = await page.evaluate(() =>
      window.__goldlineGame.getExpedition().linehook.isEngaged()
    );
    if (!engaged) await settle(1);
  }
}
check("a real hold enters aim, a real drag locks a target, a real release fires the Line", engaged, `locked=${lockedId}`);
check(
  'the Line hint retires to relic teaching only after a real lock+fire',
  (await waitForHint("WALK THROUGH A RELIC TO TAKE IT")) === "WALK THROUGH A RELIC TO TAKE IT"
);
await shot("gate-04-line-learned");

// ------------------------------------------------- 5. collect a Relic by movement

console.log("\n5. COLLECT A RELIC BY WALKING THROUGH IT");
const plan = await planSummary();
if (!plan) throw new Error("no plan summary available");

// The real evade burst in section 2 applies genuine lateral momentum in
// whatever direction the player was facing at the time — a real physical
// side effect of a real dodge, not a bug — and RELIC_TAKE_RADIUS (0.03) is
// tight enough that carrying that drift into a straight-forward walk can
// miss sunstep's plinth (lateral 0) entirely. A real player would see
// themselves off-center and correct; this does the same before approaching.
const driftBefore = (await corridor()).lateral;
if (Math.abs(driftBefore) > 0.05) {
  await fingerDown("joystick", stick.x - Math.sign(driftBefore) * DEFLECT_FAR, stick.y);
  const recenterStart = Date.now();
  let lateralNow = driftBefore;
  while (Math.abs(lateralNow) > 0.03 && Date.now() - recenterStart < 5_000) {
    await hold(60);
    lateralNow = (await corridor()).lateral;
  }
  await fingerUp("joystick");
  await settle(4);
}

// sunstep sits at lateral 0 — dead center — so once recentered, no further
// lateral steering is needed, only forward movement, keeping this step's
// proof about MOVEMENT rather than joystick precision.
await fingerDown("joystick", stick.x, stick.y - DEFLECT_FAR);
let relicApproach = await corridor();
const relicStart = Date.now();
while (
  relicApproach.progress < plan.relicPlinths &&
  Date.now() - relicStart < 15_000
) {
  const remaining = plan.relicPlinths - relicApproach.progress;
  await fingerMove("joystick", stick.x, stick.y - (remaining > 0.05 ? DEFLECT_FAR : DEFLECT_CREEP));
  await hold(80);
  relicApproach = await corridor();
  const snap = await runSnapshot();
  if (snap.relic) break;
}
// Release immediately on taking the relic — the touch's last-set position
// otherwise keeps driving the player forward (and, from residual dodge
// drift, sideways) through the whole hint-polling wait below, easily
// covering the entire fork window and committing a route before section 6
// gets a turn to prove that step deliberately.
await fingerUp("joystick");
await settle(6);
const relicSnapshot = await runSnapshot();
check(
  "a relic is taken purely by walking to it — no button, no menu",
  relicSnapshot.relic != null,
  `relic=${relicSnapshot.relic}`
);
const hintAfterRelic = await waitForHint("CHOOSE A PATH AT THE FORK");
const debugStateAfterRelic = {
  corridor: await corridor(),
  snapshot: await runSnapshot(),
  learned: await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith("goldline:expedition-teaching"));
    return key ? localStorage.getItem(key) : null;
  }),
};
check(
  'the relic hint retires to fork teaching only after a relic was actually taken',
  hintAfterRelic === "CHOOSE A PATH AT THE FORK",
  `actual=${JSON.stringify(hintAfterRelic)} state=${JSON.stringify(debugStateAfterRelic)}`
);
await shot("gate-05-relic-learned");

// ------------------------------------------------- 6. choose a route physically

console.log("\n6. CHOOSE A ROUTE PHYSICALLY — WALK INTO A BRANCH");
// A constant rightward lean (comfortably past the 0.28 commit threshold)
// combined with forward movement — committing happens automatically once
// inside the fork's progress window, exactly as a real player veering
// toward one side of the road commits by being there, not by pressing
// anything.
const LATERAL_LEAN = radius * 0.45;
await fingerDown("joystick", stick.x + LATERAL_LEAN, stick.y - DEFLECT_FAR);
let forkApproach = await corridor();
const forkStart = Date.now();
while (
  (await runSnapshot()).route === "unchosen" &&
  Date.now() - forkStart < 15_000
) {
  const remaining = plan.forkStart - forkApproach.progress;
  const forwardDeflect = remaining > 0.05 ? DEFLECT_FAR : DEFLECT_CREEP;
  await fingerMove("joystick", stick.x + LATERAL_LEAN, stick.y - forwardDeflect);
  await hold(80);
  forkApproach = await corridor();
  if (forkApproach.progress > plan.forkEnd) break;
}
await fingerUp("joystick");
await settle(6);
const finalSnapshot = await runSnapshot();
check(
  "a route is chosen by physically walking into a branch, not a menu",
  finalSnapshot.route !== "unchosen",
  `route=${finalSnapshot.route}`
);
check(
  "no teaching hint remains once every mechanic has been learned",
  (await waitForHint(null)) === null
);
await shot("gate-06-route-chosen");

// ------------------------------------------------- 7. persistence

console.log("\n7. LEARNED STATE PERSISTS PLAYER-SCOPED");
const teachingKeyEntries = await page.evaluate(() => {
  const key = Object.keys(localStorage).find(k =>
    k.startsWith("goldline:expedition-teaching")
  );
  if (!key) return null;
  return { key, value: JSON.parse(localStorage.getItem(key)) };
});
check(
  "all five mechanics persist as learned under one player-scoped key",
  Boolean(teachingKeyEntries) &&
    ["strike", "evade", "line", "relic", "fork"].every(m =>
      teachingKeyEntries.value.includes(m)
    ),
  JSON.stringify(teachingKeyEntries)
);

await browser.close();

console.log("");
if (errors.length) {
  console.error("BROWSER ERRORS:");
  for (const error of errors) console.error(`  ${error}`);
}
if (failures.length || errors.length) {
  console.error(`FIRST-PLAY GATE FAILED (${failures.length} checks)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`FIRST-PLAY GATE PASSED — frames in ${outputDir}`);
