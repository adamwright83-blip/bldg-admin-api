/**
 * EXTERNALLY-MANAGED WORK — the truth boundary, proven in the real runtime.
 *
 * Miso's order was placed in CleanCloud, not Laundry Butler. Goldline can
 * represent it, play it, and record that the physical work happened. What it
 * must never do is claim either of the two things it cannot know: that this
 * business originated the order, or that CleanCloud has been updated.
 *
 * This build has no CleanCloud API access at all, so the second is a permanent
 * property of what the app can observe — not a gap a later sync will close.
 * The vocabulary has to hold that line, and this proves it does at 393x852.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineExternalOrder.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-external-frames";
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
page.on("pageerror", e => errors.push(`pageerror: ${e.message}`));
page.on("console", m => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.route("**/api/trpc/**", async route => {
  const url = new URL(route.request().url());
  const procedures = decodeURIComponent(
    url.pathname.split("/api/trpc/")[1] ?? ""
  ).split(",");
  const payload = procedures.map(p => ({
    result: {
      data: {
        json:
          p === "auth.me"
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
  u => !u.href.startsWith(baseUrl),
  r => r.fulfill({ status: 200, body: "", contentType: "text/plain" })
);

const cdp = await context.newCDPSession(page);
const pt = (x, y) => ({ x: Math.round(x), y: Math.round(y), radiusX: 12, radiusY: 12, force: 1 });
const touchStart = (x, y) =>
  cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt(x, y)] });
const touchMove = (x, y) =>
  cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [pt(x, y)] });
const touchEnd = () =>
  cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

await page.goto(`${baseUrl}/driver?goldlineFixture=NEUTRALIZE&goldlineExternalDay=1`, {
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
const shot = n => page.screenshot({ path: path.join(outputDir, `${n}.png`) });
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

// ----------------------------------- 1. external work is playable and marked

console.log("\n1. CLEAN CLOUD WORK IS PLAYABLE, AND MARKED AS THEIRS");
await page.getByTestId("expedition-threshold").waitFor({ timeout: 15_000 });
const offered = await page
  .locator(".expedition-threshold__objective")
  .textContent();
check("the offer names the real customer", offered?.trim() === "Miso", offered);

const provenance = await page.getByTestId("expedition-provenance").textContent();
check(
  "provenance is shown before the player commits",
  provenance?.trim() === "CLEAN CLOUD",
  provenance
);
check(
  "the offer never claims Laundry Butler origin",
  !(offered ?? "").match(/laundry butler/i)
);
await shot("ext-01-threshold");

// ------------------------------------------- 2. the same #70 heartbeat

console.log("\n2. IT IS THE SAME HEARTBEAT");
await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
check("the expedition runs", (await snapshot()).outcome === "running");

const plan = await page.evaluate(() => {
  const p = window.__goldlineGame.getExpedition().plan;
  return { destination: p.destination, relic: p.relicPlinths };
});
await walkTo(plan.relic + 0.006);
check("a relic is taken by walking", (await snapshot()).relic != null);

// --------------------------------------- 3. arrival changes nothing

console.log("\n3. ARRIVAL DOES NOT COMPLETE THE WORK");
await walkTo(plan.destination);
if ((await snapshot()).outcome !== "arrived") {
  await page.evaluate(() => {
    const layer = window.__goldlineGame.getExpedition();
    // Every hostile, not just the climax elite. The ranged Slingers stay live
    // behind the player and this fixture stands still here across settles,
    // snapshot reads and screenshots — long enough that they killed the run
    // about one time in three. Winning the fight is explicitly not what any of
    // these scripts are testing; reaching the cache on foot is.
    for (const hostile of layer.hostiles) hostile.hp = 0;
  });
  if ((await snapshot()).outcome === "down") {
    await page.getByTestId("expedition-redeploy").click();
    await settle(20);
    await page.evaluate(() => {
      const layer = window.__goldlineGame.getExpedition();
      // Every hostile, not just the climax elite. The ranged Slingers stay live
      // behind the player and this fixture stands still here across settles,
      // snapshot reads and screenshots — long enough that they killed the run
      // about one time in three. Winning the fight is explicitly not what any of
      // these scripts are testing; reaching the cache on foot is.
      for (const hostile of layer.hostiles) hostile.hp = 0;
    });
  }
  await walkTo(plan.destination);
}
await page.getByTestId("expedition-arrived").waitFor({ timeout: 15_000 });
check("the cache is reached on foot", (await snapshot()).outcome === "arrived");
check(
  "arriving did not secure anything",
  (await page.getByTestId("cargo-secured").count()) === 0
);
check(
  "provenance is still shown on arrival",
  (await page.getByTestId("expedition-provenance").textContent())?.trim() ===
    "CLEAN CLOUD"
);
await shot("ext-02-arrived");

// ------------------------- 4. secure cargo -> update required

console.log("\n4. CARGO SECURED, CLEAN CLOUD STILL OWED");
const strongholdBefore = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);
await page.getByTestId("secure-cargo").click();
await page.getByTestId("cargo-verifying").waitFor({ timeout: 5_000 });
check(
  "the write returning shows VERIFYING, not a completion",
  (await page.getByTestId("cargo-secured").count()) === 0
);

await page.getByTestId("cargo-secured").waitFor({ timeout: 20_000 });
check("CARGO SECURED on authoritative state", true);

const reconciliation = await page
  .getByTestId("external-reconciliation")
  .textContent();
check(
  "the app says CLEAN CLOUD still needs updating",
  reconciliation?.trim() === "CLEAN CLOUD · UPDATE REQUIRED",
  reconciliation
);
check(
  "the app never claims it verified CleanCloud",
  !(reconciliation ?? "").match(/verif/i)
);
await shot("ext-03-update-required");

// ---------------------- 5. no counterfeit native/economic truth

console.log("\n5. NO NATIVE ORDER, NO REVENUE, NO FAKE PROGRESS");
const strongholdAfter = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);
check(
  "external work lit NO pickup lantern",
  (strongholdAfter?.lanternsLit ?? 0) === (strongholdBefore?.lanternsLit ?? 0),
  `${strongholdBefore?.lanternsLit ?? 0} -> ${strongholdAfter?.lanternsLit ?? 0}`
);
check(
  "external work created NO collected-order truth",
  (strongholdAfter?.restoredCount ?? 0) === (strongholdBefore?.restoredCount ?? 0)
);
check(
  "no native pickup order was bound to this run",
  (strongholdAfter?.expeditionOrderCollected ?? false) === false
);

// --------------------------------- 6. operator reconciles manually

console.log("\n6. THE OPERATOR RECONCILES IT THEMSELVES");
await page.getByTestId("external-reconcile").click();
await settle(20);
const reconciled = await page
  .getByTestId("external-reconciliation")
  .textContent();
check(
  "it reads RECONCILED after the operator says so",
  reconciled?.trim() === "CLEAN CLOUD · RECONCILED",
  reconciled
);
check(
  "still never claims verification",
  !(reconciled ?? "").match(/verif/i)
);
await shot("ext-04-reconciled");

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth
);
check("no horizontal overflow at 393x852", overflow === false);

await browser.close();

console.log("");
if (errors.length) {
  console.error("BROWSER ERRORS:");
  for (const e of errors) console.error(`  ${e}`);
}
if (failures.length || errors.length) {
  console.error(`EXTERNAL ORDER FAILED (${failures.length} checks)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`EXTERNAL ORDER PASSED — frames in ${outputDir}`);
