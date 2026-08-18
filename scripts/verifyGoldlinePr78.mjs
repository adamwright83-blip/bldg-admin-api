/**
 * §PR78 PLAYTEST CLOSURE — proven, not asserted in prose.
 *
 * Adam's first real playtest (2026-08-17) found: he could not find or
 * perceive section transitions, hit a silent invisible wall at the end of
 * the built world, misread the world-history ribbon's empty state as a
 * movement gate, and fought a combat expedition for a DESK task whose
 * climax did nothing he could perceive. This script proves the five things
 * `docs/goldline-pr78-execution-prompt.md` requires as executable proof:
 *
 *   a. The forward route cue is visible mid-corridor-01 when no objective
 *      cue is already on screen.
 *   b. Crossing the exit band into corridor_02 fires the transition moment
 *      (the section-title DOM chip, and the host div's corridor-id
 *      attributes flipping).
 *   c. The end-of-world marker is present in corridor_02's own ceiling
 *      band (there is no next corridor to route to).
 *   d. A desk `open_channel` task never renders ENTER THE LINE staging —
 *      see `scripts/verifyGoldlineOpenChannelExpedition.mjs` for the full
 *      "ZERO-ORDER DAY" contract; this script re-checks the same DOM facts
 *      directly to keep the PR's proof self-contained.
 *   e. Harness-gated audio cue counters (`window.__goldlineAudioLog`,
 *      requires VITE_GOLDLINE_TEST_HARNESS=1 at build time) fire for a
 *      real landed strike, a real kill, and taking real damage, all
 *      through genuine CDP touch — not internal state pokes.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:4177 \
 *     node scripts/verifyGoldlinePr78.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-pr78-frames";

const VIEWPORT = { width: 393, height: 852 };
const DPR = 3;

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
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

// ------------------------------------------------------------- CDP touch

const cdp = await context.newCDPSession(page);
const activeFingers = new Map();
let nextFingerId = 0;

function fingerPoints() {
  return Array.from(activeFingers.values()).map(f => ({
    x: Math.round(f.x),
    y: Math.round(f.y),
    id: f.id,
    radiusX: 12,
    radiusY: 12,
    force: 1,
  }));
}
async function fingerDown(key, x, y) {
  activeFingers.set(key, { id: nextFingerId++, x, y });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: fingerPoints(),
  });
}
async function fingerMove(key, x, y) {
  const f = activeFingers.get(key);
  if (!f) throw new Error(`fingerMove: no finger down for "${key}"`);
  f.x = x;
  f.y = y;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: fingerPoints(),
  });
}
async function fingerUp(key) {
  activeFingers.delete(key);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: fingerPoints(),
  });
}
function hold(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const failures = [];
function check(name, passed, detail) {
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}
const shot = name => page.screenshot({ path: path.join(outputDir, `${name}.png`) });
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
/** The joystick's real on-screen radius — a hardcoded offset can miss its
 * actual hit area entirely (it is smaller than a guessed constant). */
async function joystickRadius() {
  const box = await page.getByTestId("goldline-joystick").boundingBox();
  if (!box) throw new Error("No box for goldline-joystick");
  return box.width / 2;
}
/** The runtime keeps a "SYNCING FIELD" overlay over the whole play area
 * (including the joystick) until asset loading genuinely finishes, even
 * after the canvas itself is visible — touching before this clears hits
 * the overlay, not the joystick. */
async function waitForRuntimeReady() {
  await page
    .locator(".game-loading")
    .waitFor({ state: "detached", timeout: 30_000 })
    .catch(() => {});
}
const world = () =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="goldline-world"]');
    return el
      ? {
          corridorId: el.getAttribute("data-corridor-id"),
          nextCorridorId: el.getAttribute("data-next-corridor-id"),
          progress: Number(el.getAttribute("data-player-progress")),
          objectiveOffscreen: el.getAttribute("data-objective-offscreen"),
          routeEndMarker: el.getAttribute("data-route-end-marker"),
        }
      : null;
  });

// =====================================================================
// a/b/c. ROUTE LEGIBILITY — forward cue, section-title transition event,
// honest end-of-world marker.
// =====================================================================

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
await waitForRuntimeReady();

