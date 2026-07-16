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
const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "App.tsx"),
  "utf8"
);
const vercelConfig = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "vercel.json"),
  "utf8"
);

describe("DayForge responsive arcade landing contract", () => {
  it("keeps /dayforge routed through the app and Vercel", () => {
    expect(appSource.match(/<Route path="\/dayforge"/g)).toHaveLength(2);
    expect(vercelConfig).toContain('"source": "/dayforge"');
  });

  it("uses native responsive sections instead of rendering the concept poster", () => {
    expect(pageSource).not.toContain('className="dfa-artwork"');
    expect(pageSource).toContain("<GameplaySection />");
    expect(pageSource).toContain("<HowSection />");
    expect(pageSource).toContain("<DashboardSection />");
    expect(pageSource).toContain("<IntelligenceSection />");
    expect(pageSource).toContain("<CastSection />");
    expect(pageSource).toContain("<FounderSection />");
    expect(pageSource).toContain("<PricingSection />");
    expect(pageSource).toContain("<FaqSection />");
    expect(cssSource).toContain("--dfa2-shell: 1440px");
    expect(cssSource).toContain("min-height: calc(100vh - 78px)");
  });

  it("makes the real BORESLAY game the hero centerpiece", () => {
    expect(pageSource).toContain("src={GAME_PATH}");
    expect(pageSource).toContain('title="Play BORESLAY Arcade Duel"');
    expect(pageSource).toContain("PRESS START");
    expect(pageSource).toContain("REAL GAME · LIVE MISSION");
    expect(pageSource).toContain("p5-final-browser-proof.png");
    expect(pageSource).toContain("p3-browser-proof.png");
    expect(pageSource).toContain("concept-v2-showpiece.png");
  });

  it("preserves the locked product, game, character, move, and offer copy", () => {
    for (const copy of [
      "Stop driving past businesses that could be paying you.",
      "DayForge turns nearby laundry opportunities into playable",
      "BORESLAY",
      "STRIKE",
      "BANK SHOT",
      "BUTT BASH",
      "Cash",
      "Rook",
      "Clockhead",
      "Dashboards get ignored.",
      "Every mission makes the next mission smarter.",
      "$149",
      "Stop hoping.",
    ])
      expect(pageSource).toContain(copy);
  });

  it("keeps the primary conversion paths, address form, and FAQ functional", () => {
    expect(pageSource).toContain("href={GAME_PATH}");
    expect(pageSource).toContain("territoryUrl(");
    expect(pageSource).toContain("onSubmit={submitAddress}");
    expect(pageSource).toContain('aria-label="Primary navigation"');
    expect(pageSource).toContain("<details");
    expect(pageSource).toContain('trackArcadeEvent("cta_click"');
  });

  it("includes laptop, tablet, mobile, focus, and reduced-motion rules", () => {
    expect(cssSource).toContain("@media (max-width: 1240px)");
    expect(cssSource).toContain("@media (max-width: 1020px)");
    expect(cssSource).toContain("@media (max-width: 700px)");
    expect(cssSource).toContain(":focus-visible");
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
