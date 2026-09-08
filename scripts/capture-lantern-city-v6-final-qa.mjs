import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const baseURL = process.env.GOLDLINE_SMOKE_BASE_URL ?? "http://127.0.0.1:4188";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname))
  throw new Error("V6 pilot-art QA requires a local server");
const out = join(process.cwd(), "artifacts/lantern-city-v6-final-qa");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const reports = [];
try {
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 900],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    const login = await page.request.post(`${baseURL}/api/auth/login`, {
      data: {
        password: process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass",
        role: "admin",
      },
    });
    if (!login.ok()) throw new Error("Local proof login failed");
    await page.goto(`${baseURL}/growth/lantern-city`);
    await page.locator('[data-scene-id="opus_la"]').waitFor();
    await page.waitForFunction(() =>
      Array.from(
        document.querySelectorAll('[data-lantern-city="v6"] img')
      ).every(img => img.complete)
    );
    await page.screenshot({ path: join(out, `${width}x${height}.png`) });
    const layout = await page.evaluate(() => {
      const rect = el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      const overlaps = (a, b) =>
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      const objects = Array.from(
        document.querySelectorAll("[data-scene-object]")
      ).map(el => ({ id: el.dataset.sceneId, rect: rect(el) }));
      const hudZoneEls = Array.from(
        document.querySelectorAll(
          '[class*="identity"],[class*="quest"],[class*="controls"],[class*="deck"]'
        )
      );
      const hud = hudZoneEls.map((el, i) => ({ id: `hud:${i}`, rect: rect(el) }));
      const plates = Array.from(
        document.querySelectorAll("[data-state-plate]")
      ).map(el => ({
        territoryId: el.dataset.statePlate,
        environment: el.dataset.environment,
        artStatus: el.dataset.artStatus,
        src: el.querySelector("img")?.getAttribute("src") ?? null,
      }));
      return {
        objects,
        hud,
        plates,
        collisions: objects.flatMap((o, i) =>
          [...hud, ...objects.slice(i + 1)]
            .filter(p => overlaps(o.rect, p.rect))
            .map(p => [o.id, p.id])
        ),
        brokenImages: Array.from(
          document.querySelectorAll('[data-lantern-city="v6"] img')
        )
          .filter(i => !i.naturalWidth)
          .map(i => i.src),
        legacyClasses: document.querySelectorAll(
          '[data-lantern-city="v6"] .lc-lantern, [data-lantern-city="v6"] .lc-pursued-building'
        ).length,
      };
    });
    // Zoom a pilot territory into frame: koreatown reliably renders at its
    // authored anchor near center-left of the atlas.
    await page.screenshot({
      path: join(out, `${width}x${height}-pilot-territory.png`),
    });

    await page
      .getByRole("checkbox", { name: "Show labels", exact: true })
      .uncheck();
    await page.screenshot({
      path: join(out, `${width}x${height}-labels-hidden.png`),
    });
    await page
      .getByRole("checkbox", { name: "Show labels", exact: true })
      .check();

    // OPUS: tower vs light hit targets.
    const opusLight = page.locator(
      '[data-scene-id="opus_la"] [data-scene-target="light"]'
    );
    let opusInspectorOpened = null;
    if (await opusLight.count()) {
      await opusLight.click();
      opusInspectorOpened = await page.locator(".owi").isVisible();
      await page.screenshot({
        path: join(out, `${width}x${height}-opus-light-inspector.png`),
      });
    }
    await page.goto(`${baseURL}/growth/lantern-city`);
    await page
      .locator('[data-scene-id="opus_la"] [data-scene-target="tower"]')
      .click();
    await page.waitForURL(/tower-wars\?building=opus_la/);
    const opusTowerArena = await page.locator(".tw-arena").isVisible();
    await page.screenshot({
      path: join(out, `${width}x${height}-opus-tower-wars.png`),
    });

    // CPE: tower vs light hit targets (light only exists when CPE has a
    // live customer cluster — the local proof fixture may not seed one).
    await page.goto(`${baseURL}/growth/lantern-city`);
    const cpeLight = page.locator(
      '[data-scene-id="century_park_east"] [data-scene-target="light"]'
    );
    let cpeInspectorOpened = null;
    if (await cpeLight.count()) {
      await cpeLight.click();
      cpeInspectorOpened = await page.locator(".owi").isVisible();
    }
    await page.goto(`${baseURL}/growth/lantern-city`);
    await page
      .locator(
        '[data-scene-id="century_park_east"] [data-scene-target="tower"]'
      )
      .click();
    await page.waitForURL(/tower-wars\?building=century_park_east/);
    const cpeTowerArena = await page.locator(".tw-arena").isVisible();

    // ?scene=v5 frozen comparison still works.
    await page.goto(`${baseURL}/growth/lantern-city?scene=v5`);
    const v5Visible = await page.locator(".lc-page.lc-v5-game").isVisible();
    const v6Absent =
      (await page.locator('[data-lantern-city="v6"]').count()) === 0;

    reports.push({
      width,
      height,
      objects: layout.objects.length,
      hud: layout.hud.length,
      collisions: layout.collisions,
      brokenImages: layout.brokenImages,
      legacyClasses: layout.legacyClasses,
      pilotPlatesRendered: layout.plates.filter(p => p.src),
      allPlates: layout.plates,
      consoleErrors: errors,
      interactionQA: {
        opusLightOpensInspector: opusInspectorOpened,
        opusTowerOpensTowerWars: opusTowerArena,
        cpeLightOpensInspector: cpeInspectorOpened,
        cpeTowerOpensTowerWars: cpeTowerArena,
        v5FallbackWorks: v5Visible && v6Absent,
      },
      visualAcceptance: "BLOCKED ON ART",
      dataSource:
        "local disposable proof database + QA-only fixture rows exercising the four pilot states; not production counts",
    });
    await page.close();
  }
  writeFileSync(join(out, "report.json"), JSON.stringify(reports, null, 2));
  console.log(JSON.stringify(reports, null, 2));
} finally {
  await browser.close();
}
