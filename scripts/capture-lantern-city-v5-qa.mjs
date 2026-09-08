#!/usr/bin/env node
/**
 * Capture Lantern City v5 browser QA screenshots against the proof server.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const baseURL = process.env.GOLDLINE_SMOKE_BASE_URL ?? "http://127.0.0.1:4177";
const adminPassword = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";
const outDir = join(process.cwd(), "artifacts/lantern-city-v5-qa");

const views = [
  { name: "01-default-1920x1080", width: 1920, height: 1080 },
  { name: "02-default-1440x900", width: 1440, height: 900 },
  { name: "03-default-1280x900", width: 1280, height: 900 },
];

async function login(page) {
  const login = await page.request.post(`${baseURL}/api/auth/login`, {
    data: { password: adminPassword, role: "admin" },
  });
  if (!login.ok()) throw new Error(await login.text());
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  for (const view of views) {
    const page = await browser.newPage({ viewport: { width: view.width, height: view.height } });
    await login(page);
    await page.goto(`${baseURL}/growth/lantern-city`);
    await page.locator(".lc-page").waitFor({ state: "visible", timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.screenshot({
      path: join(outDir, `${view.name}.png`),
      fullPage: false,
    });
    await page.close();
  }

  const detailPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await login(detailPage);
  await detailPage.goto(`${baseURL}/growth/lantern-city`);
  await detailPage.locator(".lc-page").waitFor({ state: "visible", timeout: 60000 });
  await detailPage.waitForTimeout(3000);

  const targets = [
    { name: "04-opus-tower", selector: ".cr-world-tower-anchor:has(.pwc-building.opus), .pwc-building.opus" },
    { name: "05-cpe-tower", selector: ".cr-world-tower-anchor:has(.pwc-building.cpe), .pwc-building.cpe" },
    { name: "06-frontier-object", selector: ".lc-frontier-object" },
    { name: "09-territory-gel-cooling", selector: ".lc-territory-gel.state-cooling, .lc-territory-gel.state-at_risk" },
    { name: "10-legend-open", selector: ".lc-v5-legend" },
  ];
  for (const target of targets) {
    const locator = detailPage.locator(target.selector).first();
    if (await locator.count()) {
      await locator.scrollIntoViewIfNeeded();
      await detailPage.waitForTimeout(800);
      const box = await locator.boundingBox();
      if (box) {
        await detailPage.screenshot({
          path: join(outDir, `${target.name}.png`),
          clip: {
            x: Math.max(0, box.x - 180),
            y: Math.max(0, box.y - 220),
            width: Math.min(1920, box.width + 360),
            height: Math.min(1080, box.height + 440),
          },
        });
      }
    }
  }

  await detailPage.screenshot({
    path: join(outDir, "07-command-deck-hud.png"),
    clip: { x: 0, y: 0, width: 1920, height: 220 },
  });
  await detailPage.screenshot({
    path: join(outDir, "08-command-deck-bottom.png"),
    clip: { x: 0, y: 820, width: 1920, height: 260 },
  });
  // Territory-state readability: the state summary the layer computed.
  const gelSummary = await detailPage.evaluate(() => {
    const out = {};
    for (const gel of document.querySelectorAll(".lc-territory-gel")) {
      const state = gel.getAttribute("data-visual-state");
      out[state] = (out[state] ?? 0) + 1;
    }
    return {
      gels: out,
      nameplates: document.querySelectorAll(".lc-territory-nameplate").length,
      lanterns: document.querySelectorAll(".lc-v5-lantern").length,
      utilitiesVisible: Boolean(document.querySelector(".gl-world-utility-menu")),
      truthDrawerVisible: Boolean(document.querySelector(".lc-v5-drawer")),
    };
  });
  console.log(JSON.stringify(gelSummary, null, 2));

  await browser.close();
  console.log(`Wrote Lantern City QA screenshots to ${outDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
