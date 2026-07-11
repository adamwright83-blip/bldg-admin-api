import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "DayforgeLanding.tsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "dayforge-landing.css"),
  "utf8"
);
const heroCssSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "dayforge-hero-unified.css"),
  "utf8"
);
const rallyRendererSource = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    "..",
    "components",
    "boreslay-rally",
    "rallyRenderer.ts"
  ),
  "utf8"
);
const mainSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "main.tsx"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "App.tsx"),
  "utf8"
);
const vercelConfig = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "vercel.json"),
  "utf8"
);

describe("DayForge final landing contract", () => {
  it("registers /landingfinal for local, admin-host, generic-host, and Vercel routing", () => {
    expect(appSource).toContain('"/landingfinal"');
    expect(
      appSource.match(
        /<Route path="\/landingfinal" component=\{DayforgeLandingRoute\} \/>/g
      )
    ).toHaveLength(2);
    expect(vercelConfig).toContain('"source": "/landingfinal"');
  });

  it("keeps the final revenue-first promise and the real BORESLAY game asset", () => {
    expect(pageSource).toContain("Find the revenue you’re missing.");
    expect(pageSource).toContain("Then go get it.");
    expect(pageSource).toContain("p5-final-browser-proof.png");
    expect(pageSource).toContain('href="/boreslay-rally"');
    expect(pageSource).toContain("screen-to-street.png");
    expect(pageSource).toContain("unified-revenue-machine-hero.png");
    expect(pageSource).toContain('className="df3-hero-game-hotspot"');
    expect(pageSource).not.toContain('className="df3-hero-phone-screen"');
    expect(heroCssSource).toContain(".df3-hero-game-hotspot");
    expect(rallyRendererSource).toContain("procrastinator-v2.png");
    expect(rallyRendererSource).toContain("procrastinator-cuckoo-target.png");
    expect(mainSource).not.toContain("clockheadCuckooVisual");
  });

  it("submits demo leads through the production lead endpoint with a distinct source", () => {
    expect(pageSource).toContain("/api/leads/submit");
    expect(pageSource).toContain('source: "dayforge_landing_final"');
    for (const field of ["businessName", "name", "email", "phone"]) {
      expect(pageSource).toContain(field);
    }
  });

  it("includes accessible navigation, dialog, reduced motion, and mobile conversion behavior", () => {
    expect(pageSource).toContain('aria-label="Primary navigation"');
    expect(pageSource).toContain('aria-modal="true"');
    expect(pageSource).toContain('className="df2-skip"');
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssSource).toContain(".df2-mobile-cta");
    expect(pageSource).toContain('trackLandingEvent("demo_cta_click"');
    expect(pageSource).toContain('trackLandingEvent("scroll_depth"');
  });
});
