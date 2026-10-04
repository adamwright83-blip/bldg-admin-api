// Usage: node scripts/shot.mjs [out.png] [query]
// Spins up Vite in-process, renders one deterministic frame at 1920x1080 (2x supersampled), saves PNG.
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] || "/tmp/laundry-shots/frame.png";
const query = process.argv[3] || "";
const scale = Number(process.env.SCALE || 2);
mkdirSync("/tmp/laundry-shots", { recursive: true });

const server = await createServer({ root: new URL("..", import.meta.url).pathname, server: { port: 5199, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:5199/capture-harness/index.html?capture=1&dpr=${scale}&${query}`);
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
} catch (e) {
  console.log("TIMEOUT. errors:\n" + errors.join("\n"));
  await page.screenshot({ path: "/tmp/laundry-shots/_timeout.png" });
  process.exit(1);
}
await page.evaluate(() => document.fonts.ready);
await page.evaluate((t) => window.__frame(t), Number(process.env.T || 1));
await page.waitForTimeout(150);
await page.screenshot({ path: out });
if (errors.length) console.log("ERRORS:\n" + errors.join("\n"));
console.log("saved", out);
await browser.close();
await server.close();
