import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the NEUTRALIZE route-stop in-game visit flow: a
 * commercial visit route stop must open the in-game VISIT action surface
 * (GoldlineActionSurface, via GoldlineGameHome's onSelectRouteStop) rather
 * than navigating away to the legacy /driver/sales-mission/:id page. This
 * would fail if a future change reintroduced `<a href={stop.destinationPath}>`
 * or any other full-page navigation for a route stop.
 */
describe("FictionMissionPanel route-stop rendering", () => {
  const source = readFileSync(
    new URL("./FictionMissionPanel.tsx", import.meta.url),
    "utf8"
  );

  it("never navigates a route stop via an anchor href", () => {
    expect(source).not.toContain("href={stop.destinationPath}");
    expect(source).not.toMatch(/<a\s[^>]*stop\.destinationPath/);
  });

  it("dispatches route-stop selection through onSelectStop instead", () => {
    expect(source).toContain("onSelectStop?: (stop: AuthoritativeVisitRouteStop) => void");
    expect(source).toContain("onClick={() => props.onSelectStop?.(stop)}");
  });
});

describe("GoldlineGameHome route-stop wiring", () => {
  const source = readFileSync(
    new URL("../GoldlineGameHome.tsx", import.meta.url),
    "utf8"
  );

  it("wires the fiction panel's onSelectStop to the in-game VISIT handler", () => {
    expect(source).toContain("onSelectStop={handleSelectRouteStop}");
    expect(source).toContain('kind: "VISIT"');
  });

  it("fails closed instead of opening the surface when a stop has no real address", () => {
    expect(source).toMatch(/if \(!stop\.address \|\| !stop\.navigationUrl\)/);
  });
});
