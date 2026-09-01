import { chromium } from "@playwright/test";
import { mkdir, copyFile } from "node:fs/promises";
import { assertLocalProofUrl } from "./goldlineLocalProofTarget.mjs";

const baseURL = process.env.GOLDLINE_PROOF_URL ?? "http://127.0.0.1:4177";
assertLocalProofUrl(baseURL);

const output = "artifacts/goldline-territories-guardians";
await mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: output, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();

async function login(role, password) {
  const response = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { password, role },
  });
  if (!response.ok()) throw new Error(`${role} login failed: ${response.status()}`);
}

function unwrap(payload) {
  const data = payload?.result?.data;
  return data?.json ?? data;
}

await login("admin", "goldline-proof-admin-pass");
await page.goto(`${baseURL}/growth/guardians`);
await page.getByTestId("goldline-guardian-roster").waitFor({ timeout: 20_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${output}/guardian-roster.png`, fullPage: true });

await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await page.locator(".gl-territory-veil").first().waitFor({ state: "visible", timeout: 20_000 });
await page.waitForTimeout(1800);
await page.screenshot({ path: `${output}/admin-1440-veiled-territory.png` });

await page.mouse.move(720, 430);
await page.mouse.wheel(0, -420);
await page.mouse.down();
await page.mouse.move(640, 380, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(900);
await page.getByRole("button", { name: /over /i }).first().click();
await page.getByTestId("goldline-guardian-encounter").waitFor({ timeout: 15_000 });
await page.waitForTimeout(2200);
await page.screenshot({ path: `${output}/admin-1440-guardian-notice.png` });
await page.keyboard.press("Escape");

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
await login("driver", "pixel-driver-pass");
await mobile.addInitScript(() => {
  localStorage.setItem("goldline:day1:dismissed", "1");
  localStorage.setItem("goldline:onboarding:v1", JSON.stringify(["first_entry_explained"]));
});
await mobile.goto(`${baseURL}/driver`);
await mobile.getByRole("region", { name: "Goldline global overworld" }).waitFor({ timeout: 30_000 });
await mobile.getByTestId("goldline-driver-territory-guardian").waitFor({ timeout: 20_000 });
await mobile.waitForTimeout(1200);
await mobile.screenshot({ path: `${output}/driver-390-overland-guardian.png` });
await mobile.getByTestId("goldline-driver-territory-guardian").click();
await mobile.getByTestId("goldline-guardian-encounter").waitFor({ timeout: 15_000 });
await mobile.waitForTimeout(1800);
await mobile.screenshot({ path: `${output}/driver-390-encounter.png` });
await mobile.close();

await page.setViewportSize({ width: 1024, height: 768 });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${output}/admin-1024-intermediate.png` });

const territories = unwrap(
  await (
    await page.request.get(`${baseURL}/api/trpc/system.goldlineWorld.territories`)
  ).json()
);
const remaining = territories?.[0]?.state?.remainingMemberIds ?? [];
const entities = unwrap(
  await (
    await page.request.get(`${baseURL}/api/trpc/system.goldlineWorld.cityEntities`)
  ).json()
);
await login("driver", "pixel-driver-pass");
for (const memberId of remaining) {
  const entity = (entities ?? []).find(item => item.id === memberId);
  if (!entity) continue;
  const transcript = `Visited ${entity.displayName} at ${entity.pursuit?.address || entity.displayName}. The desk took my card and I walked the lobby myself.`;
  await page.request.post(`${baseURL}/api/trpc/system.commercialMission.saveSalesJournal`, {
    data: {
      json: {
        journalDate: new Date().toISOString().slice(0, 10),
        clientRequestId: crypto.randomUUID(),
        transcript,
      },
    },
  });
  await page.waitForTimeout(1500);
}

await login("admin", "goldline-proof-admin-pass");
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${output}/admin-1440-progress-cracks.png` });

const ready = unwrap(
  await (
    await page.request.get(`${baseURL}/api/trpc/system.goldlineWorld.territories`)
  ).json()
)?.[0];
if (ready && !ready.state.cleared && ready.state.confrontationReady) {
  await page.request.post(`${baseURL}/api/trpc/system.goldlineWorld.recordGuardianDefeat`, {
    data: {
      json: {
        territoryId: ready.definition.id,
        guardianId: ready.definition.guardianId,
        confrontationReady: true,
      },
    },
  });
}
await page.reload();
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${output}/admin-1440-cleared-reality.png` });

await page.close();
await context.close();
await browser.close();
if (video) {
  await copyFile(await video.path(), `${output}/goldline-territories-demo.webm`);
}
console.log("Wrote Goldline territories proof artifacts");
