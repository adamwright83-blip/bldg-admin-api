// Quick look: a few spots, optional vibe, on the GPU. usage: node cpe-quick.mjs <outDir> [zombie] [spot,spot...]
import { chromium } from "@playwright/test";
import fs from "node:fs";
const out = process.argv[2];
const zombie = process.argv[3] === "zombie";
const only = (process.argv[4] ?? "lobby,laundry,pool,party").split(",");
fs.mkdirSync(out, { recursive: true });
const SPOTS = { lobby: [0, 20, -2.2], laundry: [1, 4.5, -2.2], gym: [1, 13, -2.2], pool: [2, 11, -2.6], lounge: [2, 34, -2.6], mail: [0, 12, -2.2], package: [0, 4, -2.2], spa: [1, 34, -2.4] };
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto("http://localhost:5178/growth/lantern-city?level=century-park-east");
await page.waitForFunction(() => window.__centuryParkEast?.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__centuryParkEast.calm());
const vibe = await page.locator('[data-testid="century-park-east-3d"]').getAttribute("data-vibe");
if ((vibe === "zombie") !== zombie) await page.getByTestId("century-park-east-vibe").click();
await page.waitForTimeout(800);
for (const name of only) {
  if (name === "party") { await page.evaluate(() => window.__centuryParkEast.finale()); await page.waitForTimeout(4500); }
  else { const [f, x, z] = SPOTS[name]; await page.evaluate(([f, x, z]) => window.__centuryParkEast.teleport(f, x, z), [f, x, z]); await page.waitForTimeout(1800); }
  await page.screenshot({ path: `${out}/${zombie ? "z-" : ""}${name}.png` });
}
console.log("fps:", await page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); const tick = () => (performance.now() - t0 < 2000 ? (n++, requestAnimationFrame(tick)) : res(Math.round(n / 2))); requestAnimationFrame(tick); })));
console.log("pageerrors:", errors.length ? errors : "none");
await browser.close();
