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
    // artifact builds probe <name>.glb before <name>.glb.json, so a 404 there is expected
    if (m.type() === "error" && !m.text().includes("net::ERR_FAILED") && !m.text().includes("status of 404")) errors.push(m.text());
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
    } else if (mode === "sightlines") {
      // every 2 m: settle the gameplay camera and list what blocks the view of her chest
      const device = flag("desktop") ? DESKTOP : PHONE;
      const { context, page } = await openPage(browser, base, "?debug=1&gate=0&shot=overlook", device);
      const len = await page.evaluate(() => window.__coastalProof.state().routeLength);
      const blocked = [];
      for (let s = 2; s < len - 1; s += 2) {
        const { hits, ndc } = await page.evaluate(s => {
          window.__coastalProof.teleport(s);
          return { hits: window.__coastalProof.pick(), ndc: window.__coastalProof.chestNdc() };
        }, s);
        const solid = hits.filter(h => !["rope", "cloth_red", "cloth_cream", "cloth_blue", "glow", "iron"].includes(h.mat));
        if (solid.length) blocked.push({ s, hits: solid.map(h => `${h.mat ?? h.name}@${h.d}`).join(",") });
        // framing: her chest must be on screen, in front of the camera, in the lower half
        const [x, y, z] = ndc;
        if (!(z < 1 && Math.abs(x) < 0.6 && y < 0.1 && y > -0.95)) blocked.push({ s, framing: ndc });
      }
      console.log(JSON.stringify({ checked: Math.floor((len - 3) / 2), blocked }, null, 1));
      await context.close();
    } else if (mode === "qa") {
      // ad-hoc views: --queries "start=40&orbit=1.2;start=144" [--desktop]
      const device = flag("desktop") ? DESKTOP : PHONE;
      for (const q of opt("queries", "start=40").split(";")) {
        const { context, page, errors } = await openPage(browser, base, `?${q}&gate=0`, device);
        await page.waitForTimeout(Number(opt("wait", "2500")));
        const file = join(OUT, `qa-${q.replace(/[^a-z0-9]+/gi, "_")}.png`);
        await page.screenshot({ path: file });
        if (q.includes("debug=1")) {
          console.log(JSON.stringify(await page.evaluate(() => ({ cam: window.__coastalProof.state().camera, pos: window.__coastalProof.state().position, pick: window.__coastalProof.pick() }))));
        }
        console.log(`[qa] ${file}${errors.length ? ` errors: ${errors.join(" | ")}` : ""}`);
        await context.close();
      }
    } else if (mode === "gate") {
      // the real player path: tap to begin (audio unlock), walk with the keyboard, read the audio probe
      const { context, page, errors } = await openPage(browser, base, "", PHONE);
      await page.tap(".cmp-gate");
      await page.waitForTimeout(400);
      await page.keyboard.down("w");
      await page.waitForTimeout(4000);
      await page.keyboard.up("w");
      const s = await page.evaluate(() => ({ ...window.__coastalProof.state(), audio: window.__coastalProof.audio() }));
      // real touch: left thumb pushes the floating stick forward, right thumb drags to look
      const cdp = await context.newCDPSession(page);
      const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      const before = s.progress;
      await touch("touchStart", [{ x: 90, y: 700, id: 1 }]);
      for (let i = 1; i <= 6; i++) {
        await touch("touchMove", [{ x: 90, y: 700 - i * 10, id: 1 }]);
        await page.waitForTimeout(16);
      }
      await page.waitForTimeout(2500);
      const walked = await page.evaluate(() => window.__coastalProof.state());
      await touch("touchEnd", []);
      await page.waitForTimeout(300);
      const yaw0 = (await page.evaluate(() => window.__coastalProof.state())).cameraYaw;
      await touch("touchStart", [{ x: 300, y: 500, id: 2 }]);
      for (let i = 1; i <= 10; i++) {
        await touch("touchMove", [{ x: 300 - i * 12, y: 500, id: 2 }]);
        await page.waitForTimeout(16);
      }
      await touch("touchEnd", []);
      const yaw1 = (await page.evaluate(() => window.__coastalProof.state())).cameraYaw;
      const touchWalked = walked.progress - before;
      console.log(JSON.stringify({ keyboardProgress: s.progress, surface: s.surface, audio: s.audio, touchWalkedMetres: touchWalked, touchSpeed: walked.speed, lookYawChange: yaw1 - yaw0, errors }, null, 2));
      const ok = s.audio.started && s.audio.state === "running" && s.audio.steps > 3 && s.progress > 8 && touchWalked > 2 && Math.abs(yaw1 - yaw0) > 0.3;
      console.log(ok ? "[gate] OK" : "[gate] FAILED");
      if (!ok) process.exitCode = 1;
      await context.close();
    } else if (mode === "hero") {
      // Trailblazer from the gameplay camera, mid-walk: behind, behind-left, behind-right, plus side/front
      const views = [["behind", 0], ["behind-left", -0.62], ["behind-right", 0.62], ["side", -1.57], ["front", 3.14]];
      for (const [label, orbit] of views) {
        const { context, page } = await openPage(browser, base, `?autowalk=1&orbit=${orbit}&start=${opt("start", "28")}`, PHONE);
        await page.waitForTimeout(Number(opt("wait", "3200")));
        await page.screenshot({ path: join(OUT, `hero-${label}.png`) });
        console.log(`[hero] ${label}`);
        await context.close();
      }
    } else if (mode === "autowalk" || mode === "boot") {
      const device = flag("desktop") ? DESKTOP : PHONE;
      const extra = opt("query", "");
      const { context, page, errors } = await openPage(browser, base, `?autowalk=1&perf=1${extra ? `&${extra}` : ""}`, device, { video: flag("video") });
      const samples = [];
      const limit = mode === "boot" ? 6 : Number(opt("seconds", "180"));
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
        walkGroundSpeed: last?.walkGroundSpeed,
        footSlipMedian: last?.footSlip,
        fpsMin: Math.min(...fps),
        fpsMedian: fps.sort((a, b) => a - b)[Math.floor(fps.length / 2)],
        p95FrameMsWorst: Math.max(...p95),
        drawCallsMax: Math.max(...samples.map(s => s.perf.drawCalls)),
        trianglesMax: Math.max(...samples.map(s => s.perf.triangles)),
        errors,
      };
      console.log(JSON.stringify(summary, null, 2));
      const video = page.video();
      await context.close();
      if (video) console.log(`[video] ${await video.path()}`);
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