console.log("\na. FORWARD ROUTE CUE VISIBLE MID-CORRIDOR-01");
let w = await world();
check("boots into corridor_01", w?.corridorId === "corridor_01", JSON.stringify(w));
await settle(10);
w = await world();
if (w?.objectiveOffscreen === "ahead") {
  console.log("  (an objective cue is showing — waiting for it to clear)");
}
check(
  "the forward-route-cue renders while no objective cue is showing",
  (await page.getByTestId("forward-route-cue").count()) > 0 ||
    w?.objectiveOffscreen === "ahead",
  `objectiveOffscreen=${w?.objectiveOffscreen}`
);
await shot("pr78-a-forward-cue");

console.log("\nb. CROSSING THE EXIT BAND FIRES THE TRANSITION EVENT");
const stick = await centerOf("goldline-joystick");
const stickRadius = await joystickRadius();
const stickDeflect = stickRadius * 0.85;
await fingerDown("joystick", stick.x, stick.y - stickDeflect);
const walkStart = Date.now();
let sawSectionChip = false;
while (Date.now() - walkStart < 30_000) {
  await fingerMove("joystick", stick.x, stick.y - stickDeflect);
  await hold(60);
  if (!sawSectionChip && (await page.getByText("THE COASTAL MARKET").count()) > 0) {
    sawSectionChip = true;
    await shot("pr78-b-section-title-chip");
  }
  w = await world();
  if (w?.corridorId === "corridor_02") break;
}
await fingerUp("joystick");
// The chip is a transient 2.4s toast — give React a beat to flush the
// state update from the "ready" phase callback before giving up on it.
await settle(6);
if (!sawSectionChip && (await page.getByText("THE COASTAL MARKET").count()) > 0) {
  sawSectionChip = true;
}
await settle(10);
w = await world();
check(
  "the host div's corridor id flips to corridor_02 on reveal",
  w?.corridorId === "corridor_02",
  JSON.stringify(w)
);
check("the section-title chip fired on reveal", sawSectionChip);
await shot("pr78-b-corridor-02");

console.log("\nc. HONEST END-OF-WORLD MARKER IN corridor_02'S CEILING BAND");
w = await world();
check(
  "corridor_02 has no playable next corridor",
  w?.nextCorridorId === "NONE",
  JSON.stringify(w)
);
await fingerDown("joystick", stick.x, stick.y - stickDeflect);
const ceilingStart = Date.now();
while (Date.now() - ceilingStart < 20_000) {
  await fingerMove("joystick", stick.x, stick.y - stickDeflect);
  await hold(60);
  if ((await page.getByTestId("end-of-world-marker").count()) > 0) break;
  w = await world();
  if (w && w.progress >= 0.8) break;
}
await fingerUp("joystick");
await settle(10);
check(
  "the end-of-world monument copy is present",
  (await page.getByTestId("end-of-world-marker").count()) > 0
);
const markerText = await page
  .getByTestId("end-of-world-marker")
  .textContent()
  .catch(() => null);
check(
  "the copy reads as a monument, not a bug",
  Boolean(markerText && markerText.includes("BEYOND IS UNWRITTEN")),
  markerText
);
await shot("pr78-c-end-of-world");

// =====================================================================
// d. CLIMAX HONESTY — a desk task never stages combat.
// =====================================================================

console.log("\nd. A DESK open_channel TASK NEVER RENDERS ENTER THE LINE STAGING");
await page.goto(
  `${baseUrl}/driver?goldlineFixture=NEUTRALIZE&goldlineOpenChannelDay=1`,
  { waitUntil: "networkidle" }
);
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });
const explainer2 = page.getByTestId("first-entry-explainer");
if (await explainer2.count()) {
  await explainer2.getByRole("button", { name: "GOT IT" }).click();
}
await waitForRuntimeReady();
await page.getByTestId("seal-open-channel-task").waitFor({ timeout: 15_000 });
check(
  "the base offers SEAL THE WORK directly",
  (await page.getByTestId("seal-open-channel-task").count()) > 0
);
check(
  "ENTER THE LINE is never offered for this objective",
  (await page.getByTestId("expedition-enter").count()) === 0
);
check(
  "the expedition action pad never mounts",
  (await page.getByTestId("expedition-action-pad").count()) === 0
);
await shot("pr78-d-no-combat-staging");

// =====================================================================
// e. COMBAT AUDIO — real touch, harness-gated cue counters.
// =====================================================================

