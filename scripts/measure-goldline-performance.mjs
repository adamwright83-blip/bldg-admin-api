import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const baseURL = process.env.GOLDLINE_PROOF_URL ?? "http://127.0.0.1:4177";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  const activeFrames = new Set();
  const activeTimers = new Set();
  const listeners = new WeakMap(); let activeListenerCount = 0; let duplicateListenerAttempts = 0;
  const raf = window.requestAnimationFrame.bind(window);
  const caf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = callback => { const id = raf(time => { activeFrames.delete(id); callback(time); }); activeFrames.add(id); return id; };
  window.cancelAnimationFrame = id => { activeFrames.delete(id); caf(id); };
  const timeout = window.setTimeout.bind(window); const clearTimeout = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...args) => { const id = timeout(() => { activeTimers.delete(id); fn(...args); }, ms); activeTimers.add(id); return id; };
  window.clearTimeout = id => { activeTimers.delete(id); clearTimeout(id); };
  const add = EventTarget.prototype.addEventListener; const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function(type, fn, options) { let byType = listeners.get(this); if (!byType) listeners.set(this, byType = new Map()); let set = byType.get(type); if (!set) byType.set(type, set = new Set()); if (set.has(fn)) duplicateListenerAttempts += 1; else { set.add(fn); activeListenerCount += 1; } return add.call(this, type, fn, options); };
  EventTarget.prototype.removeEventListener = function(type, fn, options) { const set = listeners.get(this)?.get(type); if (set?.delete(fn)) activeListenerCount -= 1; return remove.call(this, type, fn, options); };
  window.__goldlinePerf = { activeFrames, activeTimers, get activeListenerCount() { return activeListenerCount; }, get duplicateListenerAttempts() { return duplicateListenerAttempts; } };
});
const page = await context.newPage();
await page.request.post(`${baseURL}/api/auth/login`, { data: { password: "goldline-proof-admin-pass", role: "admin" } });
await page.goto(`${baseURL}/growth/lantern-city`);
await page.locator(".cr-world-camera").waitFor({ state: "visible", timeout: 20_000 });
const sample = () => page.evaluate(() => ({
  domNodes: document.querySelectorAll("*").length,
  debrisNodes: document.querySelectorAll(".lc-arcade-debris i").length,
  activeFrames: window.__goldlinePerf.activeFrames.size,
  activeTimers: window.__goldlinePerf.activeTimers.size,
  activeListeners: window.__goldlinePerf.activeListenerCount,
  duplicateListenerAttempts: window.__goldlinePerf.duplicateListenerAttempts,
  heap: performance.memory?.usedJSHeapSize ?? null,
}));
const before = await sample();
for (let i = 0; i < 30; i += 1) {
  await page.mouse.move(720, 430); await page.mouse.wheel(0, i % 2 ? 100 : -100);
  await page.mouse.down(); await page.mouse.move(700 + (i % 3) * 10, 420, { steps: 2 }); await page.mouse.up();
}
for (let i = 0; i < 22; i += 1) {
  await page.locator(".lc-pursued-building").first().click();
  await page.locator(".owi-close").click();
}
for (let i = 0; i < 12; i += 1) await page.locator(".lc-pursued-building").first().dispatchEvent("pointerdown", { altKey: true, pointerId: 200 + i, button: 0 });
await page.waitForTimeout(11_000);
const settled = await sample();
await page.goto(`${baseURL}/driver`); await page.waitForTimeout(800);
await page.goto(`${baseURL}/growth/lantern-city`); await page.locator(".cr-world-camera").waitFor({ state: "visible" }); await page.waitForTimeout(3000);
const remounted = await sample();
await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(4000);
const reducedMotion = await sample();
const result = { before, settled, remounted, reducedMotion, focusBackCycles: 22, fireRequests: 12, panZoomCycles: 30 };
await mkdir("artifacts/goldline-world-thinks-plays-back", { recursive: true });
await writeFile("artifacts/goldline-world-thinks-plays-back/performance.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await context.close(); await browser.close();
