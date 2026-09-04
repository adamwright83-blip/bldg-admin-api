import { chromium } from "@playwright/test";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertLocalProofUrl } from "./goldlineLocalProofTarget.mjs";

const execFileAsync = promisify(execFile);
const baseURL = process.env.GOLDLINE_PROOF_URL ?? "http://127.0.0.1:4177";
assertLocalProofUrl(baseURL);

const output = "artifacts/goldline-territories-guardians";
await mkdir(output, { recursive: true });

const HUNT_FIXTURE = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    name: "La Cienega Court",
    address: "1520 S La Cienega Blvd, Los Angeles, CA",
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    name: "The Marble Arms",
    address: "1530 S La Cienega Blvd, Los Angeles, CA",
  },
  {
    id: "44444444-4444-4444-8444-444444444443",
    name: "Sunwell House",
    address: "1540 S La Cienega Blvd, Los Angeles, CA",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Orchard Place",
    address: "1550 S La Cienega Blvd, Los Angeles, CA",
  },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: output, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();

function unwrap(payload) {
  const data = payload?.result?.data;
  return data?.json ?? data;
}

async function login(role, password) {
  const response = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { password, role },
  });
  if (!response.ok()) throw new Error(`${role} login failed: ${response.status()}`);
}

async function trpcGet(path) {
  const response = await page.request.get(`${baseURL}/api/trpc/${path}`);
  if (!response.ok()) {
    throw new Error(`GET ${path} failed: ${response.status()}`);
  }
  return unwrap(await response.json());
}

async function trpcPost(path, json) {
  const response = await page.request.post(`${baseURL}/api/trpc/${path}`, {
    data: { json },
  });
  const payload = await response.json();
  if (!response.ok()) {
    throw new Error(`POST ${path} failed: ${response.status()} ${JSON.stringify(payload)}`);
  }
  return unwrap(payload);
}

async function waitForMemberCompleted(physicalEntityId, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const list = await trpcGet("system.goldlineWorld.territories");
    if (list.some(item => item.state.completedMemberIds.includes(physicalEntityId))) {
      return;
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`Territory member ${physicalEntityId} never completed`);
}

async function hold(ms) {
  await page.waitForTimeout(ms);
}

async function waitUntilChronicleGone(timeoutMs = 28_000) {
  const started = Date.now();
  let clearSince = null;
  while (Date.now() - started < timeoutMs) {
    const overlayCount = await page.getByTestId("goldline-celebration").count();
    const labelVisible = await page
      .getByText("Goldline Chronicle", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    const visible = overlayCount > 0 || labelVisible;
    if (visible) {
      clearSince = null;
    } else if (clearSince == null) {
      clearSince = Date.now();
    } else if (Date.now() - clearSince >= 1_200) {
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error("Goldline chronicle overlay never stayed gone");
}

await login("admin", "goldline-proof-admin-pass");
await page.goto(`${baseURL}/growth/guardians`);
await page.getByTestId("goldline-guardian-roster").waitFor({ timeout: 20_000 });
await hold(4_000);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/guardian-roster.png`, fullPage: true });

await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await page.locator(".gl-territory-veil").first().waitFor({ state: "visible", timeout: 20_000 });
await hold(5_000);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/admin-1440-veiled-territory.png` });

await page.mouse.move(720, 430);
await page.mouse.wheel(0, -420);
await page.mouse.down();
await page.mouse.move(640, 380, { steps: 10 });
await page.mouse.up();
await hold(1_200);
await page.getByRole("button", { name: /over /i }).first().click();
await page.getByTestId("goldline-guardian-encounter").waitFor({ timeout: 15_000 });
await page.getByTestId("goldline-guardian-linehook").waitFor({ timeout: 8_000 }).catch(() => {});
await hold(6_000);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/admin-1440-guardian-notice.png` });
await page.keyboard.press("Escape");
await hold(1_200);

await page.setViewportSize({ width: 390, height: 844 });
await login("driver", "pixel-driver-pass");
await page.addInitScript(() => {
  localStorage.setItem("goldline:day1:dismissed", "1");
  localStorage.setItem("goldline:onboarding:v1", JSON.stringify(["first_entry_explained"]));
});
await page.goto(`${baseURL}/driver`);
await page.getByRole("region", { name: "Goldline global overworld" }).waitFor({ timeout: 30_000 });
await page.getByTestId("goldline-driver-territory-guardian").waitFor({ timeout: 20_000 });
await hold(4_000);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/driver-390-overland-guardian.png` });
await page.getByTestId("goldline-driver-territory-guardian").click();
await page.getByTestId("goldline-guardian-encounter").waitFor({ timeout: 15_000 });
await hold(4_500);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/driver-390-encounter.png` });
await page.keyboard.press("Escape");
await hold(800);

await login("admin", "goldline-proof-admin-pass");
await page.setViewportSize({ width: 1024, height: 768 });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await hold(4_000);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/admin-1024-intermediate.png` });

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await hold(2_000);

