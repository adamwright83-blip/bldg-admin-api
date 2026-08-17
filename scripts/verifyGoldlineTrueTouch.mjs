/**
 * TRUE TOUCH — the controls proven with real touch events, not synthetic ones.
 *
 * Everything else in this repository's browser verification drives the app
 * through Playwright's own high-level actions, which is fine for checking
 * that a button exists and responds. It is NOT sufficient proof for the
 * expedition's two-verb control grammar, because that grammar is decided by
 * things a synthetic `dispatchEvent` does not faithfully reproduce:
 *
 *   - the REAL elapsed time between touchstart and touchend, which is what
 *     separates a dodge from an aim (HOLD_THRESHOLD_MS);
 *   - a continuous stream of touchmove points, which is what turns a hold
 *     into an aim heading and selects a target;
 *   - pointer capture and pointerId identity across a whole gesture.
 *
 * So this drives Chrome DevTools Protocol `Input.dispatchTouchEvent`
 * directly. Those are dispatched by the browser's own input pipeline: they
 * become real PointerEvents with real coalescing, real capture and real
 * timestamps. A test that passes here is testing the thumb.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineTrueTouch.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-truetouch-frames";

/** The phone the brief names, at its real device pixel ratio. */
const VIEWPORT = { width: 393, height: 852 };
const DPR = 3;
/** ExpeditionHud's real hold threshold. */
const HOLD_THRESHOLD_MS = 200;

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

/**
 * A real touch point. CSS pixels — CDP takes viewport coordinates, and the
 * device scale factor is applied by the browser, not by us.
 */
function touchPoint(x, y) {
  return { x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1 };
}

async function touchStart(x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [touchPoint(x, y)],
  });
}

async function touchMove(x, y) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [touchPoint(x, y)],
  });
}

async function touchEnd() {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
}

/** Real wall-clock hold. The threshold is real elapsed time, so this must be. */
function hold(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Drags with a genuine stream of intermediate touchmove points, the way a
 * thumb does. A single jump from start to end would exercise neither the
 * aim heading nor the joystick's continuous input.
 */
async function touchDrag(from, to, steps = 12, msPerStep = 16) {
  await touchStart(from.x, from.y);
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await touchMove(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
    await hold(msPerStep);
  }
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

// Confirm the page really is in touch mode before claiming a touch proof.
const touchEnv = await page.evaluate(() => ({
  maxTouchPoints: navigator.maxTouchPoints,
  hasTouchEvents: "ontouchstart" in window,
  dpr: window.devicePixelRatio,
  width: window.innerWidth,
  height: window.innerHeight,
}));
console.log(`TOUCH ENVIRONMENT: ${JSON.stringify(touchEnv)}`);
if (!touchEnv.hasTouchEvents || touchEnv.maxTouchPoints < 1) {
  throw new Error("Page is not in a touch-capable mode");
}
if (touchEnv.dpr !== DPR) throw new Error(`DPR is ${touchEnv.dpr}, expected ${DPR}`);
if (touchEnv.width !== VIEWPORT.width || touchEnv.height !== VIEWPORT.height) {
  throw new Error(
    `Viewport is ${touchEnv.width}x${touchEnv.height}, expected ` +
      `${VIEWPORT.width}x${VIEWPORT.height}`
  );
}

await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });

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

const corridor = () =>
  page.evaluate(() => ({
    progress: window.__goldlineGame.progress,
    lateral: window.__goldlineGame.lateral,
  }));

const padState = () =>
  page.getByTestId("expedition-action-pad").getAttribute("data-aiming");

