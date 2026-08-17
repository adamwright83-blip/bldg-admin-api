/**
 * FIELD INTEL CAPTURE — browser verification.
 *
 * The vitest suite proves the model cannot launder effort into pipeline. This
 * proves the part unit tests structurally cannot: that a real operator, on a
 * real phone, mid-day, can actually reach the thing and finish a capture.
 *
 * Runs at 393x852 against the real runtime. Every assertion here is about the
 * shipped surface — reachability, tap targets that do not overlap, a class the
 * operator can see and correct, and a confirmation that survives a reload.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineFieldIntel.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const PHONE = { width: 393, height: 852 };

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function boxOf(page, selector) {
  const handle = page.locator(selector).first();
  if ((await handle.count()) === 0) return null;
  return handle.boundingBox();
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: PHONE,
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

  page.on("pageerror", error => {
    check("no uncaught page error", false, String(error));
  });

  // Only auth.me is answered. Everything the game shows comes from the fiction
  // fixture in the real bundle, so this verifies shipped code rather than mocks.
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
    u => !u.href.startsWith(BASE),
    r => r.fulfill({ status: 200, body: "", contentType: "text/plain" })
  );

  await page.goto(`${BASE}/driver?goldlineFixture=NEUTRALIZE&goldlineExternalDay=1`, {
    waitUntil: "networkidle",
  });

  // 1. Reachable WHILE OPERATING, not buried in a menu. The operating bar is
  //    the surface the operator already has open at a doorstep.
  await page
    .locator("canvas.goldline-game-canvas")
    .waitFor({ state: "visible", timeout: 30000 });
  const explainer = page.getByTestId("first-entry-explainer");
  if (await explainer.count()) {
    await explainer.locator("button").first().click();
  }

  // The loading veil sits at z-index 60 and legitimately covers the operating
  // bar while the canvas boots. Measure after it clears, or the overlap check
  // measures the veil instead of the bar.
  await page
    .locator(".game-loading")
    .waitFor({ state: "detached", timeout: 30000 })
    .catch(() => {});

  const cta = page.getByTestId("game-log-signal");
  await cta.waitFor({ state: "visible", timeout: 15000 });
  check("LOG A SIGNAL is reachable from the operating bar", true);

  // 2. It must be a real thumb target, and it must not be sitting under
  //    anything. Four separate overlap bugs have shipped on this screen, so
  //    this is measured rather than eyeballed.
  const ctaBox = await cta.boundingBox();
  check(
    "capture control is at least 44px tall",
    Boolean(ctaBox) && ctaBox.height >= 44,
    ctaBox ? `${Math.round(ctaBox.width)}x${Math.round(ctaBox.height)}` : "no box"
  );
  const topmost = await page.evaluate(box => {
    const el = document.elementFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2
    );
    return el?.closest("[data-testid]")?.getAttribute("data-testid") ?? null;
  }, ctaBox);
  check(
    "nothing covers the capture control",
    topmost === "game-log-signal",
    `elementFromPoint → ${topmost}`
  );

  // 3. The operating bar itself must still fit its fixed height with the new
  //    item — the previous grid had a hardcoded column count.
  const barBox = await boxOf(page, ".game-utility-bar");
  check(
    "operating bar did not wrap into a second row",
    Boolean(barBox) && barBox.height <= 72,
    barBox ? `height ${Math.round(barBox.height)}` : "no bar"
  );

  await cta.click();
  const sheet = page.getByTestId("log-signal-sheet");
  await sheet.waitFor({ state: "visible", timeout: 8000 });
  check("capture sheet opens", true);

  // Nowhere yet. The app has offered a stop but the operator has not walked to
  // it, and an assignment is not a position — attaching a building here would
  // put a wrong place in the permanent record.
  check(
    "no location is claimed before arriving anywhere",
    (await page.getByTestId("log-signal-where").count()) === 0
  );

  // 4. Voice is the primary control and is offered first, but a browser with no
  //    speech recognition must not dead-end the operator.
  const micBox = await boxOf(page, '[data-testid="log-signal-mic"]');
  const speechBox = await boxOf(page, '[data-testid="log-signal-speech"]');
  check(
    "voice control is the largest, topmost control",
    Boolean(micBox) &&
      Boolean(speechBox) &&
      micBox.y < speechBox.y &&
      micBox.height >= 88,
    micBox ? `mic height ${Math.round(micBox.height)}` : "no mic"
  );

  // 5. Capture by typing what Adam would actually say at a building.
  await page
    .getByTestId("log-signal-speech")
    .fill("I left 35 door hangers at this building");
  await page.getByTestId("log-signal-structure").click();

  const proposed = page.getByTestId("proposed-signal");
  await proposed.first().waitFor({ state: "visible", timeout: 8000 });
  check("speech becomes a proposed structure", (await proposed.count()) >= 1);

  // 6. Nothing is authoritative before confirmation.
  const preSave = await page.getByTestId("fixture-signal-count").textContent();
  check(
    "a proposal is not yet recorded",
    preSave?.trim() === "0",
    `recorded=${preSave?.trim()}`
  );

  // 7. The class is visible and correctable — this is the field that decides
  //    whether a day of walking reads as effort or as pipeline.
  const classValue = await page
    .getByTestId("proposed-signal-class")
    .first()
    .inputValue();
  check(
    "35 door hangers is classed as field activity, not a lead",
    classValue === "field_activity",
    classValue
  );
  const options = await page
    .getByTestId("proposed-signal-class")
    .first()
    .locator("option")
    .allTextContents();
  check(
    "the operator can correct the class",
    options.length >= 6,
    `${options.length} classes offered`
  );

  // 8. Provenance is stated as the operator's own observation.
  const provenance = await page
    .getByTestId("log-signal-provenance")
    .textContent();
  check(
    "provenance reads as an operator observation",
    provenance?.includes("OPERATOR") === true &&
      /system/i.test(provenance ?? "") === false,
    provenance?.trim()
  );

  // 9. SAVE — a real tap, and the sheet closes.
  const saveBox = await boxOf(page, '[data-testid="log-signal-save"]');
  check(
    "SAVE is a real thumb target",
    Boolean(saveBox) && saveBox.height >= 44,
    saveBox ? `height ${Math.round(saveBox.height)}` : "no button"
  );
  await page.getByTestId("log-signal-save").click();
  await sheet.waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
  check("sheet closes after saving", (await sheet.count()) === 0);

  const postSave = await page.getByTestId("fixture-signal-count").textContent();
  check(
    "the confirmed signal is recorded",
    postSave?.trim() === "1",
    `recorded=${postSave?.trim()}`
  );

  // 10. Reload. The sheet stores nothing, so anything still here came back from
  //     outside the component.
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByTestId("fixture-signal-count")
    .waitFor({ state: "attached", timeout: 15000 });
  const afterReload = await page
    .getByTestId("fixture-signal-count")
    .textContent();
  const classesAfter = await page
    .getByTestId("fixture-signal-classes")
    .textContent();
  check(
    "the capture survives a reload",
    afterReload?.trim() === "1",
    `recorded=${afterReload?.trim()}`
  );
  check(
    "and it is still field activity, not an outcome",
    classesAfter?.trim() === "field_activity",
    classesAfter?.trim()
  );

  // 11. Empty speech cannot be submitted at all — a blank row in the ledger is
  //     worse than no row.
  await page.getByTestId("game-log-signal").click();
  await sheet.waitFor({ state: "visible", timeout: 8000 });
  const structureDisabled = await page
    .getByTestId("log-signal-structure")
    .isDisabled();
  check("empty speech cannot be structured", structureDisabled);

  // ------------------------------------------------------------------------
  // 12. ARRIVAL is the one moment the app genuinely knows where he is, so it
  //     is the only moment a location may ride along with an observation.
  await page.getByTestId("log-signal-back").click().catch(() => {});
  await page.locator('[data-testid="log-signal-sheet"] header button').click();
  await sheet.waitFor({ state: "detached", timeout: 8000 }).catch(() => {});

  const settle = async (frames = 6) =>
    page.evaluate(
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
  const snapshot = () =>
    page.evaluate(() => window.__goldlineGame.getExpeditionSnapshot());

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

  await page.getByTestId("expedition-enter").click();
  await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10000 });
  const destination = await page.evaluate(
    () => window.__goldlineGame.getExpedition().plan.destination
  );

  const stickBox = await boxOf(page, '[data-testid="goldline-joystick"]');
  const stick = {
    x: stickBox.x + stickBox.width / 2,
    y: stickBox.y + stickBox.height / 2,
  };
  await touch("touchStart", [pt(stick.x, stick.y)]);
  const walkStarted = Date.now();
  let last = 0;
  let stalled = 0;
  while (Date.now() - walkStarted < 25000) {
    await touch("touchMove", [pt(stick.x, stick.y - 46)]);
    await settle(6);
    const now = await page.evaluate(() => window.__goldlineGame.progress);
    if (now >= destination - 0.004) break;
    stalled = Math.abs(now - last) < 0.0005 ? stalled + 1 : 0;
    if (stalled > 14) break;
    last = now;
  }
  await touch("touchEnd", []);
  await settle(8);

  // The climax Shieldbearer guards the cache; clearing it is not the subject of
  // this test, so remove the obstacle the same way the external-order proof
  // does and recover first if it landed a killing blow.
  if ((await snapshot()).outcome !== "arrived") {
    const dropGuard = () =>
      page.evaluate(() => {
        // Every hostile. The ranged Slingers stay live behind the player and
        // kill a fixture that stands still, which is not what this proves.
        for (const hostile of window.__goldlineGame.getExpedition().hostiles) {
          hostile.hp = 0;
        }
      });
    await dropGuard();
    if ((await snapshot()).outcome === "down") {
      await page.getByTestId("expedition-redeploy").click();
      await settle(20);
      await dropGuard();
    }
    await touch("touchStart", [pt(stick.x, stick.y)]);
    const retryStarted = Date.now();
    while (Date.now() - retryStarted < 25000) {
      await touch("touchMove", [pt(stick.x, stick.y - 46)]);
      await settle(6);
      const now = await page.evaluate(() => window.__goldlineGame.progress);
      if (now >= destination - 0.004) break;
    }
    await touch("touchEnd", []);
    await settle(8);
  }

  const arrived = (await snapshot()).outcome === "arrived";
  check("the cache is reached on foot", arrived);

  if (arrived) {
    // The operating bar is hidden for the duration of a run, so the doorstep
    // needs its own way in. Without this the capture surface is unreachable at
    // the one moment the app knows both that he is standing somewhere and
    // exactly where — which is when everything worth capturing is noticed.
    const doorstep = page.getByTestId("expedition-log-signal");
    check(
      "capture is reachable from the doorstep itself",
      (await doorstep.count()) === 1
    );
    const doorstepBox = await boxOf(page, '[data-testid="expedition-log-signal"]');
    check(
      "the doorstep control is a real thumb target",
      Boolean(doorstepBox) && doorstepBox.height >= 44,
      doorstepBox ? `height ${Math.round(doorstepBox.height)}` : "no box"
    );
    // It must not sit on top of the action that actually records the work.
    const secureBox = await boxOf(page, '[data-testid="secure-cargo"]');
    check(
      "it does not overlap SECURE CARGO",
      Boolean(secureBox) &&
        Boolean(doorstepBox) &&
        doorstepBox.y >= secureBox.y + secureBox.height,
      secureBox
        ? `secure ends ${Math.round(secureBox.y + secureBox.height)}, signal starts ${Math.round(doorstepBox.y)}`
        : "no secure button"
    );
    await doorstep.click();
    await sheet.waitFor({ state: "visible", timeout: 8000 });
    const where = page.getByTestId("log-signal-where");
    const shown = (await where.count()) > 0 ? await where.textContent() : null;
    check(
      "arriving attaches the real customer the app already pinned",
      shown?.trim() === "Miso",
      shown?.trim() ?? "absent"
    );
    // The location came from the app; the observation is still the operator's.
    const provenanceAtStop = await page
      .getByTestId("log-signal-speech")
      .count();
    check(
      "capture still starts from the operator's own words",
      provenanceAtStop === 1
    );
  }

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed`
  );
  if (failed.length > 0) process.exit(1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
