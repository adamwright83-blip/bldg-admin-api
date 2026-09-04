/**
 * LOCAL_TARGET_RUN GATES F-J (§PR77 Parts 8-20, 21F/G/H/I/J).
 *
 * Proves the "visit N real businesses" loop end to end, against the real
 * runtime with real touch, at 393x852:
 *
 *   F. Recognition -> ONE objective, not N prose steps. The compact
 *      objective reads "<QUERY> EXCHANGE RUN — TARGET 1 OF <sourced> —
 *      <business name>", never a generic Open Channel task title.
 *   G. Partial-sourcing truth. The fixture requests 5 targets but only
 *      sources 3 (a legitimate, non-simulated partial result) — every
 *      progress figure in the HUD must say "OF 3", never "OF 5" (the
 *      requested count), and never silently pad with invented targets.
 *   H. Resume/reload survival. A visit recorded against a target survives a
 *      full page reload — the same "server truth", not React state.
 *   I. Field Intel linkage. Only a CONFIRMED Field Intel capture at the
 *      current target advances progress — arrival alone does nothing, and
 *      there is no button that can fake a visit. Confirming records a
 *      namespace-qualified `sourced_target:...` stop identity.
 *   J. Route/progress projection. Once a target is visited, the objective
 *      and mission-context sheet both advance to the NEXT sourced target,
 *      never re-deriving progress from anything but recorded visits.
 *
 * A second short pass proves the labeled-simulation fallback (Adam's
 * road-testing rail): every simulated target is visibly badged
 * SIMULATED / PLACES UNAVAILABLE and is never presented as a real business.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineLocalTargetRunGate.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-target-run-frames";

const VIEWPORT = { width: 393, height: 852 };

/**
 * The doorstep coordinate, read from the fixture that defines it.
 *
 * This used to be hardcoded here as well, and the two copies silently drifted:
 * the fixture put A-1 Dry Cleaners at 34.05/-118.25 while this gate stood at
 * 34.0522/-118.2437 and waited to arrive. That is 630 metres apart, against a
 * conservative 55m enter radius, so the dwell could never establish arrival and
 * the gate could never pass. The arrival rule was right; the test was standing
 * in the wrong place.
 *
 * Deriving it from the single source of truth means a future fixture move
 * cannot reintroduce that drift — and if the fixture shape changes, this fails
 * loudly here rather than as a mystery timeout 200 lines later.
 */
function readFixtureTarget(name) {
  const source = readFileSync(
    new URL("../client/src/game/testSupport/GoldlineFictionHarness.tsx", import.meta.url),
    "utf8"
  );
  const at = source.indexOf(`name: "${name}"`);
  if (at === -1) throw new Error(`fixture target ${name} not found`);
  const block = source.slice(at, at + 400);
  const lat = block.match(/\blat:\s*(-?\d+(?:\.\d+)?)/);
  const lng = block.match(/\blng:\s*(-?\d+(?:\.\d+)?)/);
  if (!lat || !lng) throw new Error(`fixture target ${name} has no lat/lng`);
  return { latitude: Number(lat[1]), longitude: Number(lng[1]) };
}

const FIRST_TARGET = readFixtureTarget("A-1 Dry Cleaners");

await mkdir(outputDir, { recursive: true });

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function newPage(browser) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 9 Pro) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    geolocation: { latitude: 34.0522, longitude: -118.2437, accuracy: 10 },
    permissions: ["geolocation"],
  });
  const page = await context.newPage();
  page.on("pageerror", error =>
    check("no uncaught page error", false, String(error))
  );
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
    routeHandler =>
      routeHandler.fulfill({ status: 200, body: "", contentType: "text/plain" })
  );
  return { context, page };
}

const settle = page =>
  async function settleFrames(frames = 6) {
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
  };

