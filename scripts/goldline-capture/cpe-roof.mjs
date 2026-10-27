// climbs the laundry rope for real and walks the roof, like the e2e does, on the GPU
import { chromium } from "@playwright/test";
const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; page.on("pageerror", e => errors.push(String(e)));
await page.goto("http://localhost:5178/growth/lantern-city?level=century-park-east");
await page.waitForFunction(() => window.__centuryParkEast?.ready, null, { timeout: 120000 });
const h = fn => page.evaluate(fn);
await h(() => window.__centuryParkEast.calm());
const ropes = await h(() => window.__centuryParkEast.ropes);
await page.evaluate(r => window.__centuryParkEast.teleport(r.floor, r.x + 0.6, r.z), ropes[1]);
await page.waitForTimeout(600);
console.log("prompt at the laundry rope:", (await h(() => window.__centuryParkEast.state())).prompt);
await page.getByTestId("century-park-east-prompt").click();
for (let i = 0; i < 60 && (await h(() => window.__centuryParkEast.state())).floor !== 2; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(40); }
const landed = await h(() => window.__centuryParkEast.state());
console.log("landed:", landed.floor, landed.x.toFixed(2), landed.z.toFixed(2));
await page.waitForTimeout(1500);
await page.screenshot({ path: "./shots-v4/roof-landing.png" });
const walk = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); return h(() => window.__centuryParkEast.state()); };
const east0 = await walk("KeyD", 600); console.log("east from the landing:", east0.x.toFixed(2), east0.z.toFixed(2));
const fwd = await walk("KeyS", 400); console.log("forward:", fwd.x.toFixed(2), fwd.z.toFixed(2));
const east = await walk("KeyD", 700); console.log("east:", east.x.toFixed(2), east.z.toFixed(2));
const west = await walk("KeyA", 1000); console.log("west:", west.x.toFixed(2), west.z.toFixed(2), "floor", west.floor);
await page.waitForTimeout(800);
await page.screenshot({ path: "./shots-v4/roof-walked.png" });
console.log("pageerrors:", errors.length ? errors : "none");
await browser.close();
