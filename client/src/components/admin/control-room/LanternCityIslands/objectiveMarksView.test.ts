import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { LanternObjectiveMarks } from "@shared/lanternCityObjectiveMarks";
import { buildObjectiveMarkers, driverLinkForRun } from "./objectiveMarksView";

function marks(over: Partial<LanternObjectiveMarks> = {}): LanternObjectiveMarks {
  return {
    version: 1,
    businessDate: "2026-09-28",
    todayStatus: "ok",
    today: {
      dayLineItemId: "campaign-flyers",
      campaignId: "campaign-flyers",
      title: "Hang the flyers",
      campaignRunId: "run-1",
      fictionPackId: "bio_containment",
      targets: [
        { slotId: "s1", targetId: "t1", label: "Building One", latitude: 34.1, longitude: -118.3, level: "reported" },
        { slotId: "s2", targetId: "t2", label: "Building Two", latitude: 34.2, longitude: -118.4, level: null },
      ],
    },
    presence: [
      { eventId: "p1", campaignRunId: "run-1", latitude: 34.1001, longitude: -118.3001, accuracyMeters: 10, occurredAt: "2026-09-28T17:00:00.000Z" },
    ],
    targets: [
      {
        campaignRunId: "run-1",
        slotId: "s1",
        targetId: "t1",
        label: "Building One",
        latitude: 34.1,
        longitude: -118.3,
        level: "reported",
        evidence: [{ eventId: "e1", kind: "placement_reported", occurredAt: "2026-09-28T17:05:00.000Z", provenance: "operator_reported", epistemicState: "confirmed" }],
      },
      {
        campaignRunId: "run-old",
        slotId: "s9",
        targetId: "t9",
        label: "Old Building",
        latitude: 34.3,
        longitude: -118.5,
        level: "completed",
        evidence: [],
      },
    ],
    ...over,
  };
}

describe("buildObjectiveMarkers", () => {
  it("draws nothing without server data", () => {
    expect(buildObjectiveMarkers(undefined)).toEqual([]);
    expect(buildObjectiveMarkers(null)).toEqual([]);
  });

  it("draws presence as area marks, today's targets once each, and older evidenced targets", () => {
    const out = buildObjectiveMarkers(marks());
    expect(out.map(m => m.key)).toEqual([
      "presence:p1",
      "target:run-1:t1",
      "target:run-1:t2",
      "target:run-old:t9",
    ]);
    const t1 = out.find(m => m.key === "target:run-1:t1");
    expect(t1).toMatchObject({ kind: "target", today: true, level: "reported" });
    expect(t1 && t1.kind === "target" ? t1.evidence.map(e => e.eventId) : []).toEqual(["e1"]);
    expect(out.find(m => m.key === "target:run-old:t9")).toMatchObject({ today: false, level: "completed" });
  });

  it("is a pure function of the query result: same data, same markers", () => {
    expect(buildObjectiveMarkers(marks())).toEqual(buildObjectiveMarkers(marks()));
  });

  it("shows history even when there is no today", () => {
    const out = buildObjectiveMarkers(marks({ today: null, todayStatus: "no_active_run" }));
    expect(out.map(m => m.key)).toEqual(["presence:p1", "target:run-1:t1", "target:run-old:t9"]);
    expect(out.every(m => m.kind !== "target" || !m.today)).toBe(true);
  });

  it("links to Driver with the run id only", () => {
    expect(driverLinkForRun("run 1/x")).toBe("/driver?lanternCampaignRun=run%201%2Fx");
  });
});

describe("the marks layer keeps no memory of its own", () => {
  const files = ["./ObjectiveMarksLayer.tsx", "./objectiveMarksView.ts"];
  it("never reads sample data or browser storage", () => {
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/devSample/);
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });
});
