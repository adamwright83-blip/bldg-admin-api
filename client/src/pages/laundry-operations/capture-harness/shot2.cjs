const { chromium } = require("/opt/npm-tools/node_modules/playwright-core");
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist","--no-sandbox"] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on("console", m => { const t = m.text(); if (/CITYERR|lantern\]|error/i.test(t)) console.log("PAGE:", t.slice(0, 200)); }); p.on("pageerror", e => console.log("PAGEEXC", e.message)); p.on("requestfailed", r => console.log("REQFAIL", r.url()));
  await p.goto("http://127.0.0.1:8765/index.html"); await p.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__cityReady && window.__cityReady(), null, { timeout: 120000 }).catch(() => console.log("city not ready"));
  const pos = await p.evaluate(() => { const w = window.__w; return { keys: w.keys(), l: w.lanternAt("louise") }; }); console.log("POS", JSON.stringify(pos));
  const arg = JSON.parse(process.argv[3] || "{}");
  await p.evaluate((a) => { const w = window.__w; const l = w.lanternAt("louise"); if (l) w.jump(l.x, l.z, a.dist || 700, a.pitch || 0.8); for (let i = 0; i < 30; i++) w.renderFrame(1/30); for (let i = 0; i < 40; i++) window.__s.renderFrame(0.1); }, arg);
  await p.evaluate(() => { window.__w.renderFrame(1/30); window.__s.renderFrame(0.016); });
  await p.locator("#stage").screenshot({ path: process.argv[2] });
  await b.close();
})();
