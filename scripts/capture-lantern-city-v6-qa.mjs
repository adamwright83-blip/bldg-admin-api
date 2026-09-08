import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const baseURL = process.env.GOLDLINE_SMOKE_BASE_URL ?? "http://127.0.0.1:4177";
if (!["localhost", "127.0.0.1"].includes(new URL(baseURL).hostname))
  throw new Error("V6 proof QA requires a local server");
const out = join(process.cwd(), "artifacts/lantern-city-v6-qa");
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
      const hud = Array.from(document.querySelectorAll("[data-hud-zone]")).map(
        el => ({ id: el.dataset.hudZone, rect: rect(el) })
      );
      return {
        objects,
        hud,
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
    if (
      layout.collisions.length ||
      layout.brokenImages.length ||
      errors.length ||
      layout.legacyClasses
    )
      throw new Error(JSON.stringify({ width, height, layout, errors }));
    await page
      .getByRole("checkbox", { name: "Show labels", exact: true })
      .uncheck();
    await page.screenshot({
      path: join(out, `${width}x${height}-labels-hidden.png`),
    });
    await page
      .getByRole("checkbox", { name: "Show labels", exact: true })
      .check();
    await page
      .getByRole("button", { name: /Customers View & outreach/i })
      .click();
    await page
      .getByRole("dialog", { name: "Customers", exact: true })
      .waitFor();
    if (!(await page.getByRole("textbox", { name: "Find customers" }).count()))
      throw new Error("Customer room did not mount");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: /Missions Today’s objectives/i })
      .click();
    await page.getByRole("dialog", { name: "Missions", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    const lantern = page.locator('[data-scene-object="lantern"]').first();
    if (await lantern.count()) {
      await lantern.click();
      const addresses = page.getByRole("dialog", { name: /^Customers in / });
      if (await addresses.count())
        await addresses.locator("button").nth(1).click();
      await page.screenshot({
        path: join(out, `${width}x${height}-customer-inspector.png`),
      });
      await page.locator(".owi").waitFor();
      if (!(await page.locator(".owi-residents, .owi-resident").count()))
        throw new Error("Real resident details missing");
    }
    // A reload resets inspection before testing the actual transition into Tower Wars.
    await page.goto(`${baseURL}/growth/lantern-city`);
    await page.locator('[data-scene-id="opus_la"]').click();
    await page.waitForURL(/tower-wars\?building=opus_la/);
    await page.locator(".tw-arena").waitFor({ timeout: 30000 });
    await page.screenshot({
      path: join(out, `${width}x${height}-tower-wars.png`),
    });
    if (errors.length) throw new Error(errors.join("\n"));
    reports.push({
      width,
      height,
      ...layout,
      errors,
      interactions: [
        "customers",
        "missions",
        "customer inspector",
        "OPUS → Tower Wars",
      ],
      visualAcceptance: "BLOCKED ON ART",
      dataSource: "local proof database; not production counts",
    });
    await page.close();
  }
  writeFileSync(join(out, "report.json"), JSON.stringify(reports, null, 2));
  console.log(
    JSON.stringify(
      reports.map(r => ({
        width: r.width,
        height: r.height,
        objects: r.objects.length,
        collisions: r.collisions,
        errors: r.errors,
      })),
      null,
      2
    )
  );
} finally {
  await browser.close();
}
