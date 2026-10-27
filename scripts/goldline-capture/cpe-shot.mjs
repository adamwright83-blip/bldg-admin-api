// Captures Century Park East at real resolution on the Metal GPU and measures the frame rate per spot.
// usage: node cpe-shot.mjs <outDir> [phone]
import { chromium } from "@playwright/test";
import fs from "node:fs";

const out = process.argv[2];
const phone = process.argv[3] === "phone";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const ctx = await browser.newContext(
  phone ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.goto("http://localhost:5178/growth/lantern-city?level=century-park-east");
await page.waitForFunction(() => window.__centuryParkEast?.ready, null, { timeout: 120000 });
await page.evaluate(() => window.__centuryParkEast.calm());
const renderer = await page.evaluate(() => {
  const c = document.querySelector('[data-testid="century-park-east-canvas"]');
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  const i = gl.getExtension("WEBGL_debug_renderer_info");
  return i ? gl.getParameter(i.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});
console.log("renderer:", renderer);
const fps = async () =>
  page.evaluate(
    () =>
      new Promise(res => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (performance.now() - t0 < 2000 ? (n++, requestAnimationFrame(tick)) : res(Math.round(n / 2)));
        requestAnimationFrame(tick);
      })
  );
const spots = [
  ["lobby", 0, 20, -2.2],
  ["package-room", 0, 4, -2.2],
  ["leasing", 0, 34, -2.2],
  ["laundry", 1, 4.5, -2.2],
  ["gym", 1, 13, -2.2],
  ["closets", 1, 22.5, -2.0],
  ["dog-spa", 1, 34, -2.4],
  ["pool", 2, 11, -2.6],
  ["sky-lounge", 2, 34, -2.6],
];
for (const [name, f, x, z] of spots) {
  await page.evaluate(([f, x, z]) => window.__centuryParkEast.teleport(f, x, z), [f, x, z]);
  await page.waitForTimeout(1800);
  const r = await fps();
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name}: ${r} fps`);
}
// zombie night
await page.getByTestId("century-park-east-vibe").click();
await page.evaluate(() => window.__centuryParkEast.teleport(0, 12, -2.2));
await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/zombie-mailroom.png` });
await page.evaluate(() => window.__centuryParkEast.teleport(1, 13, -2.2));
await page.waitForTimeout(1800);
await page.screenshot({ path: `${out}/zombie-gym.png` });
console.log("zombie:", await fps(), "fps");
await page.getByTestId("century-park-east-vibe").click();
// the finale
await page.evaluate(() => window.__centuryParkEast.finale());
await page.waitForTimeout(4500);
await page.screenshot({ path: `${out}/party.png` });
console.log("party:", await fps(), "fps");
console.log("pageerrors:", errors.length ? errors : "none");
await browser.close();