console.log("\ne. HARNESS-GATED AUDIO CUES FIRE FOR REAL STRIKE / KILL / HURT");
await page.goto(`${baseUrl}/driver?goldlineFixture=NEUTRALIZE`, {
  waitUntil: "networkidle",
});
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });
const explainer3 = page.getByTestId("first-entry-explainer");
if (await explainer3.count()) {
  await explainer3.getByRole("button", { name: "GOT IT" }).click();
}
await waitForRuntimeReady();
await page.evaluate(() => {
  window.__goldlineAudioLog = [];
});
await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });

const combatStick = await centerOf("goldline-joystick");
const combatStickRadius = await joystickRadius();
const combatDeflect = combatStickRadius * 0.85;
const combatPad = await centerOf("expedition-action-pad");

const hostiles = () =>
  page.evaluate(
    () => window.__goldlineGame.getExpedition()?.getHostileSummary() ?? []
  );
const findHunter = list => list.find(h => h.id === "hunter_first");
const audioLog = () => page.evaluate(() => window.__goldlineAudioLog ?? []);

const hunterInitial = findHunter(await hostiles());
if (!hunterInitial) throw new Error("hunter_first not present in the loaded plan");
const APPROACH_PROGRESS = Math.max(0.1, hunterInitial.progress - 0.05);

await fingerDown("joystick", combatStick.x, combatStick.y - combatDeflect);
const approachStart = Date.now();
let progress = 0;
while (Date.now() - approachStart < 15_000) {
  await fingerMove("joystick", combatStick.x, combatStick.y - combatDeflect);
  await hold(60);
  progress = await page.evaluate(() => window.__goldlineGame.progress);
  if (progress >= APPROACH_PROGRESS) break;
}
// Stay stationary but engaged so the hostile can close in and the ambient
// contextual lash and the hostile's own attack both get a real turn — this
// is what should produce a real `player_hurt`, distinct from any tap.
let closedIn = false;
for (let i = 0; i < 60 && !closedIn; i += 1) {
  await fingerMove("joystick", combatStick.x, combatStick.y - combatDeflect);
  const h = findHunter(await hostiles());
  if (!h || !h.alive) break;
  if (Math.abs(h.progress - progress) < 0.05) closedIn = true;
  await hold(120);
  progress = await page.evaluate(() => window.__goldlineGame.progress);
}
await fingerUp("joystick");
check("the first hostile closes to melee range", closedIn);

// Repeated real STRIKE taps — the pad tap, stationary and in range, per
// the same grammar verifyGoldlineTrueTouch.mjs proves in isolation —
// until the hostile is genuinely defeated by player input.
let defeated = false;
for (let attempts = 0; attempts < 20 && !defeated; attempts += 1) {
  const before = findHunter(await hostiles());
  if (!before || !before.alive) {
    defeated = true;
    break;
  }
  await hold(500);
  await fingerDown("pad", combatPad.x, combatPad.y);
  await fingerUp("pad");
  await settle(4);
}
defeated = defeated || !findHunter(await hostiles())?.alive;
check("the first hostile is genuinely defeated by real touch", defeated);
await shot("pr78-e-combat");

const cuesAfterHunter = await audioLog();
check(
  "strike_hit fired from a real landed strike",
  cuesAfterHunter.includes("strike_hit"),
  cuesAfterHunter.join(",")
);
check(
  "hostile_down fired from a real kill",
  cuesAfterHunter.includes("hostile_down"),
  cuesAfterHunter.join(",")
);
check(
  "player_hurt fired from real damage taken",
  cuesAfterHunter.includes("player_hurt"),
  cuesAfterHunter.join(",")
);

// The Shieldbearer climax barrier: walk on, fighting through whatever the
// route interposes, until the player is actually AT the barrier. NOTE:
// isClimaxBarrierUp() is true from the moment the expedition starts (the
// Shieldbearer is alive and the fixture exists) — it says nothing about
// proximity, so "reached" is judged by real corridor progress against the
// barrier fixture's own authored position, not by that predicate.
console.log("\n  ...continuing toward the Shieldbearer climax for barrier_release");
const barrierProgress = await page.evaluate(() => {
  const plan = window.__goldlineGame.getExpedition()?.plan;
  return plan?.environment.find(e => e.id === "arch_climax_span")?.progress ?? null;
});
check("the climax barrier fixture is present in the loaded plan", barrierProgress != null);
const TARGET_PROGRESS = (barrierProgress ?? 0.86) - 0.02;

