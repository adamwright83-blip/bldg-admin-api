import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { buildEchoFollowUpBrief, getNextEligibleFollowUp, type FollowUpEvidence } from "./echoFollowUpService";

function evidence(overrides: Partial<FollowUpEvidence> = {}): FollowUpEvidence {
  return {
    id: "fu-1",
    pipelineId: 42,
    status: "open",
    dueAt: new Date("2026-09-10T12:00:00Z"),
    note: "Called Tuesday, they asked us to follow up after their board meeting.",
    assignedTo: "operator-1",
    ...overrides,
  };
}

describe("buildEchoFollowUpBrief", () => {
  it("returns unavailable when there is no follow-up", () => {
    expect(buildEchoFollowUpBrief(null)).toEqual({ available: false, reason: "no_eligible_follow_up" });
  });

  it("returns unavailable for a non-open follow-up", () => {
    expect(buildEchoFollowUpBrief(evidence({ status: "completed" }))).toEqual({
      available: false,
      reason: "no_eligible_follow_up",
    });
  });

  it("carries the exact recorded note and due date verbatim, no paraphrase", () => {
    const source = evidence();
    const brief = buildEchoFollowUpBrief(source);
    expect(brief).toEqual({
      available: true,
      followUpId: "fu-1",
      pipelineId: 42,
      dueAt: source.dueAt.toISOString(),
      note: source.note,
      assignedTo: "operator-1",
      missingInfo: [],
      provenance: "commercial_follow_up_record",
    });
  });

  it("flags a missing assignee honestly instead of inventing one", () => {
    const brief = buildEchoFollowUpBrief(evidence({ assignedTo: null }));
    expect(brief).toMatchObject({ available: true, missingInfo: ["no assigned contact recorded"] });
  });

  it("flags an empty note honestly instead of inventing a promise", () => {
    const brief = buildEchoFollowUpBrief(evidence({ note: "   " }));
    expect(brief).toMatchObject({ available: true, missingInfo: ["no recorded note or promise"] });
  });

  it("never fabricates content when both are missing", () => {
    const brief = buildEchoFollowUpBrief(evidence({ assignedTo: null, note: "" }));
    expect(brief).toMatchObject({
      available: true,
      missingInfo: ["no assigned contact recorded", "no recorded note or promise"],
    });
  });
});

describe("getNextEligibleFollowUp", () => {
  it("returns null when no database is available, rather than fabricating a follow-up", async () => {
    mocks.getDb.mockResolvedValue(null);
    expect(await getNextEligibleFollowUp({ tenantId: "t1", operatorId: "op1" })).toBeNull();
  });
});
