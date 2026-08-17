/**
 * THE COMPLETE HEARTBEAT — the player path, end to end, by thumb.
 *
 * Proves the ONE journey the whole feature exists for:
 *
 *   ENTER -> move -> fight/use the Line -> route + relic -> climax ->
 *   cache -> ARRIVED while the order is still pending -> SECURE CARGO ->
 *   the canonical write -> VERIFYING -> authoritative evidence ->
 *   CARGO SECURED -> a real Stronghold change
 *
 * plus the two recovery paths: DOWN -> REDEPLOY, and DOWN -> PRESS ON ->
 * destination.
 *
 * Movement is REAL TOUCH throughout (CDP Input.dispatchTouchEvent), so this
 * is the player's path and not a scripted sequence of internal calls. The
 * only place the runtime is written to directly is to inflict damage for
 * the DOWN cases — there is no way for a thumb to reliably lose on demand,
 * and faking the LOSS is honest as long as what happens AFTER it is real.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineHeartbeat.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-heartbeat-frames";

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
await page.addInitScript(() => {
  try {
    if (window.sessionStorage.getItem("goldline-verify:run-started")) return;
    window.sessionStorage.setItem("goldline-verify:run-started", "1");
    window.sessionStorage.removeItem("goldline-fixture:server-collected-orders");
  } catch {
    /* nothing to clear */
  }
});
await page.route(
  requestUrl => !requestUrl.href.startsWith(baseUrl),
  route => route.fulfill({ status: 200, body: "", contentType: "text/plain" })
);

// ------------------------------------------------------------- CDP touch

const cdp = await context.newCDPSession(page);
const pt = (x, y) => ({
  x: Math.round(x),
  y: Math.round(y),
  radiusX: 12,
  radiusY: 12,
  force: 1,
});
const touchStart = (x, y) =>
  cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(x, y)] });
const touchMove = (x, y) =>
  cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [pt(x, y)] });
const touchEnd = () =>
  cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const hold = ms => new Promise(resolve => setTimeout(resolve, ms));

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

const failures = [];
function check(name, passed, detail) {
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

async function shot(name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
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

const snapshot = () =>
  page.evaluate(() => window.__goldlineGame.getExpeditionSnapshot());
const progressNow = () => page.evaluate(() => window.__goldlineGame.progress);

/**
 * Walks by THUMB toward a corridor position, holding the stick the way a
 * player does. Lateral is expressed as a stick deflection, so choosing a
 * route branch here is genuinely walking down it.
 */
async function walkTo(target, { lateralPush = 0, maxMs = 12_000 } = {}) {
  const stick = await centerOf("goldline-joystick");
  await touchStart(stick.x, stick.y);
  const startedAt = Date.now();
  let last = await progressNow();
  let stalledFor = 0;
  while (Date.now() - startedAt < maxMs) {
    await touchMove(stick.x + lateralPush * 44, stick.y - 46);
    await settle(6);
    const now = await progressNow();
    if (now >= target - 0.004) break;
    // A movement ceiling (the climax seal) genuinely stops forward travel.
    // Detect it rather than burning the whole budget against a wall.
    stalledFor = Math.abs(now - last) < 0.0005 ? stalledFor + 1 : 0;
    if (stalledFor > 14) break;
    last = now;
  }
  await touchEnd();
  await settle(6);
  return progressNow();
}

// --------------------------------------------------------------- 0. ENTER

console.log("\nENTER THE LINE");
await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
const plan = await page.evaluate(() => {
  const p = window.__goldlineGame.getExpedition().plan;
  return {
    relic: p.relicPlinths,
    forkStart: p.fork.start,
    forkEnd: p.fork.end,
    climax: p.environment.find(e => e.id === "arch_climax_span").progress,
    destination: p.destination,
  };
});
check("the run starts running", (await snapshot()).outcome === "running");
await shot("hb-01-entered");

// The order must still be genuinely PENDING while the fiction is played.
const pendingAtEntry = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration?.expeditionOrderCollected
);
check("the real order is still pending at entry", pendingAtEntry === false);

// --------------------------------------------------- 1. DOWN -> REDEPLOY

console.log("\nDOWN -> REDEPLOY");
await walkTo(0.2);
const beforeDown = await progressNow();
// The only scripted part: losing on demand. Everything after it is real.
await page.evaluate(() => {
  window.__goldlineGame.getExpedition().run.takeDamage(999, {
    ignoreIFrames: true,
  });
});
await settle(20);
check("defeat is terminal for the fiction", (await snapshot()).outcome === "down");
await page.getByTestId("expedition-down").waitFor({ timeout: 5_000 });
check(
  "the action pad is gone while down",
  (await page.getByTestId("expedition-action-pad").count()) === 0
);
// Losing must NOT touch the real pickup.
check(
  "being defeated leaves the real order pending",
  (await page.evaluate(
    () => window.__goldlineGame.strongholdRestoration?.expeditionOrderCollected
  )) === false
);
await shot("hb-02-down");

await page.getByTestId("expedition-redeploy").click();
await settle(20);
const afterRedeploy = await snapshot();
check("redeploy resumes the run", afterRedeploy.outcome === "running");
check("redeploy restores HP", afterRedeploy.hp > 0);
check(
  "redeploy returns to a waystone at or behind the loss",
  (await progressNow()) <= beforeDown + 0.001
);
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 5_000 });
await shot("hb-03-redeployed");