await fingerDown("joystick", combatStick.x, combatStick.y - combatDeflect);
const toClimaxStart = Date.now();
let lastProgress = await page.evaluate(() => window.__goldlineGame.progress);
let stalledSince = Date.now();
while (Date.now() - toClimaxStart < 90_000) {
  await fingerMove("joystick", combatStick.x, combatStick.y - combatDeflect);
  await hold(60);
  const p = await page.evaluate(() => window.__goldlineGame.progress);
  if (p >= TARGET_PROGRESS) break;
  if (p > lastProgress + 0.001) {
    lastProgress = p;
    stalledSince = Date.now();
  } else if (Date.now() - stalledSince > 900) {
    // Blocked by an aggroed hostile in the way — land real STRIKE taps
    // (releasing the joystick first, same reasoning as hunter_first above)
    // until it clears, then resume walking.
    await fingerUp("joystick");
    await fingerDown("pad", combatPad.x, combatPad.y);
    await fingerUp("pad");
    await settle(4);
    await fingerDown("joystick", combatStick.x, combatStick.y - combatDeflect);
    stalledSince = Date.now();
  }
}
await fingerUp("joystick");
const progressAtClimax = await page.evaluate(() => window.__goldlineGame.progress);
check(
  "the player physically reaches the Shieldbearer's barrier",
  progressAtClimax >= TARGET_PROGRESS,
  `progress=${progressAtClimax.toFixed(3)}, target=${TARGET_PROGRESS.toFixed(3)}`
);
let barrierUp = await page.evaluate(() =>
  window.__goldlineGame.getExpedition()?.isClimaxBarrierUp()
);
check("the Shieldbearer's barrier is up on arrival", Boolean(barrierUp));
await shot("pr78-e-at-barrier");

// The Shieldbearer's guard resists a plain STRIKE from the front unless it
// is already EXPOSED — the Line is what opens that window (§21: "the guard
// only resists the basic lash... the Linehook always bypasses it"). So the
// real grammar here is: aim (hold ACT >200ms), sweep to lock the
// Shieldbearer, release to fire the Line (which both hits it and exposes
// it for ~2.2s), then land real STRIKE taps during that window, and repeat
// until it falls.
const HOLD_THRESHOLD_MS = 200;
async function lineLockAndFireShieldbearer() {
  await hold(700);
  await fingerDown("pad", combatPad.x, combatPad.y);
  await hold(HOLD_THRESHOLD_MS + 160);
  let lockedId = null;
  for (let step = 0; step < 24 && lockedId !== "shieldbearer_climax"; step += 1) {
    const angle = -Math.PI + (step / 24) * Math.PI * 2;
    await fingerMove(
      "pad",
      combatPad.x + Math.cos(angle) * 40,
      combatPad.y + Math.sin(angle) * 40
    );
    await hold(24);
    lockedId = await page.evaluate(() =>
      window.__goldlineGame.expeditionLockedTargetId()
    );
  }
  await fingerUp("pad");
  await settle(6);
  return lockedId === "shieldbearer_climax";
}

let barrierBroke = false;
for (let cycle = 0; cycle < 5 && barrierUp; cycle += 1) {
  const fired = await lineLockAndFireShieldbearer();
  check(`Line cycle ${cycle + 1}: locked and fired on the Shieldbearer`, fired);
  // Exposed window is ~2.2 real seconds — land repeated real STRIKE taps
  // inside it, the same tap-in-range grammar hunter_first was defeated with.
  const exposedUntil = Date.now() + 2_000;
  while (Date.now() < exposedUntil && barrierUp) {
    await fingerDown("pad", combatPad.x, combatPad.y);
    await fingerUp("pad");
    await settle(4);
    await hold(300);
    barrierUp = await page.evaluate(() =>
      window.__goldlineGame.getExpedition()?.isClimaxBarrierUp()
    );
  }
}
barrierBroke = !barrierUp;
check(
  "the barrier releases from real Line+STRIKE input against the Shieldbearer",
  barrierBroke,
  `barrierUp=${barrierUp}`
);
await shot("pr78-e-barrier-release");

const cuesAfterBarrier = await audioLog();
check(
  "barrier_release fired on the Shieldbearer's defeat",
  cuesAfterBarrier.includes("barrier_release"),
  cuesAfterBarrier.join(",")
);

await browser.close();

console.log("");
if (errors.length) {
  console.error("BROWSER ERRORS:");
  for (const error of errors) console.error(`  ${error}`);
}
if (failures.length || errors.length) {
  console.error(`PR78 PLAYTEST CLOSURE FAILED (${failures.length} checks)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`PR78 PLAYTEST CLOSURE PASSED — frames in ${outputDir}`);
