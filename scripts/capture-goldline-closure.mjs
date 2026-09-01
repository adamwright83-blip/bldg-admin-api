import { chromium } from "@playwright/test";
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const baseURL = process.env.GOLDLINE_PROOF_URL ?? "http://127.0.0.1:4177";
const output = "artifacts/goldline-world-thinks-plays-back";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  recordVideo: { dir: output, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const video = page.video();
await page.addInitScript(() => {
  localStorage.setItem("goldline:day1:dismissed", "1");
  localStorage.setItem("goldline:onboarding:v1", JSON.stringify(["first_entry_explained"]));
});
await page.request.post(`${baseURL}/api/auth/login`, { data: { password: "pixel-driver-pass", role: "driver" } });
await page.goto(`${baseURL}/driver?fieldJournal=1`);
await page.getByTestId("journal-transcript").fill("Stopped at the Louise. Sarah wasn’t there. They said she should be back Wednesday. I told the desk I’d email her first.");
await page.waitForTimeout(1500);
await page.getByTestId("journal-save").click();
await page.getByRole("dialog", { name: /Capture what happened/i }).waitFor({ state: "hidden", timeout: 20_000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.goto(`${baseURL}/driver`);
await page.getByRole("region", { name: "Goldline global overworld" }).waitFor();
await page.getByRole("button", { name: "READ TODAY'S BRIEFING" }).click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "CLOSE BRIEFING" }).click();

await page.request.post(`${baseURL}/api/auth/login`, { data: { password: "goldline-proof-admin-pass", role: "admin" } });
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${baseURL}/growth/lantern-city?entity=22222222-2222-4222-8222-222222222222`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 20_000 });
await page.locator(".lc-tether").first().waitFor({ state: "attached", timeout: 10_000 });
await page.waitForTimeout(2500);
await page.locator(".owi-close").click().catch(() => {});
await page.mouse.move(720, 430);
await page.mouse.wheel(0, -480);
await page.mouse.down();
await page.mouse.move(610, 375, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1000);
const tower = page.locator(".lc-pursued-building").first();
await tower.click();
await page.waitForTimeout(1800);
await page.locator(".owi-close").click();
await page.waitForTimeout(1800);
await tower.dispatchEvent("pointerdown", { altKey: true, pointerId: 91, button: 0 });
await page.waitForTimeout(3500);
await page.locator(".lc-idle-flourish, .lc-idle-practice, .lc-idle-machinery").first().waitFor({ state: "attached", timeout: 12_000 }).catch(() => {});
await page.waitForTimeout(2500);

const evidence = await page.evaluate(async () => {
  const response = await fetch("/api/trpc/system.goldlineWorld.cityEntities", { credentials: "include" });
  const payload = await response.json();
  const entities = payload.result.data.json;
  const louise = entities.find(entity => entity.id === "22222222-2222-4222-8222-222222222222");
  return {
    physicalEntityId: louise.id,
    coordinates: louise.location,
    eventTypes: louise.events.map(event => event.eventType),
    obligationCount: louise.obligations?.count ?? 0,
    duplicateEntityCount: entities.filter(entity => entity.displayName.toLowerCase().includes("louise")).length,
  };
});
await writeFile(`${output}/cross-device-proof.json`, JSON.stringify(evidence, null, 2));
await page.close();
await context.close();
await browser.close();
await copyFile(await video.path(), `${output}/goldline-closure-demo.webm`);
console.log(JSON.stringify(evidence));
