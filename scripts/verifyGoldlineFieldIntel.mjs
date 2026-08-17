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