const failures = [];
function check(name, passed, detail) {
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

// ------------------------------------------------ 1. joystick drag moves

console.log("\n1. REAL JOYSTICK DRAG MOVES TRAILBLAZER");
const stick = await centerOf("goldline-joystick");
const before = await corridor();

// Push the stick forward (up the corridor) and HOLD it there while the
// runtime integrates real frames — movement is eased, so a drag that
// releases immediately would prove nothing.
await touchDrag(stick, { x: stick.x, y: stick.y - 46 }, 10, 14);
await settle(48);
const during = await corridor();
await touchEnd();
await settle(10);

check(
  "forward drag increases corridor progress",
  during.progress > before.progress,
  `${before.progress.toFixed(4)} -> ${during.progress.toFixed(4)}`
);
await shot("touch-01-joystick-forward");

// Lateral, in the opposite direction, so the test cannot pass on drift.
const beforeLateral = (await corridor()).lateral;
await touchDrag(stick, { x: stick.x + 46, y: stick.y }, 10, 14);
await settle(40);
const afterLateral = (await corridor()).lateral;
await touchEnd();
await settle(10);
check(
  "rightward drag increases lateral",
  afterLateral > beforeLateral,
  `${beforeLateral.toFixed(4)} -> ${afterLateral.toFixed(4)}`
);

// Releasing must actually stop input, not leave the stick stuck on.
const restA = (await corridor()).lateral;
await settle(40);
const restB = (await corridor()).lateral;
check(
  "releasing the stick stops lateral input",
  Math.abs(restB - restA) < 1e-6,
  `${restA.toFixed(4)} -> ${restB.toFixed(4)}`
);

// --------------------------------------------------------- 2. ACT tap = dodge

console.log("\n2. REAL ACT TAP DODGES");
const pad = await centerOf("expedition-action-pad");
const dodgeBefore = await page.evaluate(() =>
  window.__goldlineGame.isDodging()
);
// A tap has to be a TAP. HOLD_THRESHOLD_MS is 200ms of real wall clock, and a
// driver-side `hold(70)` between two CDP round trips can land past that under
// load — the pad then promotes to aim and releasing with no lock correctly
// resolves to cancel. So release immediately, and latch both the dodge and the
// aim state inside the page every frame: the dodge burst is 0.22s and can
// otherwise start and finish between two round trips.
await page.evaluate(() => {
  window.__tapWatch = { dodged: false, aimed: false, frames: 0 };
  const pad = () =>
    document.querySelector('[data-testid="expedition-action-pad"]');
  const watch = () => {
    const w = window.__tapWatch;
    w.frames += 1;
    if (window.__goldlineGame.isDodging()) w.dodged = true;
    if (pad()?.dataset.aiming === "true") w.aimed = true;
    if (!w.dodged) requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
});
await touchStart(pad.x, pad.y);
await touchEnd();
let tapWatch = { dodged: false, aimed: false, frames: 0 };
for (let i = 0; i < 24 && !tapWatch.dodged; i += 1) {
  tapWatch = await page.evaluate(() => window.__tapWatch);
  if (!tapWatch.dodged) await settle(2);
}
check(
  "a short tap starts a dodge",
  !dodgeBefore && tapWatch.dodged,
  tapWatch.dodged
    ? `dodged within ${tapWatch.frames} frames`
    : tapWatch.aimed
      ? "the press became a hold, so cancel was correct — the tap was too slow"
      : `no dodge after ${tapWatch.frames} frames`
);
check("a tap does NOT enter aim", (await padState()) === "false");
await shot("touch-02-dodge");

// ------------------------------------------------------- 3. ACT hold = aim

console.log("\n3. REAL ACT HOLD >200ms ENTERS AIM");
await hold(700); // let the dodge cooldown clear, as a player would
await touchStart(pad.x, pad.y);
await hold(HOLD_THRESHOLD_MS + 160);
const aimingAfterHold = (await padState()) === "true";
check(
  `holding past ${HOLD_THRESHOLD_MS}ms enters aim`,
  aimingAfterHold,
  `data-aiming=${await padState()}`
);
const runtimeAiming = await page.evaluate(() =>
  window.__goldlineGame.getExpedition().isAiming()
);
check("the RUNTIME is aiming, not just the pad", runtimeAiming === true);
await shot("touch-03-aiming");

// ------------------------------------------- 4. drag selects a real target

console.log("\n4. REAL DRAG SELECTS A TARGET");
// Sweep the thumb around the pad. Each touchmove updates the aim heading,
// exactly as a thumb searching for a lock does.
let lockedId = null;
for (let step = 0; step < 24 && !lockedId; step += 1) {
  const angle = -Math.PI + (step / 24) * Math.PI * 2;
  await touchMove(pad.x + Math.cos(angle) * 40, pad.y + Math.sin(angle) * 40);
  await hold(24);
  lockedId = await page.evaluate(() =>
    window.__goldlineGame.expeditionLockedTargetId()
  );
}
check("a real drag locks a Line target", lockedId != null, `locked=${lockedId}`);
await shot("touch-04-locked");

// ------------------------------------------- 5. release fires the Line

console.log("\n5. REAL TOUCH RELEASE FIRES THE LINE");
await touchEnd();
// The cable is engaged for a real flight time; sample across it.
let engaged = false;
for (let i = 0; i < 30 && !engaged; i += 1) {
  engaged = await page.evaluate(() =>
    window.__goldlineGame.getExpedition().linehook.isEngaged()
  );
  if (!engaged) await settle(1);
}
check("releasing the hold fires the Line", engaged);
check("aim ends on release", (await padState()) === "false");
await shot("touch-05-line-fired");

// --------------------------------- 6. an aim released with no lock is NOT a dodge

console.log("\n6. AIM RELEASED WITH NO TARGET RETURNS CLEANLY (§16)");
await hold(900);
// Aim straight backwards, down the corridor, where nothing valid stands.
await touchStart(pad.x, pad.y);
await hold(HOLD_THRESHOLD_MS + 140);
await touchMove(pad.x, pad.y + 60);
await hold(60);
const strayLock = await page.evaluate(() =>
  window.__goldlineGame.expeditionLockedTargetId()
);
await touchEnd();
await settle(4);
const dodgedOnCancel = await page.evaluate(() =>
  window.__goldlineGame.isDodging()
);
check(
  "a cancelled aim does not silently become a dodge",
  strayLock != null || dodgedOnCancel === false,
  `lock=${strayLock} dodging=${dodgedOnCancel}`
);

await browser.close();

console.log("");
if (errors.length) {
  console.error("BROWSER ERRORS:");
  for (const error of errors) console.error(`  ${error}`);
}
if (failures.length || errors.length) {
  console.error(`TRUE TOUCH FAILED (${failures.length} checks)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`TRUE TOUCH PASSED — frames in ${outputDir}`);
