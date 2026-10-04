// Render the scripted clip frame-by-frame (deterministic t), then encode with ffmpeg.
// Usage: node scripts/record.mjs [seconds=20] [fps=30] [out=shots/clip.mp4]
import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
const dur = Number(process.argv[2] || 20), fps = Number(process.argv[3] || 30), out = process.argv[4] || "/tmp/laundry-shots/clip.mp4";
const scale = Number(process.env.SCALE || 1);
rmSync("/tmp/laundry-shots/frames", { recursive: true, force: true });
mkdirSync("/tmp/laundry-shots/frames", { recursive: true });
const server = await createServer({ root: new URL("..", import.meta.url).pathname, server: { port: 5199, host: "127.0.0.1" }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.HOME + "/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
await page.goto(`http://127.0.0.1:5199/capture-harness/index.html?capture=1&dpr=${scale}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
const n = Math.round(dur * fps);
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  await page.evaluate((t) => window.__frame(t), i / fps);
  await page.screenshot({ path: `/tmp/laundry-shots/frames/${String(i).padStart(5, "0")}.png` });
  if (i % 60 === 0) console.log(`frame ${i}/${n} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
await server.close();
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-framerate", String(fps), "-i", "/tmp/laundry-shots/frames/%05d.png",
  "-vf", "scale=1920:1080:flags=lanczos", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]);
console.log("wrote", out, ((Date.now() - t0) / 1000).toFixed(0) + "s");
