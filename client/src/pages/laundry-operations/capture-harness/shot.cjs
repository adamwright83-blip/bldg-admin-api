const { chromium } = require("/opt/npm-tools/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--no-sandbox"] }).catch(async () => chromium.launch({ args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"] }));
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on("console", m => { if (m.type()==="error") console.log("PAGEERR", m.text()); }); p.on("requestfailed", r => console.log("REQFAIL", r.url())); p.on("pageerror", e => console.log("PAGEEXC", e.message));
  await p.goto("http://127.0.0.1:8765/index.html"); await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await p.evaluate(() => { for (let i = 0; i < 40; i++) window.__s.renderFrame(0.1); });
  await p.evaluate(() => window.__s.renderFrame(0.016));
  await p.locator("#stage").screenshot({ path: process.argv[2] });
  await b.close();
})();
