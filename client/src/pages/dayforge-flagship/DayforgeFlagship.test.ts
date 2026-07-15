import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const component = readFileSync(
  path.resolve(import.meta.dirname, "DayforgeFlagship.tsx"),
  "utf8"
);
const styles = readFileSync(
  path.resolve(import.meta.dirname, "dayforge-flagship.css"),
  "utf8"
);
const analytics = readFileSync(
  path.resolve(import.meta.dirname, "analytics.ts"),
  "utf8"
);
const content = readFileSync(
  path.resolve(import.meta.dirname, "content.ts"),
  "utf8"
);
const entry = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "dayforgeflagship-main.tsx"),
  "utf8"
);
const html = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "dayforgeflagship.html"),
  "utf8"
);
const vite = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "..", "vite.config.ts"),
  "utf8"
);
const vercel = readFileSync(
  path.resolve(import.meta.dirname, "..", "..", "..", "..", "vercel.json"),
  "utf8"
);

describe("DayForge flagship contract", () => {
  it("ships as an isolated route and entry", () => {
    expect(entry).toContain("DayforgeFlagship");
    expect(entry).not.toContain("./App");
    expect(html).toContain('src="/src/dayforgeflagship-main.tsx"');
    expect(vite).toContain("dayforgeflagship: path.resolve(");
    expect(vercel).toContain('"source": "/dayforgeflagship"');
    expect(vercel).toContain('"destination": "/dayforgeflagship.html"');
  });

  it("publishes flagship canonical and X share metadata", () => {
    expect(html).toContain("https://admin.bldg.chat/dayforgeflagship");
    expect(html).toContain("/dayforgeflagship/og.jpg");
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("preserves exactly five CTA sources", () => {
    for (const source of ["hero", "mission", "sticky", "pricing", "final"]) {
      expect(component).toContain(`source="${source}"`);
    }
    expect(component.match(/source="(hero|mission|sticky|pricing|final)"/g)).toHaveLength(5);
    expect(component).not.toContain("WATCH THE TOUR");
  });

  it("opens the scheduler directly with a safe email fallback", () => {
    expect(component).toContain("VITE_SCHEDULER_URL");
    expect(component).toContain("Let&apos;s map the commercial accounts around your store.");
    expect(component).toContain("Schedule your DayForge territory mapping demo");
    expect(component).toContain("adam@bldg.chat");
    expect(component).not.toContain("contact form");
  });

  it("keeps PostHog silent without a key and preserves event contracts", () => {
    expect(analytics).toContain("VITE_POSTHOG_KEY");
    expect(analytics).toContain('"https://us.i.posthog.com"');
    expect(analytics).toContain('"cta_click"');
    expect(analytics).toContain('"faq_open"');
    expect(analytics).toContain("{ question_id: questionId }");
    expect(analytics).not.toContain("{ question: questionId }");
    expect(analytics).toContain("capture_pageleave: true");
    expect(analytics).toContain("autocapture: false");
  });

  it("keeps verified pricing, founding terms, and the sole ROI footnote", () => {
    expect(component).toContain("$199");
    expect(component).toContain("$149/month");
    expect(component).toContain("locked for 12 months");
    expect(component).toContain("Cancel anytime, no long contracts");
    expect(component.match(/Illustrative revenue estimate, not profit or a guarantee\. Costs and results vary\./g)).toHaveLength(1);
    expect(content).toContain("Onboarding included");
  });

  it("preserves all eight FAQs and the print-at-cost limitation", () => {
    expect(content.match(/question:/g)).toHaveLength(8);
    expect(content).toContain('id: "field-mission"');
    expect(content).toContain("paid directly to the print shop at cost");
    expect(content.match(/paid directly to the print shop at cost/g)).toHaveLength(1);
  });

  it("keeps the outcome, operating-system, Sage, BORESLAY, and mission story", () => {
    expect(component).toContain(
      "Stop driving past businesses that could be paying you."
    );
    expect(component).toContain(
      "How does a business on your street become your customer?"
    );
    expect(component).toContain("Dashboards get ignored. Games get played.");
    expect(component).toContain("MEET BORESLAY");
    expect(component).toContain("DayForge runs your fluff-and-fold operation");
    expect(component).toContain("First, DayForge learns how your store actually runs.");
    expect(component).toContain("FROM YOUR OPERATION");
    expect(component).toContain("FROM YOUR TERRITORY");
    expect(component).toMatch(/our\s+game for slaying business boredom/);
    expect(component).toContain("The gamified cure for the boring gap");
    expect(component).toContain("Two founder lives. One operating system.");
    expect(component).toContain("$1.6 million in revenue in under 11 months");
    expect(component).toContain(
      "It notices when good customers disappear, too."
    );
    expect(component).toContain("One account can pay for years of DayForge.");
    expect(component).toContain("Fair questions.");
    expect(component).toContain(
      "Stop passing the next account you could win."
    );
    expect(component).toContain("Defeat the Drain and win the contract.");
    expect(component).toContain("One closed account ≈ 10+ years of DayForge");
    // Big honest type only — the illustrative math must not become a calculator.
    expect(component).not.toContain('type="range"');
    expect(component).not.toContain('loading="lazy"');
    expect(component.indexOf("function BoreslayBridge")).toBeLessThan(
      component.indexOf("src={bossTheDrain}")
    );
  });

  it("uses only independent flagship concept assets", () => {
    expect(component).toContain("@/assets/dayforge-flagship/");
    expect(component).not.toContain("codex-l-final");
    expect(component).not.toContain("LandingFinal");
    expect(component).not.toContain("boreslay-rally");
    expect(component).toContain("BORESLAY");
    expect(component).not.toContain("BOORSLAY");
  });

  it("ships the new conversion experience only on mobile", () => {
    expect(component).toContain('className="ff-desktop"');
    expect(component).toContain('className="ff-mobile"');
    expect(component).toContain(
      "Your next laundry account is probably on this street."
    );
    expect(component).toContain("SCAN MY TERRITORY");
    expect(component).toContain("FROM EMPTY MILES TO PAYING STOPS");
    expect(component).toContain("BUILT FOR PEOPLE WHO STILL DO THE ROUTE");
  });

  it("keeps mobile CTA analytics on the existing source contract", () => {
    expect(component).toContain('hero: "hero" as CtaSource');
    expect(component).toContain('pitch: "mission" as CtaSource');
    expect(component).toContain('pricing: "pricing" as CtaSource');
    expect(component).toContain('final: "final" as CtaSource');
    expect(component).toContain("trackCtaClick(source)");
  });

  it("keeps the mobile experience active in phone browsers using a desktop viewport", () => {
    expect(styles).toContain("(max-device-width:900px) and (hover:none)");
    expect(styles).toContain("transform:scale(var(--dfm-force-scale,2.5))");
    expect(component).toContain('page.style.setProperty("--dfm-device-width"');
    expect(component).toContain('page.style.setProperty("--dfm-force-scale"');
  });

  it("explains the game before introducing the Boreslay mission art", () => {
    expect(component).toContain("SELLING LAUNDRY SERVICE IS BORING.");
    expect(component).toContain("SO WE TURNED IT INTO A GAME.");
    expect(component).toContain("finds real nearby properties worth pursuing");
    expect(component.indexOf('className="dfm-boreslay-intro"')).toBeLessThan(
      component.indexOf('className="dfm-boreslay"')
    );
  });
});