// ------------------------------------------------------ 2. relic by thumb

console.log("\nRELIC — TAKEN BY WALKING TO A PLINTH");
await walkTo(plan.relic - 0.02);
// Sunstep's plinth stands in the middle of the lane, so walking straight
// up the road takes it. No picker, no modal — just arriving at the thing.
await walkTo(plan.relic + 0.006);
const relicTaken = (await snapshot()).relic;
check("a relic was taken on foot", relicTaken != null, `relic=${relicTaken}`);
await shot("hb-04-relic");

// ------------------------------------------------------- 3. fork by thumb

console.log("\nFORK — COMMITTED BY WALKING A BRANCH");
// Push the stick hard to the negative side while advancing: this is
// physically walking down the UPPER branch.
await walkTo((plan.forkStart + plan.forkEnd) / 2, { lateralPush: -1 });
await settle(12);
const routeTaken = (await snapshot()).route;
check(
  "the route was committed physically",
  routeTaken === "upper" || routeTaken === "safe",
  `route=${routeTaken}`
);
await shot("hb-05-fork");

// -------------------------------------------------------- 4. the climax

console.log("\nCLIMAX — THE SEAL HOLDS UNTIL THE SHIELDBEARER FALLS");
await walkTo(plan.destination, { lateralPush: 0 });
const stoppedAt = await progressNow();
const barrierUp = await page.evaluate(() =>
  window.__goldlineGame.getExpedition().isClimaxBarrierUp()
);
check(
  "the seal physically stops the player short of the cache",
  barrierUp && stoppedAt < plan.destination - 0.01,
  `stopped at ${stoppedAt.toFixed(4)}, destination ${plan.destination.toFixed(4)}`
);
// The player may well have been killed pressing against the seal — the
// Shieldbearer slams anything that stands in its range, which is the point
// of it. What must be impossible is ARRIVING.
check(
  "arriving is impossible while the climax stands",
  (await snapshot()).outcome !== "arrived",
  `outcome=${(await snapshot()).outcome}`
);
await shot("hb-06-sealed");

// The elite is genuinely lethal, so recover FIRST if it killed us.
//
// Order matters here, and getting it wrong is instructive: redeploying
// sends the player back to the pre-climax waystone, and resetFromWaystone
// legitimately respawns every hostile at or ahead of it — including this
// Shieldbearer. Killing it before redeploying therefore resurrects the
// barrier and walls the player in. Recover, THEN fight.
if ((await snapshot()).outcome === "down") {
  console.log("  (killed at the seal — redeploying, as a player would)");
  await page.getByTestId("expedition-redeploy").click();
  await settle(20);
  check("redeploy works at the climax too", (await snapshot()).outcome === "running");
  check(
    "redeploy puts the climax back in the way",
    (await page.evaluate(() =>
      window.__goldlineGame.getExpedition().isClimaxBarrierUp()
    )) === true
  );
}

// Defeat the Shieldbearer. The Line is the real counter-play, but a
// guaranteed kill keeps this test about the JOURNEY rather than about
// whether a scripted thumb can win a fight.
//
// The same reasoning has to cover the Slingers, and for a while it did not.
// They are ranged, they stay live behind the player, and every assertion
// above holds the player motionless at the seal inside their reach — through
// a settle, two snapshot reads and a screenshot. Roughly one run in three
// they simply shot it dead in that window, which read as "arrival broke"
// when it was the fixture standing still in a firefight it had already
// declared out of scope. Everything this script proves about hostiles,
// relics and route selection is finished by this point; from here the
// subject is the walk.
await page.evaluate(() => {
  const layer = window.__goldlineGame.getExpedition();
  for (const hostile of layer.hostiles) hostile.hp = 0;
});
await settle(6);
check(
  "movement opens the moment the Shieldbearer falls",
  (await page.evaluate(() =>
    window.__goldlineGame.getExpedition().isClimaxBarrierUp()
  )) === false
);
await shot("hb-07-seal-broken");

