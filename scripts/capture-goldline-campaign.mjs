import { chromium } from "@playwright/test";
import { mkdir, copyFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertLocalProofUrl } from "./goldlineLocalProofTarget.mjs";

const execFileAsync = promisify(execFile);
const baseURL = process.env.GOLDLINE_PROOF_URL ?? "http://127.0.0.1:4177";
assertLocalProofUrl(baseURL);

const output = "artifacts/goldline-city-authors-campaign";
await mkdir(output, { recursive: true });

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
  if (!response.ok()) throw new Error(`GET ${path} failed: ${response.status()}`);
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

function hold(ms) {
  return page.waitForTimeout(ms);
}

await login("driver", "pixel-driver-pass");
await page.addInitScript(() => {
  window.localStorage.setItem("goldline:day1:dismissed", "1");
  window.localStorage.setItem(
    "goldline:onboarding:v1",
    JSON.stringify(["first_entry_explained"])
  );
});
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${baseURL}/driver`);
await page.getByRole("region", { name: "Goldline global overworld" }).waitFor({
  state: "visible",
  timeout: 30_000,
});
await page.getByTestId("goldline-campaign-hud").waitFor({ state: "visible", timeout: 20_000 });
await hold(5000);
await page.screenshot({ path: `${output}/driver-390-campaign-home.png` });

await page.setViewportSize({ width: 1024, height: 768 });
await hold(2500);
await page.screenshot({ path: `${output}/driver-1024-campaign-thread.png` });

const before = await trpcGet("system.goldlineWorld.campaign");
await trpcPost("orders.create", {
  serviceType: "wash_fold",
  pickupDate: new Date().toISOString().slice(0, 10),
  pickupTimeWindow: "3:00-5:00 PM",
  address: "1450 S La Cienega Blvd, Los Angeles, CA",
  firstName: "Noon",
  lastName: "Window",
  phone: "3105550177",
});
const after = await trpcGet("system.goldlineWorld.campaign");
if (after?.campaign?.id !== before?.campaign?.id) {
  throw new Error("Campaign identity changed after a real order arrived");
}

await login("admin", "goldline-proof-admin-pass");
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await page.getByTestId("goldline-campaign-hud").waitFor({ state: "visible", timeout: 20_000 });
await hold(6000);
await page.screenshot({ path: `${output}/admin-1440-campaign-gold-line.png` });

const adminCampaign = await trpcGet("system.goldlineWorld.campaign");
if (adminCampaign?.campaign?.id !== before?.campaign?.id) {
  throw new Error("Admin did not share the driver campaign identity");
}

await page.reload();
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 30_000 });
await hold(4000);
await page.screenshot({ path: `${output}/admin-1440-campaign-reload.png` });

await page.close();
await context.close();
await browser.close();
if (video) {
  const source = await video.path();
  await copyFile(source, `${output}/goldline-campaign-demo.webm`);
  const dest = `${output}/goldline-campaign-demo.webm`;
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
  console.log(
    JSON.stringify({
      demo: dest,
      bytes: info.size,
      seconds,
      campaignId: after?.campaign?.id,
      revision: after?.campaign?.revision,
    })
  );
}
