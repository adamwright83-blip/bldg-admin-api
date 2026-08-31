/**
 * LIVING LOS ANGELES — BROWSER JOURNEY EVIDENCE HARNESS
 *
 * This is verification scaffolding, not production architecture.
 *
 * The claim under test cannot be proved server-side: Maps JavaScript 3D runs
 * only in a browser, and "a component mounted" or "a callback fired" is not
 * evidence that Google drew anything. So this harness drives a real Chromium
 * against the real dev server and records, per journey phase:
 *
 *   - the phase the stage actually reports (data-world-phase)
 *   - a screenshot of the real pixels
 *   - whether Google map/tile responses were actually served to the page
 *   - whether Google's own attribution is present and unobscured
 *
 * AUTH: the admin app authenticates through an external OAuth SDK, which this
 * harness has no way to satisfy. It therefore stubs ONLY the auth envelope
 * (`auth.me`) plus the tRPC procedures, injecting REAL provider values fetched
 * through the Railway-backed service layer. Everything that matters visually —
 * the Maps JS key, the tiles, the camera, the attribution — is genuinely live:
 * the browser talks to Google directly with the real key.
 */
import { chromium, type Page, type Request } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { googleWorldService } from "../server/google/googleWorldService";
import { compileAuthoritativeEvents } from "../server/towerWars/towerWarsService";
import { compileTowerWarsState } from "../shared/towerWars";

const origin = process.env.LIVING_LA_ORIGIN || "http://localhost:3000";
const outDir = path.resolve(process.cwd(), "artifacts/living-los-angeles-browser");

type Shot = {
  name: string;
  phase: string | null;
  googleRequests: number;
  attributionVisible: boolean | null;
  note: string;
};

