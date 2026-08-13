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
});
