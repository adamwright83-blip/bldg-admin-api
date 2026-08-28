import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./HeldLanding.tsx", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("Held resident landing page", () => {
  it("makes one-command ordering the public root experience", () => {
    expect(app).toContain('lazy(() => import("./pages/HeldLanding"))');
    expect(app).toContain(": HeldLandingRoute");
    expect(page).toContain("Pull the pen");
    expect(page).toContain("Say what you need");
    expect(page).toContain("Top-rated local vendors, selected for your building");
  });

  it("uses no stock icon library or generic SVG icon components", () => {
    expect(page).not.toContain("lucide-react");
    expect(page).not.toMatch(/<(ArrowRight|Check|ChevronDown|Mic|Sparkles|Icon)\b/);
  });

  it("presents every resident service and natural-language rescheduling", () => {
    for (const service of ["Laundry", "Dog grooming", "Car detailing", "Dry cleaning"]) {
      expect(page).toContain(service);
    }
    expect(page).toContain("Tomorrow after 6 instead");
    expect(page).toContain("Your pickup window has been moved");
  });
});
