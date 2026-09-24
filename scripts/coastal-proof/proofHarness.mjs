#!/usr/bin/env node
/**
 * Coastal Market proof harness: serves the standalone preview build and drives
 * it in Playwright Chromium on the Mac's GPU (--use-angle=metal).
 *
 *   npx vite build --config vite.coastal-proof-preview.config.ts
 *   node scripts/coastal-proof/proofHarness.mjs shots   [--out dir]
 *   node scripts/coastal-proof/proofHarness.mjs autowalk [--throttle 4] [--video]
 *   node scripts/coastal-proof/proofHarness.mjs boot     (CI-safe: loads, walks 5 s, asserts progress)
 *
 * Every number this prints is EMULATION: Chromium on this machine with the
 * listed flags, viewport, DPR and CPU throttle. It is not a phone.
 */
import { createServer } from "node:http";
import { readFile, mkdir, stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const mode = args[0] ?? "shots";
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = name => args.includes(`--${name}`);

const ROOT = resolve(opt("dir", "tmp/coastal-proof-preview-build"));
const OUT = resolve(opt("out", "tmp/coastal-proof-captures"));
const THROTTLE = Number(opt("throttle", mode === "autowalk" ? "4" : "1"));
const GPU = !flag("swiftshader");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".glb": "model/gltf-binary", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg",
  ".wasm": "application/wasm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".ktx2": "image/ktx2",
};

function serve(root) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let path = join(root, decodeURIComponent(url.pathname));
    try {
      if ((await stat(path)).isDirectory()) path = join(path, "index.html");
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise(ok => server.listen(0, "127.0.0.1", () => ok(server)));
}

const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };

async function launch() {
  return chromium.launch({
    headless: true,
    args: GPU ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader=false"] : [],
  });
}

async function openPage(browser, base, query, device, { video } = {}) {
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch,
    ...(video ? { recordVideo: { dir: OUT, size: { width: device.width, height: device.height } } } : {}),
  });
  const page = await context.newPage();
  // hermetic: only the local build is reachable (web fonts fall back)
  await page.route(url => !url.href.startsWith(base), route => route.abort());
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => {
    // the only external request (web fonts) is aborted on purpose
    if (m.type() === "error" && !m.text().includes("net::ERR_FAILED")) errors.push(m.text());
  });
  if (THROTTLE > 1) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }
  page.on("console", m => {
    if (flag("console")) console.log(`[console.${m.type()}] ${m.text()}`);
  });
  await page.goto(`${base}/index.html${query}`);
  try {
    await page.waitForFunction(() => window.__coastalProof?.ready === true, null, { timeout: 90_000 });
  } catch (err) {
    const text = await page.evaluate(() => document.body.innerText).catch(() => "");
    throw new Error(`proof never became ready. page text: ${text.slice(0, 300)} errors: ${errors.join(" | ")}`);
  }
  return { context, page, errors };
}

function env(device) {
  return `Playwright Chromium headless ${GPU ? "--use-angle=metal (M1 GPU)" : "SwiftShader"}, ` +
    `${device.width}x${device.height} DPR ${device.deviceScaleFactor}${device.isMobile ? " mobile+touch" : ""}, CPU throttle ${THROTTLE}x`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await serve(ROOT);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await launch();
  try {
    if (mode === "shots") {
      for (const [label, device] of [["phone", PHONE], ["desktop", DESKTOP]]) {
        for (const shot of ["overlook", "descent", "waterfront"]) {
          const { context, page, errors } = await openPage(browser, base, `?shot=${shot}&perf=${flag("perf") ? 1 : 0}`, device);
          await page.waitForTimeout(1500);
          const file = join(OUT, `${label}-${shot}.png`);
          await page.screenshot({ path: file });
          console.log(`[shot] ${file}${errors.length ? `  errors: ${errors.join(" | ")}` : ""}`);
          await context.close();
        }
      }
    } else if (mode === "autowalk" || mode === "boot") {
      const device = flag("desktop") ? DESKTOP : PHONE;
      const { context, page, errors } = await openPage(browser, base, "?autowalk=1&perf=1", device, { video: flag("video") });
      const samples = [];
      const limit = mode === "boot" ? 6 : 180;
      const started = Date.now();
      for (let t = 0; t < limit; t++) {
        await page.waitForTimeout(1000);
        const s = await page.evaluate(() => ({ ...window.__coastalProof.state(), perf: window.__coastalProof.perf() }));
        samples.push(s);
        if (flag("verbose")) console.log(`[t=${t + 1}s] s=${s.progress.toFixed(1)} ${s.kind} fps=${s.perf.fps.toFixed(0)} p95=${s.perf.p95FrameMs.toFixed(1)} draws=${s.perf.drawCalls}`);
        if (flag("stills") && t % 8 === 3) await page.screenshot({ path: join(OUT, `walk-${String(t + 1).padStart(3, "0")}.png`) });
        if (s.autowalkFinished) break;
      }
      const last = samples.at(-1);
      const fps = samples.slice(2).map(s => s.perf.fps).filter(Boolean);
      const p95 = samples.slice(2).map(s => s.perf.p95FrameMs).filter(Boolean);
      const summary = {
        environment: env(device),
        gpu: last?.perf.gpu,
        routeLength: last?.routeLength,
        reachedProgress: last?.progress,
        finished: last?.autowalkFinished,
        autowalkSeconds: last?.autowalkSeconds,
        wallSeconds: (Date.now() - started) / 1000,
        fpsMin: Math.min(...fps),
        fpsMedian: fps.sort((a, b) => a - b)[Math.floor(fps.length / 2)],
        p95FrameMsWorst: Math.max(...p95),
        drawCallsMax: Math.max(...samples.map(s => s.perf.drawCalls)),
        trianglesMax: Math.max(...samples.map(s => s.perf.triangles)),
        errors,
      };
      console.log(JSON.stringify(summary, null, 2));
      await context.close();
      if (mode === "boot") {
        const ok = errors.length === 0 && last && last.progress > 4;
        if (!ok) {
          console.error("[boot] FAILED");
          process.exitCode = 1;
        } else {
          console.log("[boot] OK");
        }
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
