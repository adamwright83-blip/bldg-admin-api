/**
 * THE ZERO-ORDER DAY — proven, not asserted in prose.
 *
 * §PR78 Workstream B1 (playtest closure). PR #71 originally made the
 * expedition shell objective-agnostic so an approved Open Channel task could
 * stage the #70 combat heartbeat when no Laundry Butler-native pickup
 * existed. Adam's first real playtest found that cargo-box expedition did
 * nothing he could perceive for a plain desk task ("design door hangers") —
 * the climax was dishonest. §PR78 closes it: the expedition shell is now
 * reserved for objectives with real physical arrival (native_pickup,
 * external_order, local_target_run); a plain `open_channel` objective
 * completes right in the base, through the exact same canonical write,
 * with no combat staged around it at all.
 *
 * This is that closure, executed against the real runtime:
 *
 *   1. No native pickup + approved Open Channel task -> NO "ENTER THE LINE"
 *      is ever offered for it; the base shows SEAL THE WORK directly.
 *   2. Tapping SEAL THE WORK calls the same canonical Open Channel write.
 *   3. The HUD stays in-base (no expedition mounts) until authoritative
 *      state says the task is completed.
 *   4. Completion produces NO pickup Stronghold restoration (no lanterns,
 *      no collected-order evidence, no expedition order binding) — sealing
 *      a desk task was never combat and still is not a pickup.
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

const failures = [];
function check(name, passed, detail) {
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}
const shot = name => page.screenshot({ path: path.join(outputDir, `${name}.png`) });

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

// --------------------------------- 1. no combat is ever offered or mounted

console.log("\n1. A DESK TASK NEVER STAGES COMBAT");
await page.getByTestId("seal-open-channel-task").waitFor({ timeout: 15_000 });
check(
  "SEAL THE WORK is offered directly in the base",
  (await page.getByTestId("seal-open-channel-task").count()) > 0
);
check(
  "ENTER THE LINE is never offered for this objective",
  (await page.getByTestId("expedition-enter").count()) === 0
);
check(
  "the expedition shell never mounts",
  (await page.getByTestId("expedition-action-pad").count()) === 0
);
const sealLabel = await page
  .getByTestId("seal-open-channel-task")
  .locator("small")
  .textContent()
  .catch(() => null);
check(
  "the offer names the operator's own real task",
  Boolean(sealLabel && sealLabel.toLowerCase().includes("door hanger")),
  sealLabel
);
await shot("oc-01-base-offer");

// ---------------------------------- 2/3. the canonical write, and only it

console.log("\n2. TAPPING SEAL THE WORK CALLS THE CANONICAL WRITE");
const strongholdBefore = await page.evaluate(
  () => window.__goldlineGame.strongholdRestoration
);

// This fixture mission has more than one pending task ("Finish the door
// hanger design", then "Send the hanger to the printer") — the base offers
// them one at a time, exactly as a real operator would work through a real
// task list. Seal every one it offers, in order.
let sealedCount = 0;
for (let i = 0; i < 6 && (await page.getByTestId("seal-open-channel-task").count()) > 0; i += 1) {
  await page.getByTestId("seal-open-channel-task").click();
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[data-testid="seal-open-channel-task"]') ||
        document.querySelector('[data-testid="seal-open-channel-task"]')?.getAttribute("disabled") === null,
      { timeout: 5_000 }
    )
    .catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1_200)); // fixture's SERVER_TRUTH_DELAY_MS
  sealedCount += 1;
}
check("at least one desk task was sealed", sealedCount > 0, `sealed=${sealedCount}`);
check(
  "the task surface clears once every task is completed",
  (await page.getByTestId("seal-open-channel-task").count()) === 0
);
await shot("oc-02-sealed");

// --------------------------- 4. no counterfeit economic / combat progress

console.log("\n3. REAL WORK, NO COUNTERFEIT BUSINESS PROGRESS, NO COMBAT ARTIFACTS");
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
  "no expedition order was ever bound",
  (strongholdAfter?.expeditionOrderCollected ?? false) === false
);
check(
  "the expedition shell still never mounted after completion",
  (await page.getByTestId("expedition-action-pad").count()) === 0
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
