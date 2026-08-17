/**
 * THE ZERO-ORDER DAY — proven, not asserted in prose.
 *
 * PR #71 made the expedition shell objective-agnostic so an approved Open
 * Channel task can prepare the #70 heartbeat when no Laundry Butler-native
 * pickup exists. Its acceptance criteria shipped as seven bullets in
 * `e2e/goldline/objectiveAgnosticExpedition.contract.md` — prose that
 * nothing executes — plus four unit tests over a pure function that never
 * mount the HUD or press anything.
 *
 * This is that contract, executed against the real runtime with real touch:
 *
 *   1. No native pickup + approved Open Channel task -> ENTER THE LINE
 *   2. The run is the same #70 movement/Linehook/Relic/route heartbeat
 *   3. Arrival does NOT complete the task
 *   4. Only the canonical Open Channel write may resolve it
 *   5. The HUD stays in verification until authoritative state says completed
 *   6. Open Channel completion produces NO pickup Stronghold restoration
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineOpenChannelExpedition.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-openchannel-frames";

const VIEWPORT = { width: 393, height: 852 };

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 3,
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

// The ZERO-ORDER DAY fixture: no pickups, no deliveries, one approved
// Open Channel mission with pending real work.
await page.goto(`${baseUrl}/driver?goldlineFixture=NEUTRALIZE&goldlineOpenChannelDay=1`, {
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
const snapshot = () =>
  page.evaluate(() => window.__goldlineGame.getExpeditionSnapshot());
const progressNow = () => page.evaluate(() => window.__goldlineGame.progress);

async function walkTo(target, { maxMs = 20_000 } = {}) {
  const stick = await centerOf("goldline-joystick");
  await touchStart(stick.x, stick.y);
  const startedAt = Date.now();
  let last = await progressNow();
  let stalled = 0;
  while (Date.now() - startedAt < maxMs) {
    await touchMove(stick.x, stick.y - 46);
    await settle(6);
    const now = await progressNow();
    if (now >= target - 0.004) break;
    stalled = Math.abs(now - last) < 0.0005 ? stalled + 1 : 0;
    if (stalled > 14) break;
    last = now;
  }
  await touchEnd();
  await settle(6);
  return progressNow();
}

// ------------------------------------------ 1. the day has no native work

console.log("\n1. A ZERO-ORDER DAY STILL OFFERS THE LINE");
const threshold = page.getByTestId("expedition-threshold");
await threshold.waitFor({ timeout: 15_000 }).catch(() => {});
check(
  "ENTER THE LINE is offered with no native pickup at all",
  (await page.getByTestId("expedition-enter").count()) > 0
);
const offeredLabel = await page
  .locator(".expedition-threshold__objective")
  .textContent()
  .catch(() => null);
check(
  "the offer names the operator's own real task",
  Boolean(offeredLabel && offeredLabel.toLowerCase().includes("door hanger")),
  offeredLabel
);
await shot("oc-01-threshold");

// ------------------------------------------------- 2. it is the heartbeat

console.log("\n2. IT IS THE SAME #70 HEARTBEAT");
await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
check("the expedition runs", (await snapshot()).outcome === "running");

const plan = await page.evaluate(() => {
  const p = window.__goldlineGame.getExpedition().plan;
  return {
    relic: p.relicPlinths,
    destination: p.destination,
    climax: p.environment.find(e => e.id === "arch_climax_span").progress,
  };
});

// Real touch: a tap must dodge, exactly as in the pickup expedition.
const pad = await centerOf("expedition-action-pad");
await touchStart(pad.x, pad.y);
await new Promise(r => setTimeout(r, 70));
await touchEnd();
let dodged = false;
for (let i = 0; i < 12 && !dodged; i += 1) {
  dodged = await page.evaluate(() => window.__goldlineGame.isDodging());
  if (!dodged) await settle(2);
}
check("ACT still dodges on a non-order objective", dodged);

await walkTo(plan.relic + 0.006);
check(
  "a relic is still taken by walking",
  (await snapshot()).relic != null,
  `relic=${(await snapshot()).relic}`
);
await shot("oc-02-playing");

// ------------------------------------------- 3. arrival completes nothing

console.log("\n3. ARRIVAL DOES NOT COMPLETE THE REAL TASK");
await walkTo(plan.destination);
if ((await snapshot()).outcome !== "arrived") {
  await page.evaluate(() => {
    const layer = window.__goldlineGame.getExpedition();
    const shield = layer.hostiles.find(h => h.id === "shieldbearer_climax");
    if (shield) shield.hp = 0;
  });
  if ((await snapshot()).outcome === "down") {
    await page.getByTestId("expedition-redeploy").click();
    await settle(20);
    await page.evaluate(() => {
      const layer = window.__goldlineGame.getExpedition();
      const shield = layer.hostiles.find(h => h.id === "shieldbearer_climax");
      if (shield) shield.hp = 0;
    });
  }
  await walkTo(plan.destination);
}
await page.getByTestId("expedition-arrived").waitFor({ timeout: 15_000 });
check("the cache is reached on foot", (await snapshot()).outcome === "arrived");
check(
  "arriving did NOT seal the work",
  (await page.getByTestId("cargo-secured").count()) === 0
);
await shot("oc-03-arrived");

// ------------------------- 4/5. only the canonical write may resolve it

console.log("\n4. ONLY THE CANONICAL OPEN CHANNEL WRITE RESOLVES IT");
const completionLabel = await page.getByTestId("secure-cargo").textContent();
check(
  "the completion verb belongs to the objective, not to cargo",
  completionLabel?.trim() === "SEAL THE WORK",
  completionLabel?.trim()
);

const strongholdBefore = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);

await page.getByTestId("secure-cargo").click();
await page.getByTestId("cargo-verifying").waitFor({ timeout: 5_000 });
check(
  "the write returning shows VERIFYING, never WORK SEALED",
  (await page.getByTestId("cargo-secured").count()) === 0
);
await shot("oc-04-verifying");

await page.getByTestId("cargo-secured").waitFor({ timeout: 20_000 });
const sealedLabel = await page.getByTestId("cargo-secured").textContent();
check(
  "WORK SEALED only after authoritative completion",
  sealedLabel?.trim() === "WORK SEALED",
  sealedLabel?.trim()
);
await shot("oc-05-sealed");

// --------------------------- 6. no counterfeit economic progress

console.log("\n5. REAL WORK, NO COUNTERFEIT BUSINESS PROGRESS");
const strongholdAfter = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);
check(
  "Open Channel work lit NO pickup lantern",
  (strongholdAfter?.lanternsLit ?? 0) === (strongholdBefore?.lanternsLit ?? 0),
  `${strongholdBefore?.lanternsLit ?? 0} -> ${strongholdAfter?.lanternsLit ?? 0}`
);
check(
  "Open Channel work created NO collected-order truth",
  (strongholdAfter?.restoredCount ?? 0) === (strongholdBefore?.restoredCount ?? 0),
  `${strongholdBefore?.restoredCount ?? 0} -> ${strongholdAfter?.restoredCount ?? 0}`
);
check(
  "no pickup order was bound to this run",
  (strongholdAfter?.expeditionOrderCollected ?? false) === false
);

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
  console.error(`ZERO-ORDER DAY FAILED (${failures.length} checks)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`ZERO-ORDER DAY PASSED — frames in ${outputDir}`);
