import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const baseURL = process.env.GOLDLINE_SMOKE_BASE_URL ?? "http://127.0.0.1:4188";
const out = join(process.cwd(), "artifacts/lantern-city-v6-revival-qa");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const consoleErrors = [];
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
page.on("console", msg => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", e => consoleErrors.push(String(e)));
const login = await page.request.post(`${baseURL}/api/auth/login`, { data: { password: "goldline-proof-admin-pass", role: "admin" } });
if (!login.ok()) throw new Error("login failed");
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator('[data-scene-id="opus_la"]').waitFor();
await page.waitForFunction(() => Array.from(document.querySelectorAll('[data-lantern-city="v6"] img')).every(img => img.complete));
await page.screenshot({ path: join(out, "01-full-city-1920.png") });

const brokenImages = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[data-lantern-city="v6"] img')).filter(i => !i.naturalWidth).map(i => i.src)
);

// 02: infested mid-city with customers -- zoom via bounding box screenshot
const midCity = page.locator('[data-scene-id="territory:mid-city"]');
await midCity.scrollIntoViewIfNeeded();
await midCity.screenshot({ path: join(out, "02-infested-with-customers.png") });

// 03: infested zero-customers west-hollywood
const westHollywood = page.locator('[data-scene-id="territory:west-hollywood"]');
await westHollywood.screenshot({ path: join(out, "03-infested-zero-customers.png") });

// 04: OPUS golf driver
const opus = page.locator('[data-scene-id="opus_la"]');
await opus.screenshot({ path: join(out, "04-opus-golf-driver.png") });

// 05/06: ordinary single-address lantern click -> direct inspector (downtown, active)
const lantern = page.locator('[data-scene-id="territory:downtown"]');
await lantern.scrollIntoViewIfNeeded();
await page.screenshot({ path: join(out, "05-lantern-before-click.png") });
await lantern.click({ timeout: 8000 });
await page.locator(".owi").waitFor({ timeout: 8000 });
await page.screenshot({ path: join(out, "06-lantern-inspector-after-click.png") });
await page.keyboard.press("Escape");
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator('[data-scene-id="opus_la"]').waitFor();

// ordinary cooling lantern (los-feliz) -> direct inspector
await page.locator('[data-scene-id="territory:los-feliz"]').click({ timeout: 8000 });
await page.locator(".owi").waitFor({ timeout: 8000 });
const coolingLanternOk = await page.locator(".owi").isVisible();
await page.keyboard.press("Escape");
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator('[data-scene-id="opus_la"]').waitFor();

// multi-address aggregate lantern (mid-city, 5 physical addresses) -> address chooser
await page.locator('[data-scene-id="territory:mid-city"]').click({ timeout: 8000 });
await page.getByRole("dialog", { name: /^Customers in / }).waitFor({ timeout: 8000 });
const addressChooserOk = await page.getByRole("dialog", { name: /^Customers in / }).isVisible();
const addressButtons = await page.getByRole("dialog", { name: /^Customers in / }).locator("button").count();
await page.keyboard.press("Escape");
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator('[data-scene-id="opus_la"]').waitFor();

// 07/08: OPUS tower click
await page.screenshot({ path: join(out, "07-opus-tower-before.png") });
await page.locator('[data-scene-id="opus_la"] [data-scene-target="tower"]').click();
await page.waitForURL(/tower-wars\?building=opus_la/);
await page.locator(".tw-arena").waitFor({ timeout: 20000 });
await page.screenshot({ path: join(out, "08-opus-tower-wars-after.png") });

// 09: OPUS light click
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator('[data-scene-id="opus_la"] [data-scene-target="light"]').click();
await page.locator(".owi").waitFor();
await page.screenshot({ path: join(out, "09-opus-light-inspector-after.png") });
await page.keyboard.press("Escape");
await page.goto(`${baseURL}/growth/lantern-city`);

// 10-13: frontier objects
for (const [id, filename] of [
  ["territory:west-hollywood", "10-west-hollywood-balloon.png"],
  ["territory:east-hollywood", "11-east-hollywood-helicopter.png"],
  ["territory:echo-park", "12-echo-park-toy-flight.png"],
  ["territory:arts-district", "13-arts-district-expedition.png"],
]) {
  const el = page.locator(`[data-scene-id="${id}"]`);
  await el.screenshot({ path: join(out, filename) });
}

// 14: frontier click -> territory room
await page.locator('[data-scene-id="territory:east-hollywood"]').click();
await page.getByRole("dialog").waitFor();
await page.screenshot({ path: join(out, "14-frontier-territory-room-after-click.png") });
await page.keyboard.press("Escape");
await page.goto(`${baseURL}/growth/lantern-city`);

// CPE weapon
const cpe = page.locator('[data-scene-id="century_park_east"]');
await cpe.screenshot({ path: join(out, "cpe-weapon.png") });

// V5 fallback
await page.goto(`${baseURL}/growth/lantern-city?scene=v5`);
const v5Ok = await page.locator(".lc-page.lc-v5-game").isVisible();
const v6Gone = (await page.locator('[data-lantern-city="v6"]').count()) === 0;

// 15/16: responsive
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator('[data-scene-id="opus_la"]').waitFor();
await page.screenshot({ path: join(out, "15-full-city-1440.png") });
const collisions1440 = await page.evaluate(() => {
  const rect = el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; };
  const overlaps = (a,b) => a.x<b.x+b.w && a.x+a.w>b.x && a.y<b.y+b.h && a.y+a.h>b.y;
  const objects = Array.from(document.querySelectorAll("[data-scene-object]")).map(rect);
  const hud = Array.from(document.querySelectorAll('[class*="identity"],[class*="quest"],[class*="controls"],[class*="deck"]')).map(rect);
  let n = 0;
  for (const o of objects) for (const h of hud) if (overlaps(o,h)) n++;
  return n;
});

await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator('[data-scene-id="opus_la"]').waitFor();
await page.screenshot({ path: join(out, "16-full-city-1280.png") });
const roach1280 = await page.evaluate(() => Array.from(document.querySelectorAll('[class*="props"] img')).filter(i => i.src.includes("cockroach")).length);
const rat1280 = await page.evaluate(() => Array.from(document.querySelectorAll('[class*="props"] img')).filter(i => i.src.includes("rat")).length);

writeFileSync(join(out, "report.json"), JSON.stringify({
  brokenImages, consoleErrors, collisions1440, roach1280, rat1280, v5Ok, v6Gone,
  coolingLanternOk, addressChooserOk, addressButtons,
}, null, 2));
console.log(JSON.stringify({ brokenImages, consoleErrors, collisions1440, roach1280, rat1280, v5Ok, v6Gone, coolingLanternOk, addressChooserOk, addressButtons }, null, 2));
await browser.close();
