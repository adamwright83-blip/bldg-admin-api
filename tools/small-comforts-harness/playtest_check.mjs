// Scripted sessions against the BUILT playtest preview, per input type. Game stepped by hand at 1/12 s (software GL).
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
import fs from "node:fs";
const MODE = process.env.MODE || "desktop";      // desktop | landscape | portrait
const PT = process.env.PT || "mirror-cold";      // mirror-cold | mirror-hinted
const BASE = process.env.BASE || "http://127.0.0.1:5201/";
const OUT = process.env.OUT || `/tmp/claude-0/ev_playtest/${MODE}_${PT}`;
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const cfg = {
  desktop: { viewport: { width: 960, height: 600 } },
  landscape: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
  portrait: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
}[MODE];
const touch = !!cfg.hasTouch;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext(cfg);
const page = await ctx.newPage();
const logs = [];
page.on("pageerror", e => logs.push("PAGEERROR: " + e.message.slice(0, 300)));
page.on("console", m => { if (m.type() === "error" && !/favicon|404/.test(m.text())) logs.push("CONSOLE: " + m.text().slice(0, 200)); });
page.on("response", r => { if (r.status() >= 400 && !/favicon/.test(r.url())) logs.push(`HTTP ${r.status()} ${r.url()}`); });
const cdp = touch ? await ctx.newCDPSession(page) : null;
await page.goto(`${BASE}?playtest=${PT}&spike=1&dt=0.4`, { waitUntil: "load" });
await page.waitForFunction(() => window.__smallComforts, null, { timeout: 60000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
// the entry must reach "hands free on the shelf" by itself, with nobody pressing anything
await page.waitForFunction(() => window.__playtest && window.__smallComforts.forage.stage === "idle", null, { timeout: 150000, polling: 150 });
await ev(() => { const g = window.__smallComforts; g.world.renderer.setAnimationLoop(null); g.clock.getDelta = () => 1 / 12; });
const advance = n => ev(n => { const g = window.__smallComforts; for (let i = 0; i < n; i++) g.frame(); }, n);
const proj = (code) => ev(`(() => { const g = window.__smallComforts; const v = (${code}); v.project(g.world.camera); const r = g.world.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; })()`);
const V = (x, y, z) => `g.world.camera.position.clone().set(${x},${y},${z})`;
const stage = () => ev(() => window.__smallComforts.forage.stage);
const mir = () => ev(() => { const m = window.__smallComforts.forage.mirror; return { phase: m.phase, outcome: m.outcome, tilt: +m.pose.tiltDeg.toFixed(1), x: +m.pose.x.toFixed(2) }; });
const until = async (pred, n, max, what) => { for (let i = 0; i < max; i += n) { await advance(n); if (await pred()) return; } throw new Error("never: " + what); };
const tap = async p => { if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); };
const tp = async (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
const dragSeq = async (from, to, steps) => {
  if (touch) { await tp("touchStart", [from]); for (let i = 1; i <= steps; i++) { await tp("touchMove", [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]); await advance(1); } await tp("touchEnd", []); }
  else { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await advance(1); } await page.mouse.up(); }
};
const floor = (x, z) => proj(V(x, 0.4, z));
const shot = async n => { await page.screenshot({ path: `${OUT}/${n}.png` }); };
const checks = [];
const check = (name, ok, info = "") => { checks.push({ name, ok: !!ok, info }); console.log(ok ? "PASS" : "FAIL", name, info); };

// 1. walk, pick up, haul home
await advance(24);
await tap(await proj("g.world.camera.position.clone().set(-4.6,-0.3,5.4)")); // an open patch of desk first: the first intentional move
await until(async () => (await stage()) === "idle", 6, 600, "walk marker");
await tap(await proj(`g.forage.shelf.props.get('brass_button').group.position.clone().add({x:0,y:0.3,z:0})`));
await until(async () => (await ev(() => window.__smallComforts.forage.carrying)) === "brass_button", 6, 900, "pickup");
await tap(await proj("g.forage.shelf.lipMarker.position.clone()"));
await until(async () => (await stage()) === "placing", 6, 2400, "haul home");
check("reaches placing by tapping only", true);
await advance(12);
await shot("01_placing_start");

// 2. cold: nothing may appear by itself. hinted: exactly one rocking cue after the delay, none before.
let cueBefore = await ev(() => window.__playtest.events.filter(e => e.type === "hint_cue").length);
await advance(12 * 8);
const textsIdle = await ev(() => window.__playtest.events.filter(e => e.type === "text_shown" && e.gt > window.__playtest.events.find(x => x.type === "placing_start").gt).length);
check("no text appears by itself during placement", textsIdle === 0, `texts=${textsIdle}`);
check("no cue before the delay (8 s idle)", cueBefore === 0 && (await ev(() => window.__playtest.events.filter(e => e.type === "hint_cue").length)) === 0);
await advance(12 * 16); // now ~25 s idle in placement
const cues = await ev(() => window.__playtest.events.filter(e => e.type === "hint_cue").length);
if (PT === "mirror-hinted") check("hinted: one cue after 20 s idle", cues === 1, `cues=${cues}`); else check("cold: still no cue after 25 s idle", cues === 0, `cues=${cues}`);
const poseA = await mir();
await advance(12 * 25); // ~50 s idle in placement: well past the base game's 40 s assist
const poseB = await mir();
const assistIdle = await ev(() => window.__playtest.events.some(e => e.type === "assist_fired"));
check("no assist fired by ~50 s idle (past the base game's 40 s)", !assistIdle);
check("button did not move by itself in 25 s of idle after that", poseA.x === poseB.x && poseA.tilt === poseB.tilt, JSON.stringify({ poseA, poseB }));
const cuesAfter = await ev(() => window.__playtest.events.filter(e => e.type === "hint_cue").length);
check(PT === "mirror-hinted" ? "hinted: still exactly one cue at ~50 s" : "cold: still no cue at ~50 s", cuesAfter === (PT === "mirror-hinted" ? 1 : 0), `cues=${cuesAfter}`);
check("meta says assist is disabled", (await ev(() => window.__playtest.meta.assistSeconds)) === null);

// 3. the player's hands: slide, wrong lifts, then settle on the light
let m = await mir();
await dragSeq(await floor(m.x, -1.2), await floor(1.0, -1.2), 14);
await advance(14);
check("slide moved the button into the beam", Math.abs((await mir()).x - 1.0) < 0.15, JSON.stringify(await mir()));
await dragSeq(await floor(1.0, -1.2), await floor(1.0, -0.5), 8);
await advance(14);
check("a lift produced a glance", (await mir()).outcome === "glance", JSON.stringify(await mir()));
await shot("02_glance");
await dragSeq(await floor(1.0, -1.2), await floor(1.0, 0.55), 12);
await advance(14);
const ds = await floor(1.0, 0.2);
if (touch) await tp("touchStart", [ds]); else { await page.mouse.move(ds.x, ds.y); await page.mouse.down(); }
for (let i = 1; i <= 40; i++) {
  const p = await floor(1.0, 0.2 - i * 0.045);
  if (touch) await tp("touchMove", [p]); else await page.mouse.move(p.x, p.y);
  await advance(1);
  if ((await mir()).outcome === "aligned") break;
}
if (touch) await tp("touchEnd", []); else await page.mouse.up();
await until(async () => (await stage()) === "reacting", 3, 600, "catch -> install");
check("light caught and mirror installed", (await ev(() => window.__smallComforts.episode.fixtures)).includes("signal_mirror"));
await shot("03_installed");

// 4. after success: touch the installed mirror, then something else
await until(async () => (await ev(() => window.__smallComforts.phase)) === "furnish", 6, 900, "back in furnish");
await advance(24);
await tap(await proj("g.world.camera.position.clone().set(1.0,0.5,-1.5)"));
await advance(6);
await tap(await proj("g.world.camera.position.clone().set(-1.5,0.05,0.5)"));
await advance(6);

// 5. read the recorder
const rec = await ev(() => window.__playtest.record());
const gtDerived = await ev(() => null); // (derivation by game clock is done offline below)
fs.writeFileSync(`${OUT}/session.json`, JSON.stringify(rec, null, 1));
const d = rec.derived, types = new Set(rec.events.map(e => e.type));
check("meta has build sha", rec.meta.buildSha && rec.meta.buildSha !== "unknown", rec.meta.buildSha);
check("meta has viewport + input", rec.meta.viewport.w === cfg.viewport.width && rec.meta.pointerTypes.length > 0, JSON.stringify({ v: rec.meta.viewport, p: rec.meta.pointerTypes, touch: rec.meta.touchCapable }));
check(`pointer type matches device (${touch ? "touch" : "mouse"})`, rec.meta.pointerTypes.includes(touch ? "touch" : "mouse"));
check("raw timeline has the core events", ["session_start", "walk_start", "pickup", "placing_start", "press", "release", "outcome", "catch", "installed", "canvas_down"].every(t => types.has(t)), [...types].join(","));
check("outcome sequence includes miss, glance, aligned", ["miss", "glance", "aligned"].every(o => d.outcomeSequence.some(x => x.outcome === o)), JSON.stringify(d.outcomeSequence.map(o => o.outcome)));
check("drag attempts counted", d.dragAttempts >= 4, `n=${d.dragAttempts}`);
check("installed-mirror touch recorded", d.installedMirrorTouchesAfter >= 1, `n=${d.installedMirrorTouchesAfter}`);
check("other interaction after install recorded", d.otherInteractionsAfterInstall.length >= 1, JSON.stringify(d.otherInteractionsAfterInstall));
check("hinted flag matches mode", d.hintCueShown === (PT === "mirror-hinted"));
check("derived assistFired is false", d.assistFired === false);
check("no page errors", logs.length === 0, logs.join(" | "));
fs.writeFileSync(`${OUT}/checks.json`, JSON.stringify({ MODE, PT, base: BASE, viewport: cfg.viewport, touch, checks, derived_wall_clock_meaningless_in_stepped_run: d }, null, 1));
console.log(`${MODE}/${PT}: ${checks.filter(c => c.ok).length}/${checks.length} passed`);
await browser.close();
