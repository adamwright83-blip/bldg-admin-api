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

/**
 * The NEUTRALIZE route-stop VISIT lifecycle spans FictionMissionPanel ->
 * GoldlineGameHome -> GoldlineActionSurface. A structural check on
 * FictionMissionPanel alone would miss a legacy-page escape reintroduced
 * further along that chain — e.g. the "preparing but not ready to depart"
 * state, which previously rendered `<a href={props.action.destinationPath}>`
 * (REVIEW REQUIRED FIELD PREP) as a fallback out of Goldline. This guards
 * the whole chain, and the CASE A browser test in
 * e2e/goldline/immersion-gate.spec.ts exercises the same guarantee live
 * (asserts zero `a[href*="/driver/sales-mission/"]` inside the mounted
 * surface at every VISIT lifecycle stage, not just at selection time).
 */
describe("GoldlineActionSurface VISIT lifecycle never falls back to the legacy page", () => {
  const source = readFileSync(
    new URL("../actions/GoldlineActionSurface.tsx", import.meta.url),
    "utf8"
  );

  it("never links out to destinationPath while prep is incomplete", () => {
    expect(source).not.toContain("<a href={props.action.destinationPath}>");
    expect(source).not.toMatch(/<a\s[^>]*action\.destinationPath/);
  });

  it("exposes required field prep as an in-game checklist action instead", () => {
    expect(source).toContain("props.services.updateChecklistItem");
    expect(source).toContain("action-field-prep-checklist");
  });
});
