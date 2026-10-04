// Deterministic capture: the game's clock is replaced by a fixed 1/12 s step and advanced by hand,
// so software-GL slowness never changes what the player experiences. Every captured frame is one real game frame.
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";
const OUT = process.env.OUT || "/tmp/claude-0/ev_mirror_det";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT + "/frames", { recursive: true });
fs.mkdirSync(OUT + "/stills", { recursive: true });
const viewport = { width: 840, height: 520 };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport });
const page = await ctx.newPage();
const logs = [];
page.on("pageerror", e => logs.push("PAGEERROR: " + e.message.slice(0, 300)));
page.on("console", m => { if (m.type() === "error") logs.push("CONSOLE: " + m.text().slice(0, 200)); });
await page.goto("http://127.0.0.1:5199/?spike=1&dt=0.4", { waitUntil: "load" });
await page.waitForFunction(() => window.__smallComforts, null, { timeout: 60000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const until = (fn, arg, timeout = 150000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const proj = (code) => ev(`(() => { const g = window.__smallComforts; const v = (${code}); v.project(g.world.camera); const r = g.world.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; })()`);
const V = (x, y, z) => `g.world.camera.position.clone().set(${x},${y},${z})`;

const snap = () => ev(() => {
  const g = window.__smallComforts, m = g.forage.mirror;
  const vis = id => { const e = g.ui.querySelector(id); return e && e.classList.contains("show") ? e.textContent.trim() : ""; };
  return { simT: +g.time.toFixed(2), phase: g.phase, stage: g.forage.stage, mirror: { phase: m.phase, outcome: m.outcome, x: +m.pose.x.toFixed(2), tilt: +m.pose.tiltDeg.toFixed(1), assisted: m.assisted, stuckFor: +m.stuckFor.toFixed(1) }, text: { toast: vis("#toast"), hint: vis("#hint"), story: vis("#story") } };
});

let fi = 0; const timeline = []; const labels = {};
const advance = n => ev(n => { const g = window.__smallComforts; for (let i = 0; i < n; i++) g.frame(); }, n);
/** step n game frames, capture the last one; the capture stands for `n` frames of playback */
const cap = async (n = 1, label) => {
  await advance(n);
  const name = `f${String(fi).padStart(5, "0")}.png`;
  await page.screenshot({ path: `${OUT}/frames/${name}` });
  const s = await snap();
  timeline.push({ i: fi, name, frames: n, ...s, label });
  if (label) { fs.copyFileSync(`${OUT}/frames/${name}`, `${OUT}/stills/${label}.png`); labels[label] = s; console.log("STILL", label, JSON.stringify({ simT: s.simT, stage: s.stage, mirror: s.mirror, text: s.text })); }
  fi++;
  return s;
};
const stepUntil = async (pred, every, maxFrames, label) => {
  let used = 0, s;
  while (used < maxFrames) { s = await cap(every); used += every; if (pred(s)) return s; }
  throw new Error("stepUntil exhausted: " + (label || "") + " last=" + JSON.stringify(s));
};

// ---- real-time setup (not part of the evidence clip): intro, open the case, step outside
await ev(() => window.__smallComforts.begin());
await ev(() => window.__smallComforts.skipIntro());
await until(() => window.__smallComforts.phase === "closed");
await ev(() => window.__smallComforts.openCase());
await until(() => window.__smallComforts.phase === "furnish");
await page.waitForTimeout(1000);
await page.click("#btn-out");
await until(() => window.__smallComforts.forage.stage === "idle");
// freeze the loop; from here every game frame is stepped by hand at exactly 1/12 s
await ev(() => { const g = window.__smallComforts; g.world.renderer.setAnimationLoop(null); g.clock.getDelta = () => 1 / 12; });
console.log("windowCut:", await ev(() => window.__smallComforts.world.windowCut), "residents:", await ev(() => window.__smallComforts.episode.residents.map(r => r.guest).join(",")));
await cap(6);

// ---- CLIP STARTS: tap the oversized brass button
const bp = await proj(`g.forage.shelf.props.get('brass_button').group.position.clone().add({x:0,y:0.3,z:0})`);
await page.mouse.click(bp.x, bp.y);
await stepUntil(s => s.stage === "inspecting", 6, 900, "walk to button");
await stepUntil(s => s.stage === "idle", 6, 300, "inspect");
await cap(6, "01_carrying_the_oversized_button");
const carrying = await ev(() => window.__smallComforts.forage.carrying);
console.log("carrying:", carrying);

// ---- haul home
const lp = await proj("g.forage.shelf.lipMarker.position.clone()");
await page.mouse.click(lp.x, lp.y);
await stepUntil(s => s.stage === "placing", 6, 2400, "haul home");
await cap(12);
await cap(12, "02_set_down_flat_outside_the_beam");

// ---- the player's hands: real mouse drag, anywhere on the canvas
const floor = (x, z) => proj(V(x, 0.4, z));
const dragTo = async (from, to, frames, every = 1, endLabel) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await cap(1);
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(from.x + (to.x - from.x) * i / frames, from.y + (to.y - from.y) * i / frames);
    await cap(every);
  }
  await page.mouse.up();
};
const cur = async () => (await snap()).mirror;

// A: slide it into the beam (still too flat)
let m = await cur();
await dragTo(await floor(m.x, -1.2), await floor(1.0, -1.2), 14);
await cap(14, "03_wrong_a_in_the_beam_but_too_flat");
// B: lift a little: light hits it and flicks to the wrong place
m = await cur();
await dragTo(await floor(1.0, -1.2), await floor(1.0, -0.5), 8);
await cap(14, "04_wrong_b_light_hits_but_flicks_off");
// C: too steep: flicks the other way
await dragTo(await floor(1.0, -1.2), await floor(1.0, 0.55), 12);
await cap(14, "05_wrong_c_too_steep");
// D: ease the front edge back down, as a player would, until the light lands
const ds = await floor(1.0, 0.2);
await page.mouse.move(ds.x, ds.y); await page.mouse.down(); await cap(1);
let aligned = false;
for (let i = 1; i <= 40 && !aligned; i++) {
  const z = 0.2 - i * 0.045;
  const p = await floor(1.0, z);
  await page.mouse.move(p.x, p.y);
  const s = await cap(1);
  if (s.mirror.outcome === "aligned") aligned = true;
  if (i === 1) console.log("D start", JSON.stringify(s.mirror));
}
await page.mouse.up();
console.log("aligned during drag:", aligned);
// the player lets go; the light holds. Frame-by-frame through the catch.
await cap(1, "06a_aha_first_frame_after_letting_go");
for (let i = 0; i < 10; i++) await cap(1);
await cap(1, "06b_aha_light_on_the_lid");
await stepUntil(s => s.stage === "fixing", 1, 200, "caught -> fixing");
await cap(6, "07_proprietor_wedges_it_in_place");
await stepUntil(s => s.stage === "reacting", 3, 400, "fixing -> installed");
await cap(1, "08_installed_conductor_about_to_react");
await cap(18, "09_conductor_reacts");
await stepUntil(s => s.stage === "reacting" && false || s.phase === "furnish", 6, 800, "reaction -> furnish");
await cap(24, "10_back_in_furnish_mirror_installed");
const end = await ev(() => { const g = window.__smallComforts; const e = g.episode; return { fixtures: e.fixtures, routines: e.routines, placements: e.placements, saved: localStorage.getItem("sc.save")?.includes("signal_mirror") }; });
console.log("EPISODE:", JSON.stringify(end));
fs.writeFileSync(OUT + "/timeline.json", JSON.stringify({ timeline, labels, end }, null, 0));

// ---- persistence: hard reload in the same browser profile
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__smallComforts, null, { timeout: 60000 });
await ev(() => window.__smallComforts.begin());
await ev(() => window.__smallComforts.skipIntro());
await until(() => ["closed", "furnish"].includes(window.__smallComforts.phase));
if ((await ev(() => window.__smallComforts.phase)) === "closed") { await ev(() => window.__smallComforts.openCase()); await until(() => window.__smallComforts.phase === "furnish"); }
await page.waitForTimeout(2000);
await ev(() => { const g = window.__smallComforts; g.world.renderer.setAnimationLoop(null); g.clock.getDelta = () => 1 / 12; });
await advance(24);
await page.screenshot({ path: `${OUT}/stills/11_after_reload_mirror_persists.png` });
const after = await ev(() => { const g = window.__smallComforts; return { fixtures: g.episode.fixtures, placements: g.episode.placements, routines: g.episode.routines, mirrorBuilt: g.fixtureWorks.has("signal_mirror") }; });
console.log("AFTER RELOAD:", JSON.stringify(after));
fs.writeFileSync(OUT + "/after_reload.json", JSON.stringify(after));
console.log("frames captured:", fi, "errors:", logs.join(" | ") || "none");
await ctx.close(); await browser.close();
