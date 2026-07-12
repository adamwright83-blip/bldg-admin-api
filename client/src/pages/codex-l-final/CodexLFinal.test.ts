import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FAQS, PRICING_FEATURES } from "./content";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "CodexLFinal.tsx"),
  "utf8"
);
const cssSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "codex-l-final.css"),
  "utf8"
);
const analyticsSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "analytics.ts"),
  "utf8"
);
const codexEntrySource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "codexlfinal-main.tsx"),
  "utf8"
);
const codexHtml = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "codexlfinal.html"),
  "utf8"
);
const mainSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "main.tsx"),
  "utf8"
);
const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "App.tsx"),
  "utf8"
);
const vercelConfig = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "..", "vercel.json"),
  "utf8"
);
const viteConfig = fs.readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "..", "vite.config.ts"),
  "utf8"
);

describe("CodexLFinal landing contract", () => {
  it("owns an isolated route and leaves the existing landing router untouched", () => {
    expect(codexEntrySource).toContain(
      'import CodexLFinal from "./pages/codex-l-final/CodexLFinal"'
    );
    expect(codexEntrySource).toContain("<CodexLFinal />");
    expect(codexHtml).toContain('src="/src/codexlfinal-main.tsx"');
    expect(viteConfig).toContain("codexlfinal: path.resolve(");
    expect(vercelConfig).toContain('"source": "/dayforgenew"');
    expect(vercelConfig).toContain('"destination": "/codexlfinal.html"');
    expect(mainSource).toContain('import App from "./App"');
    expect(mainSource).toContain("<App />");
    expect(mainSource).not.toContain("codexlfinal");
    expect(appSource).not.toContain("codexlfinal");
    expect(pageSource).not.toContain("LandingFinal");
    expect(pageSource).not.toContain("DayforgeLanding");
    expect(pageSource).not.toContain("BoreslayLanding");
  });

  it("renders the exact seven-section, five-CTA page structure", () => {
    expect(pageSource.match(/data-clf-section=/g)).toHaveLength(7);
    expect(
      pageSource.match(/source="(hero|mission|sticky|pricing|final)"/g)
    ).toEqual([
      'source="hero"',
      'source="mission"',
      'source="pricing"',
      'source="final"',
      'source="sticky"',
    ]);
    expect(pageSource).toContain(
      "Stop driving past businesses that could be paying you."
    );
    expect(pageSource).toContain("MAP MY TERRITORY");
    expect(pageSource).toContain("Dashboards get ignored. Games get played.");
    expect(pageSource).toContain("One account can pay for years of DayForge.");
    expect(pageSource).toContain(
      "Stop passing the next account you could win."
    );
    expect(pageSource).not.toContain("WATCH THE");
  });

  it("keeps BORESLAY spelling, concept assets, and exact mission proof", () => {
    expect(pageSource).toContain("BORESLAY");
    expect(pageSource).not.toContain("BOORSLAY");
    expect(pageSource).toContain("rent-reaper-interrupt.jpg");
    expect(pageSource).toContain("rent-reaper-victory.jpg");
    expect(pageSource).toContain("owner-westview-entry.jpg");
    expect(pageSource).toContain("printed-leave-behind.jpg");
    expect(pageSource).not.toContain("boreslay-rally");
    expect(pageSource).not.toContain("Clocklord");
    expect(pageSource).toContain("Westview Property Management");
    expect(pageSource).toContain("Defeat the boss and win the contract.");
    expect(pageSource).toContain("Win Probability");
    expect(pageSource).toContain("CONTRACT SECURED");
    expect(pageSource).toContain("+$24,800/YR");
  });

  it("ships all eight FAQs and keeps print cost wording only in the field mission", () => {
    expect(FAQS).toHaveLength(8);
    expect(new Set(FAQS.map(faq => faq.id)).size).toBe(8);
    expect(FAQS.find(faq => faq.id === "field-mission")?.answer).toContain(
      "paid directly to the print shop at cost"
    );
    expect(
      FAQS.filter(faq => faq.answer.includes("print shop at cost"))
    ).toHaveLength(1);
    expect(pageSource).toContain("onToggle={onFaqToggle}");
    expect(analyticsSource).toContain('client?.capture("faq_open"');
    expect(analyticsSource).toContain("question_id");
  });

  it("keeps the confirmed commercial terms and sole ROI disclaimer", () => {
    expect(PRICING_FEATURES).toContain("Onboarding included");
    expect(pageSource).toContain("$199");
    expect(pageSource).toContain("First 25 operators: $149/month,");
    expect(pageSource).toContain("locked for 12 months.");
    expect(pageSource).toMatch(/Cancel anytime, no long\s+contracts/);
    expect(pageSource).toMatch(
      /Illustrative revenue estimate, not profit or a guarantee\. Costs and\s+results vary\./
    );
    expect(pageSource.match(/Illustrative revenue estimate/g)).toHaveLength(1);
  });

  it("opens the direct scheduler with a silent email fallback", () => {
    expect(pageSource).toContain("VITE_SCHEDULER_URL");
    expect(pageSource).toContain(
      "Let&apos;s map the commercial accounts around your store."
    );
    expect(pageSource).toContain(
      "Schedule your DayForge territory mapping demo"
    );
    expect(pageSource).toContain("adam@bldg.chat");
    expect(pageSource).not.toContain("/api/leads/submit");
    expect(pageSource).not.toContain("<form");
  });

  it("uses the strict PostHog event and default scroll contract", () => {
    expect(analyticsSource).toContain("VITE_POSTHOG_KEY");
    expect(analyticsSource).toContain("VITE_POSTHOG_HOST");
    expect(analyticsSource).toContain("https://us.i.posthog.com");
    expect(analyticsSource).toContain("capture_pageview: true");
    expect(analyticsSource).toContain("capture_pageleave: true");
    expect(analyticsSource).toContain("autocapture: false");
    expect(analyticsSource).toContain('"cta_click"');
    expect(analyticsSource.match(/"cta_click"/g)).toHaveLength(1);
    expect(analyticsSource).not.toContain("scroll_depth");
  });

  it("includes the mobile, sticky, dialog, and reduced-motion safety rails", () => {
    expect(pageSource).toContain("IntersectionObserver");
    expect(pageSource).toContain("missionEndRef");
    expect(pageSource).toContain("faqStartRef");
    expect(pageSource).toContain("showModal()");
    expect(pageSource).toContain('className="clf-skip"');
    expect(cssSource).toContain("env(safe-area-inset-bottom)");
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssSource).toContain(".clf-table-wrap td::before");
    expect(cssSource).toContain("overflow-x: clip");
  });
});