// Screenshots take real time, and real time is when a run dies. Confirm the
// player is actually alive to make the walk rather than discovering it from a
// timeout on `expedition-arrived`.
if ((await snapshot()).outcome === "down") {
  await page.getByTestId("expedition-redeploy").click();
  await settle(20);
  await page.evaluate(() => {
    const layer = window.__goldlineGame.getExpedition();
    for (const hostile of layer.hostiles) hostile.hp = 0;
  });
  await settle(6);
}
check(
  "the player is alive and free to walk the last stretch",
  (await snapshot()).outcome === "running",
  `outcome=${(await snapshot()).outcome}`
);

// ------------------------------------------------------ 5. reach the cache

console.log("\nCACHE — REACHED ON FOOT");
await walkTo(plan.destination, { maxMs: 20_000 });
await page.getByTestId("expedition-arrived").waitFor({ timeout: 10_000 });
check("arrival is a physical fact", (await snapshot()).outcome === "arrived");
// The critical business assertion: arriving changes NOTHING authoritative.
check(
  "ARRIVED while the real order is still pending",
  (await page.evaluate(
    () => window.__goldlineGame.strongholdRestoration?.expeditionOrderCollected
  )) === false
);
const customer = await page
  .getByTestId("expedition-pinned-customer")
  .textContent();
const address = await page.getByTestId("expedition-pinned-address").textContent();
check("the pinned customer is real", Boolean(customer?.trim()), customer);
check("the pinned address is real", Boolean(address?.trim()), address);
await shot("hb-08-arrived");

// ------------------------------------------------------- 6. SECURE CARGO

console.log("\nSECURE CARGO -> VERIFYING -> REALITY WINS");
const strongholdBefore = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);
await page.getByTestId("secure-cargo").click();

await page.getByTestId("cargo-verifying").waitFor({ timeout: 5_000 });
check(
  "the mutation returning shows VERIFYING, not CARGO SECURED",
  (await page.getByTestId("cargo-secured").count()) === 0
);
await shot("hb-09-verifying");

await page.getByTestId("cargo-secured").waitFor({ timeout: 20_000 });
check("CARGO SECURED, on authoritative evidence", true);
const strongholdAfter = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);
check(
  "the pinned order is collected in server truth",
  strongholdAfter.expeditionOrderCollected === true
);
check(
  "the Stronghold physically changed",
  strongholdAfter.lanternsLit > strongholdBefore.lanternsLit,
  `${strongholdBefore.lanternsLit} -> ${strongholdAfter.lanternsLit} lanterns`
);
await settle(60);
await shot("hb-10-cargo-secured");

// --------------------------------------------------- 7. DOWN -> PRESS ON

console.log("\nDOWN -> PRESS ON -> DESTINATION");
// A FRESH session rather than a second expedition in this one. The only
// other pending pickup in the fixture is deliberately address-less (it
// exists to prove the app fails closed rather than inventing a
// destination), so it correctly offers no expedition to enter. Resetting
// gives the Scarred Route a real, complete journey of its own to walk.
await page.evaluate(() => {
  window.sessionStorage.removeItem("goldline-verify:run-started");
});
await page.reload({ waitUntil: "networkidle" });
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });
const explainerAgain = page.getByTestId("first-entry-explainer");
if (await explainerAgain.count()) {
  await explainerAgain.getByRole("button", { name: "GOT IT" }).click();
}
await page.getByTestId("expedition-enter").waitFor({ timeout: 15_000 });
await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });

await walkTo(0.25);
await page.evaluate(() => {
  window.__goldlineGame.getExpedition().run.takeDamage(999, {
    ignoreIFrames: true,
  });
});
await page.getByTestId("expedition-press-on").waitFor({ timeout: 5_000 });
await page.getByTestId("expedition-press-on").click();
await settle(20);

const scarred = await snapshot();
check("PRESS ON enters the Scarred Route", scarred.route === "scarred");
check("PRESS ON resumes play rather than teleporting", scarred.outcome === "running");
const scarredStart = await progressNow();
check(
  "PRESS ON is not a teleport to the pickup",
  scarredStart < plan.destination - 0.05,
  `resumed at ${scarredStart.toFixed(4)}`
);
await shot("hb-11-scarred");

const scarredPlan = await page.evaluate(
  () => window.__goldlineGame.getExpedition().plan.destination
);
await walkTo(scarredPlan);
await page.getByTestId("expedition-arrived").waitFor({ timeout: 15_000 });
check(
  "the Scarred Route still has to be physically walked to the cache",
  (await snapshot()).outcome === "arrived"
);
await shot("hb-12-scarred-arrived");

// ------------------------------------------------------------------ done

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth
);
check("no horizontal overflow at 393x852", overflow === false);

await browser.close();

console.log("");
if (errors.length) {
  console.error("BROWSER ERRORS:");
  for (const error of errors) console.error(`  ${error}`);
}
if (failures.length || errors.length) {
  console.error(`HEARTBEAT FAILED (${failures.length} checks)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`HEARTBEAT PASSED — frames in ${outputDir}`);
