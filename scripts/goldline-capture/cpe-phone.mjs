// Century Park East on a phone: portrait, touch, the phone quality tier. Captures and frame rate.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.goto("http://localhost:5178/growth/lantern-city?level=century-park-east");
await page.waitForFunction(() => window.__centuryParkEast?.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__centuryParkEast.calm());
console.log("coarse:", await page.evaluate(() => matchMedia("(pointer: coarse)").matches), JSON.stringify(await page.evaluate(() => window.__centuryParkEast.perf())));
const fps = async () =>
  page.evaluate(
    () =>
      new Promise(res => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (performance.now() - t0 < 3000 ? (n++, requestAnimationFrame(tick)) : res(Math.round(n / 3)));
        requestAnimationFrame(tick);
      })
  );
for (const [name, f, x, z] of [["lobby", 0, 20, -2.2], ["gym", 1, 13, -2.2], ["pool", 2, 11, -2.6]]) {
  await page.evaluate(([f, x, z]) => window.__centuryParkEast.teleport(f, x, z), [f, x, z]);
  await page.waitForTimeout(1800);
  console.log(`${name}: ${await fps()} fps`);
  await page.screenshot({ path: `${out}/phone-${name}.png` });
}
console.log("pageerrors:", errors.length ? errors : "none");
await browser.close();