const territories = await trpcGet("system.goldlineWorld.territories");
const remaining = territories?.[0]?.state?.remainingMemberIds ?? [];
if (remaining.length === 0) {
  throw new Error("Capture expected an uncleared hunt; remainingMemberIds was empty");
}

await login("driver", "pixel-driver-pass");
for (const memberId of remaining) {
  const fixture = HUNT_FIXTURE.find(item => item.id === memberId);
  if (!fixture) {
    throw new Error(`No hunt fixture for remaining member ${memberId}`);
  }
  await trpcPost("system.commercialMission.saveSalesJournal", {
    journalDate: new Date().toISOString().slice(0, 10),
    clientRequestId: crypto.randomUUID(),
    transcript: `Visited ${fixture.name} at ${fixture.address}. The desk took my card and I walked the lobby myself.`,
  });
  await waitForMemberCompleted(memberId);
  await login("admin", "goldline-proof-admin-pass");
  await page.reload();
  await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
  await hold(2_200);
  await login("driver", "pixel-driver-pass");
}

await login("admin", "goldline-proof-admin-pass");
await page.reload();
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await hold(4_000);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/admin-1440-progress-cracks.png` });

const ready = (await trpcGet("system.goldlineWorld.territories"))?.[0];
if (!ready) throw new Error("No territory after hunt visits");
if (!ready.state.cleared && !ready.state.confrontationReady) {
  throw new Error("Hunt visits did not derive confrontation readiness");
}
if (!ready.state.cleared) {
  const defeat = await trpcPost("system.goldlineWorld.recordGuardianDefeat", {
    territoryId: ready.definition.id,
    guardianId: ready.definition.guardianId,
    confrontationReady: true,
  });
  if (defeat?.recorded === false) {
    throw new Error(`Guardian defeat refused: ${JSON.stringify(defeat)}`);
  }
}
await page.reload();
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await hold(5_000);
await waitUntilChronicleGone();
await page.screenshot({ path: `${output}/admin-1440-cleared-reality.png` });

await page.close();
await context.close();
await browser.close();
if (video) {
  const source = await video.path();
  await copyFile(source, `${output}/goldline-territories-demo.webm`);
  const dest = `${output}/goldline-territories-demo.webm`;
  const info = await stat(dest);
  let seconds = null;
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      dest,
    ]);
    seconds = Number.parseFloat(stdout.trim());
  } catch {
    seconds = null;
  }
  if (seconds != null && (seconds < 45 || seconds > 90)) {
    throw new Error(`Demo video must be 45–90s; got ${seconds.toFixed(1)}s (${info.size} bytes)`);
  }
  console.log(
    `Wrote Goldline territories proof artifacts; demo ${seconds == null ? "duration unknown" : `${seconds.toFixed(1)}s`}, ${info.size} bytes`
  );
} else {
  console.log("Wrote Goldline territories proof artifacts");
}
