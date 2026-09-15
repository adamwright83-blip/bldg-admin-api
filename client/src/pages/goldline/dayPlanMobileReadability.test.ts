import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isForcedMobileDayPlanViewport } from "./GoldlineDayPlan";

const css = [
  "goldline-day-plan.css",
  "goldline-day-plan-p1-fixes.css",
  "goldline-day-plan-concept.css",
  "goldline-driver-ui-forced-mobile.css",
]
  .map(file => readFileSync(path.join(__dirname, file), "utf8"))
  .join("\n");

describe("Goldline Day Plan mobile readability", () => {
  it("keeps primary cards legible when a phone exposes a desktop viewport", () => {
    expect(css).toContain(".gdp-shell--forced-mobile .gdp-stop");
    expect(css).toMatch(/\.gdp-shell--forced-mobile \.gdp-stop\s*\{[^}]*width:\s*72vw/);
    expect(css).toMatch(/\.gdp-shell--forced-mobile \.gdp-stop\s*\{[^}]*min-height:\s*24vw/);
    expect(css).toContain("font-size: 4.4vw");
    expect(css).toContain("font-size: 3.7vw");
  });

  it("detects a phone that exposes a desktop-sized layout viewport", () => {
    expect(
      isForcedMobileDayPlanViewport({
        layoutWidth: 980,
        screenWidth: 390,
        coarsePointer: true,
        hoverless: true,
      })
    ).toBe(true);
    expect(
      isForcedMobileDayPlanViewport({
        layoutWidth: 390,
        screenWidth: 390,
        coarsePointer: true,
        hoverless: true,
      })
    ).toBe(false);
    expect(
      isForcedMobileDayPlanViewport({
        layoutWidth: 1440,
        screenWidth: 1440,
        coarsePointer: false,
        hoverless: false,
      })
    ).toBe(false);
  });

  it("keeps the world portal secondary to the work cards", () => {
    expect(css).toContain(".gdp-shell--forced-mobile .gdp-overland-tool");
    expect(css).toMatch(/\.gdp-shell--forced-mobile \.gdp-overland-tool\s*\{[^}]*width:\s*28vw/);
    expect(css).toContain("width: 72vw");
  });
});
