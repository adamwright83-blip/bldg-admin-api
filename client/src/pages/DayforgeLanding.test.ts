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

describe("DayForge arcade landing contract", () => {
  it("keeps /dayforge routed through the application and Vercel", () => {
    expect(appSource.match(/<Route path="\/dayforge"/g)).toHaveLength(2);
    expect(vercelConfig).toContain('"source": "/dayforge"');
  });

  it("uses the exact 941 by 1672 campaign master", () => {
    expect(pageSource).toContain("dayforge-arcade-landing.png");
    expect(pageSource).toContain("width={941}");
    expect(pageSource).toContain("height={1672}");
    expect(cssSource).toContain("aspect-ratio: 941 / 1672");
  });

  it("preserves the exact headline, supporting copy, and offer", () => {
    expect(pageSource).toContain(
      "Stop driving past businesses that could be paying you."
    );
    expect(pageSource).toContain(
      "DayForge turns nearby laundry opportunities into playable missions—and"
    );
    expect(pageSource).toContain("Dashboards get ignored. Games get played.");
    expect(pageSource).toContain("$149/month");
    expect(pageSource).toContain("Stop hoping. Start hunting.");
  });

  it("keeps every major CTA actionable", () => {
    expect(pageSource.match(/href="\/boreslay-rally"/g)).toHaveLength(3);
    expect(pageSource.match(/href="\/territory-preview"/g)).toHaveLength(5);
    expect(pageSource).toContain('trackArcadeEvent("cta_click", source)');
    expect(pageSource).toContain('aria-label="Primary navigation"');
  });

  it("includes accessible copy, focus states, and reduced-motion handling", () => {
    expect(pageSource).toContain('className="dfa-copy"');
    expect(pageSource).toContain('className="dfa-skip"');
    expect(pageSource).toContain("<details>");
    expect(cssSource).toContain(":focus-visible");
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
