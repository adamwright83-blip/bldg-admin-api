// Usage: node scripts/shots.mjs prefix t1 t2 ...  -> shots/<prefix>_<t>.png at 1920x1080
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [prefix, ...ts] = process.argv.slice(2);
const scale = Number(process.env.SCALE || 1);
mkdirSync("/tmp/laundry-shots", { recursive: true });
const server = await createServer({ root: new URL("..", import.meta.url).pathname, server: { port: 5199, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
await page.goto(`http://127.0.0.1:5199/capture-harness/index.html?capture=1&dpr=${scale}&${process.env.Q || ''}`);
try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }); }
catch { console.log("TIMEOUT", errors.join("\n")); process.exit(1); }
await page.evaluate(() => document.fonts.ready);
for (const t of ts) {
  await page.evaluate((t) => window.__frame(t), Number(t));
  await page.screenshot({ path: `/tmp/laundry-shots/${prefix}_${t}.png` });
}
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
await browser.close();
await server.close();
