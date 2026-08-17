/**
 * OBJECTIVE-HIERARCHY GATE (§PR77 Part 21E).
 *
 * During an active expedition at 393x852: there is exactly ONE primary
 * objective presentation (no duplicate long objective text competing for
 * attention over the playfield), the compact objective is genuinely
 * interactive (tapping it opens the mission-context sheet — see Part 17),
 * and neither the joystick nor the action pad is obstructed by it or by
 * the contextual teaching hint.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:5186 \
 *     node scripts/verifyGoldlineObjectiveHierarchyGate.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5186";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-objective-frames";

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

async function shot(name) {
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  captured ${file}`);
}

const failures = [];
function check(name, passed, detail) {
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-action-pad").waitFor({ timeout: 10_000 });
await shot("obj-00-active-expedition");

// -------------------------------------------------- 1. one objective owner

console.log("\n1. ONE PRIMARY OBJECTIVE, NO DUPICATE LONG TEXT OVER THE PLAYFIELD");
const objectiveLocator = page.getByTestId("expedition-objective");
check(
  "exactly one compact objective element renders during active gameplay",
  (await objectiveLocator.count()) === 1
);
const objectiveText = (await objectiveLocator.textContent())?.trim() ?? "";
check("the objective has real text, not an empty placeholder", objectiveText.length > 0, `"${objectiveText}"`);

// The full contract: this exact string must not appear a SECOND time
// anywhere else on the active-gameplay screen (a competing restatement of
// the same objective is exactly what Part 17 exists to prevent).
const duplicateCount = await page.evaluate(text => {
  if (!text) return 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let count = 0;
  let node;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    if (node.textContent?.trim() === text) count += 1;
  }
  return count;
}, objectiveText);
check(
  "the objective text appears exactly once on screen, not restated elsewhere",
  duplicateCount === 1,
  `found ${duplicateCount} occurrences of "${objectiveText}"`
);

// -------------------------------------------------- 2. objective is interactive

console.log("\n2. THE OBJECTIVE IS TAPPABLE — OPENS SECONDARY CONTEXT, NOT A DASHBOARD");
check(
  "no mission-context sheet is open before tapping",
  (await page.getByTestId("expedition-mission-sheet").count()) === 0
);
await objectiveLocator.click();
await page.getByTestId("expedition-mission-sheet").waitFor({ timeout: 5_000 });
check(
  "tapping the objective opens the mission-context sheet",
  (await page.getByTestId("expedition-mission-sheet").count()) === 1
);
await shot("obj-02-mission-sheet-open");

// The sheet is secondary context, not a replacement — MOVE and the action
// pad must still exist underneath it (not removed from the DOM).
check(
  "the joystick still exists underneath the open sheet — the game was not replaced by a dashboard",
  (await page.getByTestId("goldline-joystick").count()) === 1
);
check(
  "the action pad still exists underneath the open sheet",
  (await page.getByTestId("expedition-action-pad").count()) === 1
);

await page.getByTestId("expedition-mission-sheet-close").click();
await page.getByTestId("expedition-mission-sheet").waitFor({ state: "detached", timeout: 5_000 });
check(
  "the sheet closes cleanly, returning to plain gameplay",
  (await page.getByTestId("expedition-mission-sheet").count()) === 0
);
await shot("obj-02-mission-sheet-closed");

// ------------------------------------------- 3. controls stay unobstructed

console.log("\n3. JOYSTICK AND ACTION PAD ARE NEVER OBSTRUCTED");
const joystickBox = await page.getByTestId("goldline-joystick").boundingBox();
const padBox = await page.getByTestId("expedition-action-pad").boundingBox();
const objectiveBox = await objectiveLocator.boundingBox();
check("joystick has a real bounding box", Boolean(joystickBox));
check("action pad has a real bounding box", Boolean(padBox));
check(
  "the objective header does not overlap the joystick",
  Boolean(joystickBox) && Boolean(objectiveBox) && !rectsOverlap(joystickBox, objectiveBox)
);
check(
  "the objective header does not overlap the action pad",
  Boolean(padBox) && Boolean(objectiveBox) && !rectsOverlap(padBox, objectiveBox)
);
check(
  "the joystick and action pad never overlap each other",
  Boolean(joystickBox) && Boolean(padBox) && !rectsOverlap(joystickBox, padBox)
);

const hintLocator = page.getByTestId("expedition-teaching-hint");
if ((await hintLocator.count()) > 0) {
  const hintBox = await hintLocator.boundingBox();
  check(
    "the contextual teaching hint does not overlap the joystick",
    Boolean(hintBox) && Boolean(joystickBox) && !rectsOverlap(hintBox, joystickBox)
  );
  check(
    "the contextual teaching hint does not overlap the action pad",
    Boolean(hintBox) && Boolean(padBox) && !rectsOverlap(hintBox, padBox)
  );
}
await shot("obj-03-controls-clear");

await browser.close();

console.log("");
if (errors.length) {
  console.error("BROWSER ERRORS:");
  for (const error of errors) console.error(`  ${error}`);
}
if (failures.length || errors.length) {
  console.error(`OBJECTIVE-HIERARCHY GATE FAILED (${failures.length} checks)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`OBJECTIVE-HIERARCHY GATE PASSED — frames in ${outputDir}`);