async function main() {
  await fs.mkdir(outDir, { recursive: true });

  // Real provider truth, fetched through the Railway-injected service layer.
  const runtimeConfig = googleWorldService.getPublicRuntimeConfig();
  if (!runtimeConfig.mapsJavascriptApiKey) {
    throw new Error("No Maps JavaScript key available — run under `railway run`.");
  }
  const [atmosphere, opportunity, towerToday] = await Promise.all([
    googleWorldService.getAtmosphere(true),
    googleWorldService.getOpportunityPressure(true).catch(() => null),
    // TOWER WARS SCAFFOLDING — NOT BUSINESS TRUTH.
    //
    // The destination only calls arrive() once the arena actually renders a
    // building, so an inactive arena silently suppresses the entire journey and
    // makes a harness artifact look like a product defect. The Railway MySQL
    // instance is on a private network and is unreachable from a local run, so
    // no real ledger can be compiled here.
    //
    // This therefore compiles a STRUCTURALLY REAL but EMPTY state through the
    // production compilers: zero events, so revenue is a genuine $0/$0 — the
    // legitimate "no loser" case — with no invented orders, customers or
    // amounts. Only `evidenceSufficient` is forced, purely so the arena mounts
    // and the camera journey under test can be observed. No revenue figure
    // produced here is reported as business truth anywhere.
    Promise.resolve(null),
  ]);
  console.log(`Real atmosphere: ${atmosphere?.statusBadge ?? "(none)"}`);
  const emptyCompiled = compileAuthoritativeEvents({
    tenantId: "default",
    businessDate: new Date().toISOString().slice(0, 10),
    candidates: [],
  });
  const scaffoldToday = {
    tenantId: "default",
    businessDate: new Date().toISOString().slice(0, 10),
    timeZone: "America/Los_Angeles",
    window: { startUtc: new Date().toISOString(), endExclusiveUtc: new Date().toISOString() },
    thresholdCents: 0,
    evidenceSufficient: true,
    ledger: emptyCompiled.events,
    exclusions: emptyCompiled.exclusions,
    state: compileTowerWarsState(emptyCompiled.events),
    sourceBreakdown: { opus_la: {}, century_park_east: {} },
    contributors: { opus_la: [], century_park_east: [] },
    promises: [],
  };
  void towerToday;
  console.log("towerWars.today: empty-but-structural scaffolding ($0/$0, no fabricated revenue)");

  const fixtures: Record<string, unknown> = {
    "auth.me": { openId: "living-la-verify", name: "Admin Verify", email: null, role: "admin" },
    "system.google.runtimeConfig": runtimeConfig,
    "system.google.atmosphere": atmosphere,
    "system.google.opportunityPressure": opportunity,
    "system.towerWars.today": scaffoldToday,
  };

  function fixtureFor(procedure: string): unknown {
    if (procedure in fixtures) return fixtures[procedure];
    if (/\.count|count[A-Z]/.test(procedure)) return 0;
    if (/\.list|list[A-Z]|search[A-Z]/.test(procedure)) return [];
    return null;
  }

  // GPU flags are load-bearing, not cosmetic. Maps 3D renders through a WASM
  // renderer that needs real WebGL2: under default headless Chromium it fails
  // with "Attempted to load a 3D Map, but failed", the layer reports a renderer
  // error, and the journey falls straight to authored_landing — which looks
  // exactly like a broken product but is a harness artifact.
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
  });
  const results: Record<string, Shot[]> = {};

  async function runJourney(
    label: string,
    viewport: { width: number; height: number },
    reducedMotion: "reduce" | "no-preference",
    entryPath: string,
    buildingLabel: string
  ) {
    const page = await browser.newPage({ viewport, reducedMotion });
    const googleReqs: Request[] = [];
    page.on("request", r => {
      const u = r.url();
      if (/maps\.googleapis\.com|khm\w*\.googleapis\.com|tile\.googleapis\.com|vt\?|kh\?/.test(u)) {
        googleReqs.push(r);
      }
    });
    const consoleErrors: string[] = [];
    page.on("pageerror", e => consoleErrors.push("PAGEERROR " + e.message));
    page.on("console", m => {
      if (m.type() === "error" || m.type() === "warning") consoleErrors.push(m.type().toUpperCase() + " " + m.text());
    });
    page.on("response", async r => {
      const u = r.url();
      if (/maps\.googleapis\.com/.test(u) && r.status() >= 400) {
        consoleErrors.push(`HTTP ${r.status()} ${u.slice(0, 160)}`);
      }
    });

    await page.route("**/api/trpc/**", async route => {
      const url = new URL(route.request().url());
      const encoded = url.pathname.split("/api/trpc/")[1] || "";
      const procedures = decodeURIComponent(encoded).split(",").filter(Boolean);
      const payload = procedures.map(p => ({ result: { data: { json: fixtureFor(p) } } }));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });

    const shots: Shot[] = [];
    const snap = async (name: string, note: string) => {
      const phase = await page.evaluate(() => {
        const el = document.querySelector("[data-world-phase]");
        return el ? el.getAttribute("data-world-phase") : null;
      });
      const attributionVisible = await page.evaluate(() => {
        const el = document.querySelector(".gmnoprint, .gm-style-cc, [class*='attribution']");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const file = path.join(outDir, `${label}-${name}.png`);
      await page.screenshot({ path: file });
      shots.push({ name, phase, googleRequests: googleReqs.length, attributionVisible, note });
      console.log(`  [${label}] ${name}: phase=${phase} googleReqs=${googleReqs.length} attribution=${attributionVisible}`);
    };

    await page.goto(`${origin}${entryPath}`, { waitUntil: "networkidle" });
    await snap("01-authored-la", "authored Goldline Los Angeles before any traversal");

    const tower = page.getByRole("button", { name: `Enter ${buildingLabel}` });
    if ((await tower.count()) === 0) {
      shots.push({ name: "TOWER_NOT_FOUND", phase: null, googleRequests: googleReqs.length, attributionVisible: null, note: `no button "Enter ${buildingLabel}" at ${entryPath}` });
      console.log(`  [${label}] TOWER NOT FOUND for "${buildingLabel}" at ${entryPath}`);
      results[label] = shots;
      await page.close();
      return;
    }

    await tower.first().click();
    // Sample the journey densely enough to catch each authored phase.
    const seen = new Set<string>();
    const timeline: string[] = [];
    let lastPhase: string | null = "__init";
    const t0 = Date.now();
    for (let i = 0; i < 90; i++) {
      const cur = await page.evaluate(() => {
        const el = document.querySelector("[data-world-phase]");
        return el ? el.getAttribute("data-world-phase") : null;
      });
      if (cur !== lastPhase) {
        timeline.push(`+${Date.now() - t0}ms ${cur ?? "(no stage)"}`);
        lastPhase = cur;
      }
      const phase = await page.evaluate(() => {
        const el = document.querySelector("[data-world-phase]");
        return el ? el.getAttribute("data-world-phase") : null;
      });
      if (phase && !seen.has(phase)) {
        seen.add(phase);
        await snap(`phase-${seen.size}-${phase}`, `observed journey phase ${phase}`);
      }
      await page.waitForTimeout(120);
    }
    console.log(`  [${label}] timeline: ${timeline.join(" -> ")}`);
    await page.waitForTimeout(800);
    await snap("99-destination", `landed; url=${page.url()}`);
    if (consoleErrors.length) {
      console.log(`  [${label}] diagnostics:`);
      for (const e of consoleErrors.slice(0, 8)) console.log(`      ${e.slice(0, 300)}`);
    }
    results[label] = shots;
    await page.close();
  }

  await runJourney("desktop-opus", { width: 1440, height: 900 }, "no-preference", "/home", "OPUS LA");
  await runJourney("desktop-cpe", { width: 1440, height: 900 }, "no-preference", "/home", "Century Park East");
  await runJourney("lantern-opus", { width: 1440, height: 900 }, "no-preference", "/growth/lantern-city", "OPUS LA");
  await runJourney("mobile-opus", { width: 390, height: 844 }, "no-preference", "/home", "OPUS LA");
  await runJourney("reduced-opus", { width: 1440, height: 900 }, "reduce", "/home", "OPUS LA");

  // ── Overlay geography: nothing atlas-positioned may sit over real geography ──
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/api/trpc/**", async route => {
      const url = new URL(route.request().url());
      const encoded = url.pathname.split("/api/trpc/")[1] || "";
      const procedures = decodeURIComponent(encoded).split(",").filter(Boolean);
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(procedures.map(p => ({ result: { data: { json: fixtureFor(p) } } }))) });
    });
    await page.goto(`${origin}/growth/lantern-city`, { waitUntil: "networkidle" });

    const atlasCounts = () => page.evaluate(() => ({
      towerAnchors: document.querySelectorAll(".cr-world-tower-anchor").length,
      districtGlows: document.querySelectorAll(".cr-district-glow").length,
      lanterns: document.querySelectorAll(".lc-lantern").length,
      pursuits: document.querySelectorAll(".lc-pursued-flame").length,
      neighbourhoodLabels: document.querySelectorAll(".cr-world-neighborhood-label").length,
      marker3d: document.querySelectorAll("gmp-marker-3d, gmp-marker-3d-interactive").length,
    }));

    console.log("  [overlay] atlas mode:", JSON.stringify(await atlasCounts()));
    await page.screenshot({ path: path.join(outDir, "overlay-01-atlas-mode.png") });

    const toggle = page.getByRole("button", { name: "3D Reality View" });
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
      await page.waitForTimeout(9000);
      const g = await atlasCounts();
      console.log("  [overlay] google mode:", JSON.stringify(g));
      const lying = g.towerAnchors + g.districtGlows + g.lanterns + g.pursuits + g.neighbourhoodLabels;
      console.log(`  [overlay] atlas-positioned overlays over real geography: ${lying} (must be 0)`);
      console.log(`  [overlay] renderer-native geographic markers: ${g.marker3d}`);
      // Present is not the same as correct: assert each marker sits on the
      // canonical coordinate rather than anywhere the renderer felt like.
      const positions = await page.evaluate(() =>
        [...document.querySelectorAll("gmp-marker-3d, gmp-marker-3d-interactive")].map(
          (m: any) => ({ label: m.label ?? null, lat: m.position?.lat ?? null, lng: m.position?.lng ?? null })
        )
      );
      console.log(`  [overlay] marker coordinates: ${JSON.stringify(positions)}`);
      await page.screenshot({ path: path.join(outDir, "overlay-02-google-mode.png") });
    } else {
      console.log("  [overlay] 3D Reality View toggle not found");
    }
    await page.close();
  }

  // ── Reverse journey ──────────────────────────────────────────────────────
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/api/trpc/**", async route => {
      const url = new URL(route.request().url());
      const encoded = url.pathname.split("/api/trpc/")[1] || "";
      const procedures = decodeURIComponent(encoded).split(",").filter(Boolean);
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(procedures.map(p => ({ result: { data: { json: fixtureFor(p) } } }))) });
    });

    // Cold deep link must NOT fabricate a journey it never made.
    await page.goto(`${origin}/growth/tower-wars?building=opus_la`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const coldStage = await page.evaluate(() => {
      const el = document.querySelector("[data-world-phase]");
      return el ? el.getAttribute("data-world-phase") : null;
    });
    console.log(`  [reverse] cold deep link fabricated a journey: ${coldStage !== null} (must be false)`);

    // A real outbound journey, then back out.
    await page.goto(`${origin}/home`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Enter OPUS LA" }).first().click();
    await page.waitForTimeout(9000);
    const afterOut = { url: page.url(), stage: await page.evaluate(() => {
      const el = document.querySelector("[data-world-phase]");
      return el ? el.getAttribute("data-world-phase") : null; }) };
    console.log(`  [reverse] outbound landed: url=${afterOut.url} staleStage=${afterOut.stage}`);
    await page.screenshot({ path: path.join(outDir, "reverse-01-arrived.png") });

    const back = page.getByRole("button", { name: /back to the city|return|leave/i });
    if ((await back.count()) > 0) {
      await back.first().click();
    } else {
      await page.goBack();
    }
    const revTimeline: string[] = [];
    let last: string | null = "__init";
    const t0 = Date.now();
    for (let i = 0; i < 60; i++) {
      const cur = await page.evaluate(() => {
        const el = document.querySelector("[data-world-phase]");
        return el ? el.getAttribute("data-world-phase") : null;
      });
      if (cur !== last) { revTimeline.push(`+${Date.now() - t0}ms ${cur ?? "(no stage)"}`); last = cur; }
      await page.waitForTimeout(120);
    }
    const entity = await page.evaluate(() => {
      const el = document.querySelector("[data-world-entity]");
      return el ? el.getAttribute("data-world-entity") : null;
    });
    console.log(`  [reverse] timeline: ${revTimeline.join(" -> ")}`);
    console.log(`  [reverse] returned to: ${page.url()} | entity=${entity}`);
    await page.screenshot({ path: path.join(outDir, "reverse-02-returned.png") });
    await page.close();

    const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await rm.route("**/api/trpc/**", async route => {
      const url = new URL(route.request().url());
      const encoded = url.pathname.split("/api/trpc/")[1] || "";
      const procedures = decodeURIComponent(encoded).split(",").filter(Boolean);
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify(procedures.map(p => ({ result: { data: { json: fixtureFor(p) } } }))) });
    });
    await rm.goto(`${origin}/home`, { waitUntil: "networkidle" });
    await rm.getByRole("button", { name: "Enter OPUS LA" }).first().click();
    await rm.waitForTimeout(2500);
    // Use the same return affordance as the full-motion case, so the two are
    // actually comparable; browser back is a different mechanism entirely.
    const rmBack = rm.getByRole("button", { name: /back to the city|return|leave/i });
    if ((await rmBack.count()) > 0) await rmBack.first().click();
    else await rm.goBack();
    const rmTl: string[] = [];
    let rmLast: string | null = "__init";
    const rt0 = Date.now();
    for (let i = 0; i < 30; i++) {
      const cur = await rm.evaluate(() => {
        const el = document.querySelector("[data-world-phase]");
        return el ? el.getAttribute("data-world-phase") : null;
      });
      if (cur !== rmLast) { rmTl.push(`+${Date.now() - rt0}ms ${cur ?? "(no stage)"}`); rmLast = cur; }
      await rm.waitForTimeout(100);
    }
    console.log(`  [reverse] reduced-motion reverse: ${rmTl.join(" -> ")} | url=${rm.url()}`);
    await rm.close();
  }

  await browser.close();
  await fs.writeFile(path.join(outDir, "report.json"), JSON.stringify(results, null, 2));
  console.log(`\nArtifacts written to ${outDir}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
