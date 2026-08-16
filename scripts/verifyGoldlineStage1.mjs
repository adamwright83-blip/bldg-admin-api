/**
 * Stage 1 visual verification — the expedition's PHYSICAL objects.
 *
 * Stage 1 moved the climax seal into world-actor depth, implemented the
 * three relics with physical plinths, painted the Safe/Upper fork, tuned
 * guardian scale and rendered the destination cache. Every one of those is
 * a claim about what a player SEES, and no unit test can settle it — so
 * this drives the real runtime in a real browser at 393x852 and captures
 * the frames a reviewer has to look at.
 *
 * It reuses the deterministic fiction harness (goldlineFixture=NEUTRALIZE),
 * which supplies a real-Order-shaped pickup so an expedition is genuinely
 * PREPARED. Only auth.me is intercepted — everything else the harness
 * already provides, so nothing here fabricates business state.
 *
 * Requires a dev server started with VITE_GOLDLINE_TEST_HARNESS=1, which is
 * what exposes window.__goldlineGame.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineStage1.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-stage1-frames";

/** The phone the brief names. Not a small desktop window. */
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

// The fiction harness supplies every other query itself. auth.me is the one
// gate in front of it, and it is answered with an identity, never business
// data.
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

// Each run starts from a clean fixture "server", so the reload check below
// cannot pass on leftovers from a previous run.
//
// Guarded by a one-shot marker because addInitScript runs on EVERY
// navigation — including the reload this script performs. Clearing on that
// navigation too would wipe the stand-in server mid-test and turn the reload
// check into a test of nothing.
await page.addInitScript(() => {
  try {
    if (window.sessionStorage.getItem("goldline-verify:run-started")) return;
    window.sessionStorage.setItem("goldline-verify:run-started", "1");
    window.sessionStorage.removeItem("goldline-fixture:server-collected-orders");
  } catch {
    /* nothing to clear */
  }
});

// Hermetic: a third-party font host must never be able to fail this.
await page.route(
  requestUrl => !requestUrl.href.startsWith(baseUrl),
  route => route.fulfill({ status: 200, body: "", contentType: "text/plain" })
);

await page.goto(`${baseUrl}/driver?goldlineFixture=NEUTRALIZE`, {
  waitUntil: "networkidle",
});
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });

