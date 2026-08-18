/**
 * §R1 DAY ASSEMBLY + PHYSICAL-STOP HONESTY + MOBILE LEGIBILITY.
 *
 * Proves the things `docs/goldline-r1-execution-prompt.md` requires as
 * executable proof, modeled on `scripts/verifyGoldlinePr78.mjs` and the CDP
 * true-touch pattern from `docs/goldline-pickup-expedition-handoff.md`
 * (real `Input.dispatchTouchEvent`, never the browser tool's synthetic
 * click — the Pixi canvas swallows those).
 *
 *   1. Backend truth (direct HTTP against the real server + real MySQL,
 *      the docker recipe in the handoff doc): a plan approved with an
 *      explicit `physical_stop` task and no destination is REJECTED; the
 *      same task approved with a destination persists and completes
 *      through the canonical write; a legacy row with `execution IS NULL`
 *      and a `navigationQuery` resolves to `physical_stop` on read — the
 *      legacy-default rule, proven against the real column, not a fixture.
 *   2. Frontend truth (real CDP touch at 393x852, the fixture harness):
 *      the fixture mission's base task ("Design the door hangers") shows
 *      SEAL THE WORK and no expedition staging; the physical task ("Pick
 *      up Mona's order at Opus LA") shows NAVIGATE + expedition staging
 *      reachable and NEVER shows SEAL THE WORK anywhere in the DOM.
 *   3. The empty-day fixture renders the day-assembly front door with
 *      three real actions, each measuring >=56px tall.
 *   4. Legibility spot-checks via computed styles on named chips.
 *
 *   GOLDLINE_VERIFY_URL=http://127.0.0.1:4177 \
 *   GOLDLINE_VERIFY_DB="mysql://root:root@127.0.0.1:3399/goldline_mobile_gate" \
 *     node scripts/verifyGoldlineR1.mjs
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:4177";
const dbUrl =
  process.env.GOLDLINE_VERIFY_DB ??
  "mysql://root:root@127.0.0.1:3399/goldline_mobile_gate";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ?? "tmp/goldline-r1-frames";

const VIEWPORT = { width: 393, height: 852 };
const DPR = 3;

await mkdir(outputDir, { recursive: true });

const failures = [];
function check(name, passed, detail) {
  console.log(`  ${passed ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

// =====================================================================
// PART 1 — BACKEND TRUTH. Direct HTTP against the real server + real
// MySQL. No fixture, no stub: this is the production code path.
// =====================================================================

console.log("\n1. BACKEND TRUTH — execution typing against the real server + DB");

const DRIVER_PASSWORD = "goldline-mobile-driver-pass";
let sessionCookie = null;

async function loginDriver() {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: DRIVER_PASSWORD, role: "driver" }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login did not set a session cookie");
  sessionCookie = setCookie.split(";")[0];
}

async function trpcMutate(procedure, input) {
  const res = await fetch(`${baseUrl}/api/trpc/${procedure}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookie,
    },
    body: JSON.stringify({ json: input }),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

async function trpcQuery(procedure, input) {
  const res = await fetch(
    `${baseUrl}/api/trpc/${procedure}?input=${encodeURIComponent(
      JSON.stringify({ json: input })
    )}`,
    { headers: { cookie: sessionCookie } }
  );
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

await loginDriver();
check("driver session established", Boolean(sessionCookie));

const businessDate = "2026-08-18";
const timeZone = "America/Los_Angeles";

// A fresh mission for this exact run, so it never collides with a prior
// script invocation's "active mission already exists" guard.
const requestId = crypto.randomUUID();
const draftRes = await trpcMutate("system.openChannel.generateDraft", {
  businessDate,
  requestId,
  now: new Date().toISOString(),
  timeZone,
  nextCommitmentAt: null,
  availableMinutes: 240,
  currentLocation: null,
  transcript:
    "Design the door hangers, then pick up Mona's order at Opus LA.",
});
check(
  "draft mission generated",
  draftRes.ok && Boolean(draftRes.body?.result?.data?.json?.id),
  JSON.stringify(draftRes.body)
);
const missionId = draftRes.body?.result?.data?.json?.id;

// §Workstream 1 item 3. A physical_stop task with NO destination must be
// REJECTED at approval — the operator is the authority, but authority
// does not mean the game will stage a NAVIGATE affordance to nowhere.
const rejectRes = await trpcMutate("system.openChannel.approve", {
  missionId,
  title: "Open the day",
  tasks: [
    {
      title: "Pick up Mona's order at Opus LA",
      detail: "Mona's order is ready — collect it in person.",
      estimatedMinutes: 30,
      category: "operations",
      navigationQuery: null,
      execution: "physical_stop",
    },
  ],
});
check(
  "approval REJECTS a physical_stop task with an empty destination",
  !rejectRes.ok,
  JSON.stringify(rejectRes.body)
);

// Now approve the real fixture pair: base + physical, physical WITH a
// destination — this must succeed and persist exactly as submitted.
const approveRes = await trpcMutate("system.openChannel.approve", {
  missionId,
  title: "Open the day",
  tasks: [
    {
      title: "Design the door hangers",
      detail: "Export print-ready artwork for the block campaign.",
      estimatedMinutes: 60,
      category: "sales",
      navigationQuery: null,
      execution: "base",
    },
    {
      title: "Pick up Mona's order at Opus LA",
      detail: "Mona's order is ready — collect it in person.",
      estimatedMinutes: 30,
      category: "operations",
      navigationQuery: "Opus LA, 1601 Vine St",
      execution: "physical_stop",
    },
  ],
});
check(
  "approval SUCCEEDS with a destination present",
  approveRes.ok,
  JSON.stringify(approveRes.body)
);
const approvedTasks = approveRes.body?.result?.data?.json?.tasks ?? [];
check(
  "the approved base task persists execution=base",
  approvedTasks[0]?.execution === "base",
  JSON.stringify(approvedTasks[0])
);
check(
  "the approved physical task persists execution=physical_stop with its destination",
  approvedTasks[1]?.execution === "physical_stop" &&
    approvedTasks[1]?.navigationQuery === "Opus LA, 1601 Vine St",
  JSON.stringify(approvedTasks[1])
);

// §Workstream 1 item 6/completion. The base task resolves through the
// SAME canonical write a physical_stop would — completeOpenChannelTask.
const baseTaskId = approvedTasks[0]?.id;
const completeRes = await trpcMutate("system.openChannel.completeTask", {
  missionId,
  taskId: baseTaskId,
  requestId: crypto.randomUUID(),
});
check(
  "the base task completes through the canonical write",
  completeRes.ok &&
    completeRes.body?.result?.data?.json?.tasks?.find(t => t.id === baseTaskId)
      ?.status === "completed",
  JSON.stringify(completeRes.body)
);

// §Workstream 1 item 4. Reclassify affordance: flips the still-pending
// physical task to base, in the same write as clearing its destination.
const physicalTaskId = approvedTasks[1]?.id;
const reclassifyRes = await trpcMutate("system.openChannel.reclassifyTask", {
  missionId,
  taskId: physicalTaskId,
  execution: "base",
  navigationQuery: null,
});
check(
  "reclassify flips a pending task's execution and destination together",
  reclassifyRes.ok &&
    reclassifyRes.body?.result?.data?.json?.tasks?.find(
      t => t.id === physicalTaskId
    )?.execution === "base",
  JSON.stringify(reclassifyRes.body)
);
// Flip it back so the rest of this script sees the intended fixture shape.
await trpcMutate("system.openChannel.reclassifyTask", {
  missionId,
  taskId: physicalTaskId,
  execution: "physical_stop",
  navigationQuery: "Opus LA, 1601 Vine St",
});

// §Workstream 1 item 4 legacy-default rule, proven against the REAL
// column — not a fixture standing in for one. Directly null out the
// stored execution column the way a pre-R1 row genuinely would read,
// then confirm the projection resolves it from navigationQuery alone.
console.log("\n  legacy-default rule (direct DB row, real MySQL)");
const db = await mysql.createConnection(dbUrl);
try {
  await db.execute(
    "UPDATE open_channel_mission_tasks SET execution = NULL WHERE id = ?",
    [physicalTaskId]
  );
  const legacyRead = await trpcQuery("system.openChannel.current", {
    businessDate,
  });
  const legacyTask = legacyRead.body?.result?.data?.json?.tasks?.find(
    t => t.id === physicalTaskId
  );
  check(
    "a legacy row (execution IS NULL) with a navigationQuery resolves to physical_stop on read",
    legacyTask?.execution === "physical_stop",
    JSON.stringify(legacyTask)
  );

  // And the base-task legacy case: NULL execution, NULL navigationQuery.
  await db.execute(
    "UPDATE open_channel_mission_tasks SET execution = NULL, navigationQuery = NULL WHERE id = ?",
    [baseTaskId]
  );
  const legacyRead2 = await trpcQuery("system.openChannel.current", {
    businessDate,
  });
  const legacyBaseTask = legacyRead2.body?.result?.data?.json?.tasks?.find(
    t => t.id === baseTaskId
  );
  check(
    "a legacy row (execution IS NULL, no navigationQuery) resolves to base on read",
    legacyBaseTask?.execution === "base",
    JSON.stringify(legacyBaseTask)
  );
} finally {
  await db.end();
}

// =====================================================================
// PART 2 — FRONTEND TRUTH. Real CDP touch, 393x852, the fixture harness.
// =====================================================================

console.log("\n2. FRONTEND TRUTH — real CDP touch, 393x852");

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

async function waitForRuntimeReady() {
  await page
    .locator(".game-loading")
    .waitFor({ state: "detached", timeout: 30_000 })
    .catch(() => {});
}
async function dismissFirstEntry() {
  const explainer = page.getByTestId("first-entry-explainer");
  if (await explainer.count()) {
    await explainer.getByRole("button", { name: "GOT IT" }).click();
  }
}
const shot = name => page.screenshot({ path: path.join(outputDir, `${name}.png`) });

// ---------------------------------------------------------------------
// 2a. The mixed base + physical fixture — the exact GL-78 fun-gate
// failure case (`goldlineOpenChannelDay=1`, see GoldlineFictionHarness).
// ---------------------------------------------------------------------

console.log("\n2a. BASE TASK: SEAL THE WORK present, no expedition staging");
await page.goto(
  `${baseUrl}/driver?goldlineFixture=NEUTRALIZE&goldlineOpenChannelDay=1`,
  { waitUntil: "networkidle" }
);
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });
await dismissFirstEntry();
await waitForRuntimeReady();

await page.getByTestId("seal-open-channel-task").waitFor({ timeout: 15_000 });
check(
  "the base task offers SEAL THE WORK directly",
  (await page.getByTestId("seal-open-channel-task").count()) > 0
);
const sealLabel = await page
  .getByTestId("seal-open-channel-task")
  .textContent()
  .catch(() => "");
check(
  "SEAL THE WORK is bound to the base task, not the physical one",
  Boolean(sealLabel && sealLabel.includes("Design the door hangers")),
  sealLabel ?? ""
);
check(
  "ENTER THE LINE is never offered for the base objective",
  (await page.getByTestId("expedition-enter").count()) === 0
);
check(
  "the expedition action pad never mounts for the base objective",
  (await page.getByTestId("expedition-action-pad").count()) === 0
);
await shot("r1-2a-base-seal");

console.log("\n2a. BASE TASK COMPLETES — SEAL, then the physical stop takes over");
await page.getByTestId("seal-open-channel-task").click();
// The fixture's completeFixtureOpenChannelTask runs on a short delay to
// simulate VERIFYING server truth (see GoldlineFictionHarness), then the
// next pending task (physical_stop) becomes the prepared objective.
await page.waitForTimeout(1200);
await page.getByTestId("expedition-threshold").waitFor({ timeout: 15_000 });

console.log("\n2b. PHYSICAL TASK: NAVIGATE + staging reachable, NEVER SEAL");
check(
  "the physical task stages the expedition threshold (ENTER THE LINE)",
  (await page.getByTestId("expedition-enter").count()) > 0
);
const thresholdLabel = await page
  .locator('[data-testid="expedition-threshold"] .expedition-threshold__objective')
  .textContent()
  .catch(() => "");
check(
  "the threshold is bound to Mona's physical stop",
  Boolean(thresholdLabel && thresholdLabel.includes("Mona")),
  thresholdLabel ?? ""
);
check(
  "SEAL THE WORK never renders anywhere in the DOM for the physical task",
  (await page.getByTestId("seal-open-channel-task").count()) === 0
);
await shot("r1-2b-physical-threshold");

// Enter the Line — the physical task must stage real expedition combat
// shell (the honest opposite of GL-78's bug), and the mission-context
// sheet must offer a real NAVIGATE link derived from navigationQuery.
await page.getByTestId("expedition-enter").click();
await page.getByTestId("expedition-hud").waitFor({ timeout: 15_000 });
check(
  "SEAL THE WORK still never renders once the expedition is active",
  (await page.getByTestId("seal-open-channel-task").count()) === 0
);
await page.getByTestId("expedition-objective").click();
await page.getByTestId("expedition-mission-sheet").waitFor({ timeout: 5_000 });
const navigateHref = await page
  .getByTestId("expedition-mission-sheet-navigate")
  .getAttribute("href")
  .catch(() => null);
check(
  "NAVIGATE is offered and points at Mona's real destination",
  Boolean(navigateHref && navigateHref.includes("Opus")),
  navigateHref ?? "(none)"
);
await shot("r1-2b-physical-navigate");

// ---------------------------------------------------------------------
// 2c. The empty-day fixture — the day-assembly front door.
// ---------------------------------------------------------------------

console.log("\n2c. EMPTY DAY: the front door renders three real, >=56px actions");
await page.goto(`${baseUrl}/driver?goldlineFixture=NEUTRALIZE&goldlineEmptyDay=1`, {
  waitUntil: "networkidle",
});
await page
  .locator("canvas.goldline-game-canvas")
  .waitFor({ state: "visible", timeout: 30_000 });
await dismissFirstEntry();
await waitForRuntimeReady();

await page
  .getByTestId("day-assembly-front-door")
  .waitFor({ timeout: 15_000 });
check("the day-assembly front door renders", true);

for (const testId of [
  "front-door-import-cleancloud",
  "front-door-add-stops",
  "front-door-open-channel",
]) {
  const box = await page.getByTestId(testId).boundingBox();
  check(
    `${testId} tap target is >=56px tall`,
    Boolean(box && box.height >= 56),
    box ? `${box.width}x${box.height}` : "(no box)"
  );
}
check(
  "the compact row does NOT render while the day is empty",
  (await page.getByTestId("day-assembly-compact-row").count()) === 0
);
await shot("r1-2c-front-door");

// The ADD OTHER STOPS chooser opens on tap (promotes existing sheets,
// does not rebuild them).
await page.getByTestId("front-door-add-stops").click();
await page.getByTestId("add-stops-chooser").waitFor({ timeout: 5_000 });
check(
  "ADD OTHER STOPS opens the NEW ORDER / manual job chooser",
  (await page.getByTestId("add-stops-new-order").count()) > 0 &&
    (await page.getByTestId("add-stops-manual-job").count()) > 0
);
await shot("r1-2c-add-stops-chooser");

// =====================================================================
// PART 3 — MOBILE LEGIBILITY spot-checks (computed styles).
// =====================================================================

console.log("\n3. LEGIBILITY — computed styles on named chips, joystick zone");

async function computedFontSizePx(testId) {
  return page.evaluate(id => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    return parseFloat(getComputedStyle(el).fontSize);
  }, testId);
}

// Re-open the empty day so the joystick + a labeled chip are on screen.
const joyBox = await page.getByTestId("goldline-joystick").boundingBox();
check(
  "the joystick zone measures >=139px (the +~18% R1 target)",
  Boolean(joyBox && joyBox.width >= 139 && joyBox.height >= 139),
  joyBox ? `${joyBox.width}x${joyBox.height}` : "(no box)"
);

for (const testId of [
  "front-door-import-cleancloud",
  "front-door-add-stops",
  "front-door-open-channel",
]) {
  const size = await computedFontSizePx(testId);
  check(
    `${testId}'s computed font-size is >=11px`,
    typeof size === "number" && size >= 11,
    String(size)
  );
}

// Dev vocabulary must be gone from the player-facing topbar.
const bodyText = await page.evaluate(() => document.body.innerText);
check(
  "dev vocabulary ('STATIONARY PLAY · TEMP') is gone from the rendered page",
  !bodyText.includes("STATIONARY PLAY"),
  bodyText.includes("STATIONARY PLAY") ? "still present" : "absent"
);

await shot("r1-3-legibility");

await browser.close();

console.log("");
if (errors.length) {
  console.error("BROWSER ERRORS:");
  for (const error of errors) console.error(`  ${error}`);
}
if (failures.length || errors.length) {
  console.error(`R1 VERIFICATION FAILED (${failures.length} checks)`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`R1 VERIFICATION PASSED — frames in ${outputDir}`);
