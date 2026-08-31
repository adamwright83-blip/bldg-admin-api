import { describe, expect, it } from "vitest";
import { commercialSignalContext } from "./commercialSignalContext";
import { deriveSignals } from "./psychSignals";

function source(overrides: Record<string, unknown> = {}) {
  return {
    stage: "relationship",
    businessDate: "2026-08-30",
    mission: { status: "follow_up" },
    followUps: [] as Array<{ dueAt: string; status: string }>,
    ...overrides,
  };
}

describe("commercial production signal projection", () => {
  it("manifests overdue vines and clears them when the real action completes", () => {
    const open = source({ followUps: [{ dueAt: "2026-08-27T17:00:00.000Z", status: "open" }] });
    expect(deriveSignals(commercialSignalContext(open)).map(item => item.kind)).toContain("vines");
    const completed = source({ followUps: [{ dueAt: "2026-08-27T17:00:00.000Z", status: "completed" }] });
    expect(deriveSignals(commercialSignalContext(completed)).map(item => item.kind)).not.toContain("vines");
  });

  it("projects a real future commitment and an actively executing mission", () => {
    const input = source({
      mission: { status: "en_route" },
      followUps: [{ dueAt: "2026-09-01T17:00:00.000Z", status: "open" }],
    });
    expect(deriveSignals(commercialSignalContext(input)).map(item => item.kind)).toEqual(["clock", "ruinbound"]);
  });

  it("does not fabricate silence, cadence, or response-meaning evidence", () => {
    const context = commercialSignalContext(source());
    expect(context.lastFieldActivityAt).toBeNull();
    expect(context.lastResponseAt).toBeNull();
    expect(context.expectedReplyDays).toBeNull();
    expect(deriveSignals(context)).toEqual([]);
  });
});