async function shot(name) {
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  captured ${file}`);
}

/**
 * Reports where an expedition actor actually is on screen, and crops a tight
 * frame around it. A full-plate screenshot of this painted world is far too
 * busy to judge one small object in — "I think that pale shape is the seal"
 * is not verification.
 */
async function inspectActor(label, name) {
  const box = await page.evaluate(labelName => {
    const game = window.__goldlineGame;
    const stage = game?.app?.stage;
    if (!stage) return null;
    let found = null;
    const walk = node => {
      if (found) return;
      if (node.label === labelName) {
        found = node;
        return;
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(stage);
    if (!found) return null;
    const b = found.getBounds();
    return {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      zIndex: found.zIndex,
      visible: found.visible,
      renderable: found.renderable,
      alpha: found.alpha,
    };
  }, label);

  if (!box) {
    console.log(`  ${name}: NOT PRESENT IN SCENE (label=${label})`);
    return null;
  }
  console.log(
    `  ${name}: x=${box.x.toFixed(0)} y=${box.y.toFixed(0)} ` +
      `w=${box.width.toFixed(0)} h=${box.height.toFixed(0)} ` +
      `z=${box.zIndex.toFixed(1)} visible=${box.visible} alpha=${box.alpha}`
  );

  const pad = 40;
  const clip = {
    x: Math.max(0, box.x - pad),
    y: Math.max(0, box.y - pad),
    width: Math.min(VIEWPORT.width, box.width + pad * 2),
    height: Math.min(VIEWPORT.height, box.height + pad * 2),
  };
  if (clip.x + clip.width > VIEWPORT.width) {
    clip.width = VIEWPORT.width - clip.x;
  }
  if (clip.y + clip.height > VIEWPORT.height) {
    clip.height = VIEWPORT.height - clip.y;
  }
  if (clip.width > 4 && clip.height > 4) {
    const file = path.join(outputDir, `zoom-${name}.png`);
    await page.screenshot({ path: file, clip });
    console.log(`  captured ${file}`);
  }
  return box;
}

/** Waits for real rendered frames rather than a wall-clock guess. */
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

/**
 * Places Trailblazer at a corridor position. This writes the runtime's own
 * authoritative progress/lateral — the same fields the joystick moves — so
 * every downstream system (projection, depth sort, expedition layer) runs
 * exactly as it does in play. It is a camera dolly for review, not a second
 * movement path.
 */
async function placeAt(progress, lateral) {
  await page.evaluate(
    ({ progress, lateral }) => {
      const game = window.__goldlineGame;
      if (!game) throw new Error("window.__goldlineGame is not exposed");
      game.progress = progress;
      game.lateral = lateral;
    },
    { progress, lateral }
  );
  await settle();
}

function readPlan() {
  return page.evaluate(() => {
    const game = window.__goldlineGame;
    const layer = game?.getExpedition?.();
    if (!layer) return null;
    const plan = layer.plan;
    return {
      relicPlinths: plan.relicPlinths,
      forkStart: plan.fork.start,
      forkEnd: plan.fork.end,
      destination: plan.destination,
      climax: plan.environment.find(e => e.id === "arch_climax_span").progress,
      shieldbearer: plan.hostiles.find(h => h.kind === "shieldbearer").progress,
      hazard: plan.environment.find(e => e.id === "hazard_suspended_cargo")
        .progress,
      hunterFirst: plan.hostiles.find(h => h.id === "hunter_first").progress,
    };
  });
}

// First-run explainer. A real player dismisses it once; so does this.
const explainer = page.getByTestId("first-entry-explainer");
if (await explainer.count()) {
  await explainer.getByRole("button", { name: "GOT IT" }).click();
  await settle(10);
}

console.log("THRESHOLD");
await settle(20);
await shot("01-threshold");

const enter = page.getByTestId("expedition-enter");
if (!(await enter.count())) {
  throw new Error(
    "No ENTER THE LINE threshold — the fixture prepared no pickup expedition"
  );
}
await enter.click();
await settle(24);
await shot("02-entered");

const plan = await readPlan();
if (!plan) throw new Error("Expedition did not start");
console.log("  mapped plan:", JSON.stringify(plan));

console.log("GUARDIAN SCALE");
await placeAt(plan.hunterFirst - 0.03, 0);
await settle(30);
await shot("03-guardian-scale");

console.log("RELIC PLINTHS");
await placeAt(plan.relicPlinths - 0.035, 0);
await shot("04-relic-plinths");
await inspectActor("relic:echo_thread", "plinth-echo-thread");
await inspectActor("relic:sunstep", "plinth-sunstep");

// Walking onto one takes it — no picker, no modal.
await placeAt(plan.relicPlinths, -78 / 140);
await settle(20);
const relic = await page.evaluate(
  () => window.__goldlineGame.getExpeditionSnapshot().relic
);
console.log(`  relic taken by walking to the plinth: ${relic}`);
await shot("05-relic-taken");

console.log("FORK");
await placeAt(plan.forkStart - 0.02, 0);
await shot("06-fork-undecided");

await placeAt((plan.forkStart + plan.forkEnd) / 2, -0.6);
await settle(16);
const route = await page.evaluate(
  () => window.__goldlineGame.getExpeditionSnapshot().route
);
console.log(`  route committed by walking the branch: ${route}`);
await shot("07-fork-committed-upper");

console.log("HAZARD");
await placeAt(plan.hazard - 0.03, 0);
await shot("08-hazard");

console.log("CLIMAX SEAL");
await placeAt(plan.shieldbearer - 0.08, 0);
await settle(30);
await shot("09-seal-and-shieldbearer");

await inspectActor("expedition:climax_seal", "seal");

// Right up against the seal: this is the frame that proves it is a world
// actor. Before Stage 1 the seal was an overlay and painted straight over
// Trailblazer standing here.
await placeAt(plan.climax - 0.02, 0);
await settle(16);
await shot("10-seal-depth-trailblazer-in-front");
await inspectActor("expedition:climax_seal", "seal-at-contact");

// The depth claim, measured rather than eyeballed: Trailblazer standing
// short of the seal must sort ABOVE it.
const depth = await page.evaluate(() => {
  const game = window.__goldlineGame;
  let seal = null;
  const walk = node => {
    if (seal) return;
    if (node.label === "expedition:climax_seal") seal = node;
    for (const child of node.children ?? []) walk(child);
  };
  walk(game.app.stage);
  return { seal: seal?.zIndex ?? null, trailblazer: game.avatar.zIndex };
});
console.log(`  depth: seal z=${depth.seal} trailblazer z=${depth.trailblazer}`);
if (depth.seal === null || depth.trailblazer <= depth.seal) {
  throw new Error(
    "Trailblazer does not sort in front of the seal she is standing at"
  );
}

console.log("SEAL RELEASE");
const ceilingBefore = await page.evaluate(() => {
  const layer = window.__goldlineGame.getExpedition();
  return {
    barrierUp: layer.isClimaxBarrierUp(),
    ceiling: layer.getGameplayForwardCeiling(1),
  };
});
await page.evaluate(() => {
  const layer = window.__goldlineGame.getExpedition();
  const shield = layer.hostiles.find(h => h.id === "shieldbearer_climax");
  shield.hp = 0;
});
const ceilingAfter = await page.evaluate(() => {
  const layer = window.__goldlineGame.getExpedition();
  return {
    barrierUp: layer.isClimaxBarrierUp(),
    ceiling: layer.getGameplayForwardCeiling(1),
  };
});
console.log(
  `  before: ${JSON.stringify(ceilingBefore)}\n  after:  ${JSON.stringify(ceilingAfter)}`
);
if (ceilingBefore.ceiling >= 1 || ceilingAfter.ceiling < 1) {
  throw new Error("Movement did not open the instant the Shieldbearer died");
}
await settle(6);
await shot("11-seal-fracturing");
await settle(40);
await shot("12-seal-gone");

console.log("DESTINATION CACHE");
await placeAt(plan.destination - 0.06, 0);
await settle(20);
await shot("13-cache-approach");
await inspectActor("expedition:destination_cache", "cache");
await placeAt(plan.destination, 0);
await settle(20);
await shot("14-cache-arrival");

const arrival = await page.evaluate(
  () => window.__goldlineGame.getExpeditionSnapshot().outcome
);
console.log(`  outcome at the cache: ${arrival}`);

console.log("TERMINAL HUD — ARRIVED");
const arrivedPanel = page.getByTestId("expedition-arrived");
await arrivedPanel.waitFor({ timeout: 10_000 });
const customer = await page
  .getByTestId("expedition-pinned-customer")
  .textContent();
const address = await page.getByTestId("expedition-pinned-address").textContent();
console.log(`  pinned customer: ${customer}`);
console.log(`  pinned address:  ${address}`);
// The action pad is gone in a terminal state — a downed or arrived player
// must not be left poking a control that no longer means anything.
if (await page.getByTestId("expedition-action-pad").count()) {
  throw new Error("Action pad is still present after arrival");
}
await shot("15-arrived-secure-cargo");

console.log("SECURE CARGO");
const strongholdBefore = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);
console.log(`  stronghold before: ${JSON.stringify(strongholdBefore)}`);

await page.getByTestId("secure-cargo").click();

// The mutation returning must NOT be treated as a secured pickup. This is
// the exact frame that would expose an optimistic completion.
await page.getByTestId("cargo-verifying").waitFor({ timeout: 5_000 });
if (await page.getByTestId("cargo-secured").count()) {
  throw new Error(
    "CARGO SECURED appeared before authoritative evidence confirmed it"
  );
}
console.log("  VERIFYING SERVER TRUTH shown, CARGO SECURED correctly withheld");
await shot("16-verifying-server-truth");

console.log("REALITY WINS");
await page.getByTestId("cargo-secured").waitFor({ timeout: 15_000 });
console.log("  CARGO SECURED, on authoritative evidence");
await settle(30);
await shot("17-cargo-secured");

const strongholdAfter = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);
console.log(`  stronghold after:  ${JSON.stringify(strongholdAfter)}`);
if (!strongholdAfter?.expeditionOrderCollected) {
  throw new Error("Stronghold does not reflect the collected pinned order");
}
if (strongholdAfter.lanternsLit <= (strongholdBefore?.lanternsLit ?? 0)) {
  throw new Error("Stronghold payoff did not physically change");
}
await settle(60);
await shot("18-stronghold-payoff");

const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth
);
if (overflow) throw new Error("Horizontal overflow at 393x852");

console.log("RELOAD — the payoff must be rebuilt from real order truth");
// The fiction fixture rebuilds its evidence from scratch on reload, exactly
// as production re-reads admin.listByStatus. Nothing about the payoff was
// stored locally, so the only way the threshold can come back lit is if it
// is genuinely a projection of collected orders.
await page.reload({ waitUntil: "networkidle" });
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });
const explainerAgain = page.getByTestId("first-entry-explainer");
if (await explainerAgain.count()) {
  await explainerAgain.getByRole("button", { name: "GOT IT" }).click();
}
await settle(30);
const afterReload = await page.evaluate(
  () => window.__goldlineGame?.strongholdRestoration ?? null
);
console.log(`  stronghold after reload: ${JSON.stringify(afterReload)}`);
await shot("19-stronghold-after-reload");

if (!afterReload) throw new Error("No Stronghold reading after reload");
if (afterReload.lanternsLit !== strongholdAfter.lanternsLit) {
  throw new Error(
    `Payoff did not survive reload: ${strongholdAfter.lanternsLit} lanterns ` +
      `before, ${afterReload.lanternsLit} after`
  );
}
if (afterReload.conduitCharge !== strongholdAfter.conduitCharge) {
  throw new Error("Conduit charge did not survive reload");
}
console.log("  payoff rebuilt identically from order truth");

await browser.close();

if (errors.length) {
  console.error("\nBROWSER ERRORS:");
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`\nStage 1 frames written to ${outputDir}`);