async function boxOf(page, testId) {
  const locator = page.getByTestId(testId);
  if ((await locator.count()) === 0) return null;
  return locator.boundingBox();
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ------------------------------------------------------------ SETUP
  const { context, page } = await newPage(browser);
  await page.goto(
    `${baseUrl}/driver?goldlineFixture=NEUTRALIZE&goldlineLocalTargetRunDay=1`,
    { waitUntil: "networkidle" }
  );
  await page
    .locator("canvas.goldline-game-canvas")
    .waitFor({ state: "visible", timeout: 30_000 });
  const explainer = page.getByTestId("first-entry-explainer");
  if (await explainer.count()) {
    await explainer.getByRole("button", { name: "GOT IT" }).click();
  }
  const shot = name =>
    page.screenshot({ path: path.join(outputDir, `${name}.png`) });

  await page.getByTestId("expedition-enter").click();
  await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
  await shot("ltr-00-entered");

  // -------------------------------------------------------- F. RECOGNITION
  console.log("\nF. RECOGNIZED AS ONE OBJECTIVE, NOT N PROSE STEPS");
  const objectiveText = (
    await page.getByTestId("expedition-objective").textContent()
  )?.trim();
  check(
    "the objective names the query, real progress, and the current business",
    Boolean(
      objectiveText &&
        objectiveText.includes("DRY CLEANER EXCHANGE RUN") &&
        objectiveText.includes("TARGET 1 OF 3") &&
        objectiveText.includes("A-1 DRY CLEANERS")
    ),
    objectiveText
  );

  // -------------------------------------------------- G. PARTIAL-SOURCING TRUTH
  console.log("\nG. PARTIAL SOURCING IS REPORTED TRUTHFULLY (3 found, 5 requested)");
  check(
    "the objective never claims the requested count as if it were sourced",
    Boolean(objectiveText) && !objectiveText.includes("OF 5"),
    objectiveText
  );
  await page.getByTestId("expedition-objective").click();
  await page.getByTestId("expedition-mission-sheet").waitFor({ timeout: 5_000 });
  const sheetText = (
    await page.getByTestId("expedition-mission-sheet").textContent()
  )?.trim();
  check(
    "the mission-context sheet shows real progress out of the real sourced count",
    Boolean(sheetText?.includes("TARGET 1 OF 3")),
    sheetText
  );
  check(
    "the sheet never mentions the unmet requested count as sourced",
    Boolean(sheetText) && !sheetText.includes("OF 5"),
    sheetText
  );
  await shot("ltr-01-mission-sheet-partial-truth");
  await page.getByTestId("expedition-mission-sheet-close").click();
  await page
    .getByTestId("expedition-mission-sheet")
    .waitFor({ state: "detached", timeout: 5_000 });

  // ----------------------------------------------- walk to the first target
  const cdp = await context.newCDPSession(page);
  const pt = (x, y) => ({
    x: Math.round(x),
    y: Math.round(y),
    radiusX: 12,
    radiusY: 12,
    force: 1,
  });
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const settleFrames = settle(page);
  const snapshot = () =>
    page.evaluate(() => window.__goldlineGame.getExpeditionSnapshot());
  const progressNow = () => page.evaluate(() => window.__goldlineGame.progress);

  async function walkTo(target, { maxMs = 25_000 } = {}) {
    const stickBox = await boxOf(page, "goldline-joystick");
    const stick = {
      x: stickBox.x + stickBox.width / 2,
      y: stickBox.y + stickBox.height / 2,
    };
    await touch("touchStart", [pt(stick.x, stick.y)]);
    const startedAt = Date.now();
    let last = await progressNow();
    let stalled = 0;
    while (Date.now() - startedAt < maxMs) {
      await touch("touchMove", [pt(stick.x, stick.y - 46)]);
      await settleFrames(6);
      const now = await progressNow();
      if (now >= target - 0.004) break;
      stalled = Math.abs(now - last) < 0.0005 ? stalled + 1 : 0;
      if (stalled > 14) break;
      last = now;
    }
    await touch("touchEnd", []);
    await settleFrames(6);
  }

  const destination = await page.evaluate(
    () => window.__goldlineGame.getExpedition().plan.destination
  );
  await walkTo(destination);
  if ((await snapshot()).outcome !== "arrived") {
    await page.evaluate(() => {
      for (const hostile of window.__goldlineGame.getExpedition().hostiles)
        hostile.hp = 0;
    });
    if ((await snapshot()).outcome === "down") {
      await page.getByTestId("expedition-redeploy").click();
      await settleFrames(20);
      await page.evaluate(() => {
        for (const hostile of window.__goldlineGame.getExpedition().hostiles)
          hostile.hp = 0;
      });
    }
    await walkTo(destination);
  }
  await page.getByTestId("expedition-arrived").waitFor({ timeout: 15_000 });
  check(
    "the first target is reached on foot",
    (await snapshot()).outcome === "arrived"
  );
  await shot("ltr-02-arrived-at-first-target");

  // CI's fixed BrowserContext geolocation may emit only its initial
  // watchPosition reading while the device is stationary. Production's truth
  // gate intentionally requires at least three accurate provider readings over
  // a real 12-second dwell, so exercise that exact rule instead of treating one
  // coordinate as proof the operator remained there. These are GPS-provider
  // updates; touch remains real CDP input and no business result is synthesized.
  //
  // The samples must be AT the target: production requires
  // distance + accuracy <= 55m to call an arrival, and nothing about that rule
  // is relaxed here. The tiny offsets are provider jitter, not a wider radius.
  const dwellSamples = [
    { ...FIRST_TARGET, accuracy: 10 },
    {
      latitude: FIRST_TARGET.latitude + 0.000001,
      longitude: FIRST_TARGET.longitude - 0.000001,
      accuracy: 10,
    },
    {
      latitude: FIRST_TARGET.latitude - 0.000001,
      longitude: FIRST_TARGET.longitude + 0.000001,
      accuracy: 10,
    },
  ];
  for (const sample of dwellSamples) {
    await context.setGeolocation(sample);
    await page.waitForTimeout(6_100);
  }

  // ------------------------------------------------- I. FIELD INTEL LINKAGE
  console.log("\nI. ONLY A CONFIRMED FIELD INTEL CAPTURE ADVANCES PROGRESS");
  check(
    "arrival alone does not secure anything — there is no fake-completion button",
    (await page.getByTestId("secure-cargo").count()) === 0
  );
  const awaiting = page.getByTestId("target-run-awaiting-signal");
  check(
    "the HUD explicitly directs the operator to LOG A SIGNAL, not a dead end",
    (await awaiting.count()) === 1
  );
  const progressBefore = (
    await page.getByTestId("expedition-target-run-progress").textContent()
  )?.trim();
  check(
    "progress reads 0 OF 3 before any signal is confirmed",
    progressBefore === "0 OF 3 VISITED",
    progressBefore
  );

  const doorstep = page.getByTestId("expedition-log-signal");
  await doorstep.waitFor({ state: "visible", timeout: 8_000 });
  const doorstepLabel = (await doorstep.textContent())?.trim();
  check(
    "Field Intel unlocks only after the conservative physical-arrival dwell",
    doorstepLabel === "LOG A SIGNAL",
    doorstepLabel
  );
  await doorstep.click();
  const sheet = page.getByTestId("log-signal-sheet");
  await sheet.waitFor({ state: "visible", timeout: 8_000 });
  const whereShown = (
    await page.getByTestId("log-signal-where").textContent()
  )?.trim();
  check(
    "the sheet attaches the real target the app pinned, not an invented name",
    whereShown === "A-1 Dry Cleaners",
    whereShown
  );
  await page
    .getByTestId("log-signal-speech")
    .fill("Dropped off a referral pitch, they'll consider it");
  await page.getByTestId("log-signal-structure").click();
  await page
    .getByTestId("proposed-signal")
    .first()
    .waitFor({ state: "visible", timeout: 8_000 });
  await shot("ltr-03-log-signal-proposed");
  await page.getByTestId("log-signal-save").click();
  await sheet.waitFor({ state: "detached", timeout: 8_000 }).catch(() => {});
  check("the capture sheet closes after saving", (await sheet.count()) === 0);

  const linkage = (
    await page.getByTestId("fixture-signal-entity-ids").textContent()
  )?.trim();
  const recordedLinkage = (linkage ?? "").split(",").pop() ?? "";
  check(
    "the confirmed signal records a namespace-qualified sourced_target identity",
    recordedLinkage === "sourced_target:places:fixture-a",
    recordedLinkage
  );

  // markLocalTargetRunTargetVisited runs on the fixture's own SERVER_TRUTH_DELAY —
  // give it real wall-clock time rather than asserting synchronously.
  await page.waitForTimeout(1_400);

  // --------------------------------------------- J. ROUTE/PROGRESS PROJECTION
  console.log("\nJ. THE OBJECTIVE ADVANCES TO THE NEXT SOURCED TARGET FROM RECORDED EVIDENCE");
  const progressAfter = (
    await page.getByTestId("expedition-target-run-progress").textContent()
  )?.trim();
  check(
    "progress advances to 1 OF 3 only after the confirmed capture",
    progressAfter === "1 OF 3 VISITED",
    progressAfter
  );
  const objectiveAfter = (
    await page.getByTestId("expedition-objective").textContent()
  )?.trim();
  check(
    "the objective now names the NEXT sourced target",
    Boolean(
      objectiveAfter &&
        objectiveAfter.includes("TARGET 2 OF 3") &&
        objectiveAfter.includes("TESTVILLE FLUFF & FOLD")
    ),
    objectiveAfter
  );
  await shot("ltr-04-advanced-to-next-target");

  // --------------------------------------------------- H. RESUME AFTER RELOAD
  console.log("\nH. THE RECORDED VISIT SURVIVES A FULL RELOAD (server truth, not React state)");
  await page.reload({ waitUntil: "networkidle" });
  await page
    .locator("canvas.goldline-game-canvas")
    .waitFor({ state: "visible", timeout: 30_000 });
  const explainerAgain = page.getByTestId("first-entry-explainer");
  if (await explainerAgain.count()) {
    await explainerAgain.getByRole("button", { name: "GOT IT" }).click();
  }
  await page.getByTestId("expedition-enter").click();
  await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
  const objectiveAfterReload = (
    await page.getByTestId("expedition-objective").textContent()
  )?.trim();
  check(
    "after reload the run still shows the visit that was already recorded",
    Boolean(objectiveAfterReload?.includes("TARGET 2 OF 3")),
    objectiveAfterReload
  );
  await shot("ltr-05-resumed-after-reload");

  await context.close();

  // ---------------------------------------------- SIMULATED FALLBACK BADGE
  console.log("\nSIMULATION FALLBACK IS ALWAYS VISIBLY LABELED, NEVER PRESENTED AS REAL");
  const sim = await newPage(browser);
  await sim.page.goto(
    `${baseUrl}/driver?goldlineFixture=NEUTRALIZE&goldlineLocalTargetRunDay=1&goldlineLocalTargetRunSimulated=1`,
    { waitUntil: "networkidle" }
  );
  await sim.page
    .locator("canvas.goldline-game-canvas")
    .waitFor({ state: "visible", timeout: 30_000 });
  const simExplainer = sim.page.getByTestId("first-entry-explainer");
  if (await simExplainer.count()) {
    await simExplainer.getByRole("button", { name: "GOT IT" }).click();
  }
  // The threshold (pre-entry) screen is where provenance is always shown —
  // it must be honest before the operator even commits to the run.
  await sim.page
    .getByTestId("expedition-threshold")
    .waitFor({ timeout: 10_000 });
  const thresholdProvenance = sim.page.getByTestId("expedition-provenance");
  const thresholdProvenanceText = (await thresholdProvenance.count())
    ? (await thresholdProvenance.textContent())?.trim()
    : null;
  check(
    "the pre-entry threshold badges a simulated run before the operator commits",
    thresholdProvenanceText === "SIMULATED · PLACES UNAVAILABLE",
    thresholdProvenanceText ?? "no provenance badge rendered"
  );
  await sim.page.screenshot({
    path: path.join(outputDir, "ltr-06-simulated-threshold.png"),
  });

  await sim.page.getByTestId("expedition-enter").click();
  await sim.page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
  await sim.page.getByTestId("expedition-objective").click();
  await sim.page
    .getByTestId("expedition-mission-sheet")
    .waitFor({ timeout: 5_000 });
  const sheetProvenance = (
    await sim.page.locator(".expedition-mission-sheet__provenance").textContent()
  )?.trim();
  check(
    "the mission-context sheet badges the same run as simulated, never as real sourcing",
    sheetProvenance === "SIMULATED · PLACES UNAVAILABLE",
    sheetProvenance ?? "no provenance line in the sheet"
  );
  await sim.page.screenshot({
    path: path.join(outputDir, "ltr-06-simulated-badge.png"),
  });
  await sim.context.close();

  await browser.close();

  console.log("");
  const failed = results.filter(r => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.error(`LOCAL_TARGET_RUN GATE FAILED (${failed.length} checks)`);
    for (const failure of failed)
      console.error(
        `  ${failure.name}${failure.detail ? `: ${failure.detail}` : ""}`
      );
    process.exit(1);
  }
  console.log(`LOCAL_TARGET_RUN GATE PASSED — frames in ${outputDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
