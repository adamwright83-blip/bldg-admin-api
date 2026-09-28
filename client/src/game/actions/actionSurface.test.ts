import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const surface = readFileSync(
  new URL("./GoldlineActionSurface.tsx", import.meta.url),
  "utf8"
);

describe("Goldline action surfaces", () => {
  it("treats maps as a handoff, never as visit completion", () => {
    expect(surface).toContain("onClick={armResume}");
    expect(surface).toContain("Launching maps or returning does not complete");
    expect(surface).toContain("props.services.arriveVisit({");
    expect(surface).toContain("ARRIVED · RECORD VISIT");
  });

  it("uses authoritative follow-up dates and has no arcade countdown", () => {
    expect(surface).toContain("props.action.followUp.dueAt");
    expect(surface).toContain("props.action.followUp.channel");
    expect(surface).not.toMatch(
      /TIME RUNNING OUT|COMBO EXPIRING|\d{2}:\d{2}:\d{2}/
    );
  });

  it("reports only discoveries returned by the scout service", () => {
    expect(surface).toContain("report.discoveries.length");
    expect(surface).toContain("Scout returned zero new discoveries.");
    expect(surface).not.toContain("Math.random");
  });


  it("shows every proposed authoritative debrief field before confirmation", () => {
    expect(surface).toContain('data-testid="mission-debrief-authoritative-fields"');
    expect(surface).toContain("DECISION MAKER");
    expect(surface).toContain("COLLATERAL DELIVERED");
    expect(surface).toContain("QUOTE REQUESTED");
    expect(surface).toContain("PILOT REQUESTED");
    expect(surface).toContain("FOLLOW-UP REQUESTED");
    expect(surface).toContain("record a correction instead");
  });

  it("shows Claire's three mission-grounded equips before the visit resolves", () => {
    expect(surface).toContain('data-testid="claire-tower-intel"');
    expect(surface).toContain("THREE THINGS BEFORE YOU GO IN");
    expect(surface).toContain("preVisitIntel.items.map");
    expect(surface).toContain('item.provenance.kind === "trainer_source"');
    expect(surface).toContain('item.provenance.kind === "foundation"');
    expect(surface).toContain("FOUNDATION · ARMORY");
    expect(surface).toContain("!context?.visitOutcome");
  });
});
