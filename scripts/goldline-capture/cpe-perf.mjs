// Prices each quality tier of Century Park East on the Metal GPU, next to Beverly Hills as the baseline.
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"] });
const fps = page =>
  page.evaluate(
    () =>
      new Promise(res => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (performance.now() - t0 < 3000 ? (n++, requestAnimationFrame(tick)) : res(Math.round(n / 3)));
        requestAnimationFrame(tick);
      })
  );
const run = async (url, readyFn, perfFn) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(readyFn, null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  const f = await fps(page);
  const info = perfFn ? await page.evaluate(perfFn) : null;
  await ctx.close();
  return { f, info };
};
const cpeReady = () => window.__centuryParkEast?.ready;
const cpePerf = () => window.__centuryParkEast.perf?.();
for (const tier of ["", "phone", "flat"]) {
  const r = await run(`http://localhost:5178/growth/lantern-city?level=century-park-east${tier ? `&cpeTier=${tier}` : ""}`, cpeReady, cpePerf);
  console.log(`CPE ${tier || "desktop"}: ${r.f} fps`, JSON.stringify(r.info));
}
const bh = await run("http://localhost:5178/growth/lantern-city?level=beverly-hills", () => window.__beverlyHills?.ready, null);
console.log(`Beverly Hills baseline: ${bh.f} fps`);
await browser.close();
