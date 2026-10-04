import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
const OUT = "/tmp/claude-0/ev";
const MODE = process.env.MODE || "desktop"; // desktop | landscape | portrait
const cfg = {
  desktop: { viewport: { width: 900, height: 560 } },
  landscape: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
  portrait: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 },
}[MODE];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ ...cfg, recordVideo: MODE === "desktop" ? { dir: OUT + "/video", size: cfg.viewport } : undefined });
const page = await ctx.newPage();
const logs = [];
page.on("pageerror", e => logs.push("PAGEERROR: " + e.message.slice(0, 300)));
page.on("response", r => { if (r.status() >= 400) logs.push(`HTTP ${r.status()} ${r.url()}`); });
await page.goto("http://127.0.0.1:5199/?spike=1&dt=0.4", { waitUntil: "load" });
await page.waitForFunction(() => window.__smallComforts, null, { timeout: 60000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const until = (fn, arg, timeout = 150000) => page.waitForFunction(fn, arg, { timeout, polling: 150 });
const shot = async n => { await page.screenshot({ path: `${OUT}/${MODE}_${n}.png` }); console.log("shot", n); };
const proj = (code) => ev(`(() => { const g = window.__smallComforts; const v = (${code}); v.project(g.world.camera); const r = g.world.renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; })()`);
const tap = async (x, y) => (cfg.hasTouch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
const tapWorld = async (code) => { const p = await proj(code); await tap(p.x, p.y); };
const press = async sel => { if (cfg.hasTouch) await page.tap(sel); else await page.click(sel); };
const toast = () => ev(() => window.__smallComforts.ui.querySelector("#toast").textContent);
const state = () => ev(() => { const g = window.__smallComforts; return { phase: g.phase, stage: g.forage.stage, carrying: g.forage.carrying, fixtures: g.episode.fixtures, routines: g.episode.routines }; });
const OBJ = (id) => `g.forage.shelf.props.get('${id}').group.position.clone().add({x:0,y:0.3,z:0})`;
const LIP = "g.forage.shelf.lipMarker.position.clone()";

// the game is entered the normal way: tap-to-begin chain, latch, furnish
await ev(() => window.__smallComforts.begin());
await ev(() => window.__smallComforts.skipIntro());
await until(() => window.__smallComforts.phase === "closed");
await ev(() => window.__smallComforts.openCase());
await until(() => window.__smallComforts.phase === "furnish");
await page.waitForTimeout(1200);
await shot("01_furnish_step_outside_button");
await press("#btn-out");
await until(() => window.__smallComforts.forage.stage === "idle");
await page.waitForTimeout(800);
await shot("02_on_the_shelf");

// walk: tap open desk, capture mid-walk
const wp = await proj(`g.world.camera.position.clone().set(-4.6,-0.3,5.4)`);
await tap(wp.x, wp.y);
await page.waitForTimeout(700);
await shot("03_walking_to_marker");
await until(() => window.__smallComforts.forage.stage === "idle");

if (process.env.QUICK) {
  // touch sanity: walk toward the right edge a few times and watch the camera follow
  await ev(() => window.__smallComforts.ui.querySelector("#toast").classList.remove("show"));
  for (let i = 0; i < 3; i++) { await tap(cfg.viewport.width - 24, Math.round(cfg.viewport.height * 0.62)); await page.waitForTimeout(2500); }
  await shot("03b_followed_right");
  await tapWorld(`g.forage.shelf.tin.position.clone().add({x:0,y:1.4,z:0})`);
  await until(() => /sealed/.test(window.__smallComforts.ui.querySelector("#toast").textContent) && window.__smallComforts.forage.stage === "idle");
  await ev(() => { const g = window.__smallComforts; g.toast("A tin can the size of a water tower. The lid is sealed. Not yet."); });
  await ev(() => window.__smallComforts.toast("A tin can the size of a water tower. The lid is sealed. Not yet."));
await shot("04_tin_can_sealed_tease");
  await tapWorld(OBJ("thread_spool"));
  await until(() => window.__smallComforts.forage.carrying === "thread_spool");
  await page.waitForTimeout(400);
  await shot("05_pushing_spool_touch");
  await press("#btn-home");
  await until(() => window.__smallComforts.forage.stage === "tinkering");
  await until(() => window.__smallComforts.phase === "furnish");
  await page.waitForTimeout(3000);
  await shot("06_resident_reaction_touch");
  console.log("QUICK done", JSON.stringify(await state()), logs.join("|") || "no errors");
  await ctx.close(); await browser.close(); process.exit(0);
}
// tin can tease
await tapWorld(`g.forage.shelf.tin.position.clone().add({x:0,y:1.4,z:0})`);
await until(() => /sealed/.test(window.__smallComforts.ui.querySelector("#toast").textContent) && window.__smallComforts.forage.stage === "idle");
await shot("04_tin_can_sealed_tease");

// ---- trip 1: thimble (carry), with carry-one rejection and put-it-down
await tapWorld(OBJ("thimble"));
await until(() => window.__smallComforts.forage.stage === "inspecting");
await shot("05_inspecting_thimble");
await until(() => window.__smallComforts.forage.carrying === "thimble");
await page.waitForTimeout(500);
await shot("06_carrying_thimble_overhead");
await tapWorld(OBJ("brass_button"));
await page.waitForTimeout(500);
console.log("REJECTION TOAST:", await toast(), "| visible class:", await ev(() => window.__smallComforts.ui.querySelector("#toast").className));
await ev(() => window.__smallComforts.toast("Your hands are full. Carry the silver thimble home, or put it down."));
await shot("07_carry_one_rejection");
await press("#btn-drop");
await page.waitForTimeout(500);
console.log("after put-down:", JSON.stringify(await state()));
await shot("08_put_it_down");
// pick it back up (it was set down ahead of the proprietor)
const thPos = await ev(() => { const p = window.__smallComforts.forage.shelf.props.get("thimble").group.position; return { x: p.x, z: p.z }; });
await tapWorld(OBJ("thimble"));
await until(() => window.__smallComforts.forage.carrying === "thimble");
await tapWorld(LIP);
await until(() => window.__smallComforts.forage.stage === "entering");
await page.waitForTimeout(500);
await shot("09_hopping_back_over_the_lip");
await until(() => window.__smallComforts.forage.stage === "tinkering");
await page.waitForTimeout(1600);
await shot("10_tinkering_it_into_a_stove");
await until(() => window.__smallComforts.forage.stage === "reacting");
await page.waitForTimeout(1500);
await shot("11_resident_reacts_stove");
await until(() => window.__smallComforts.phase === "furnish");
await page.waitForTimeout(3500);
await shot("12_resident_settled_stove");
console.log("after thimble:", JSON.stringify(await state()));

// ---- trip 2: spool (push/roll)
await press("#btn-out");
await until(() => window.__smallComforts.forage.stage === "idle");
await tapWorld(OBJ("thread_spool"));
await until(() => window.__smallComforts.forage.carrying === "thread_spool");
await tapWorld("g.forage.shelf.lipMarker.position.clone().add({x:2.5,y:0,z:2.2})");
await page.waitForTimeout(1800);
await shot("13_pushing_spool");
await tapWorld(LIP);
await until(() => window.__smallComforts.forage.stage === "tinkering");
await until(() => window.__smallComforts.phase === "furnish");
await page.waitForTimeout(3500);
await shot("14_resident_settled_stool");
console.log("after spool:", JSON.stringify(await state()));

// ---- trip 3: button
await press("#btn-out");
await until(() => window.__smallComforts.forage.stage === "idle");
await tapWorld(OBJ("brass_button"));
await until(() => window.__smallComforts.forage.carrying === "brass_button");
await page.waitForTimeout(400);
await shot("15_carrying_button_overhead");
await tapWorld(LIP);
await until(() => window.__smallComforts.phase === "furnish");
await page.waitForTimeout(3500);
await shot("16_resident_settled_mirror");
console.log("after button:", JSON.stringify(await state()));

// ---- reload persistence
await page.reload({ waitUntil: "load" });
await page.waitForFunction(() => window.__smallComforts, null, { timeout: 60000 });
console.log("after reload (pre-start):", JSON.stringify(await state()));
await ev(() => window.__smallComforts.begin()); await ev(() => window.__smallComforts.skipIntro());
await until(() => window.__smallComforts.phase === "closed"); await ev(() => window.__smallComforts.openCase());
await until(() => window.__smallComforts.phase === "furnish");
await page.waitForTimeout(3500);
await shot("17_after_reload_fixtures_and_routine_persist");
// shelf after reload: all objects consumed, tin can still there
await press("#btn-out");
await until(() => window.__smallComforts.forage.stage === "idle");
await page.waitForTimeout(600);
await shot("18_after_reload_shelf_emptied_tin_remains");
console.log(logs.join("\n") || "no page errors / no HTTP >=400");
await ctx.close(); await browser.close();
