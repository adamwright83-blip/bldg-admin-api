import { describe, expect, it } from "vitest";
import {
  campaignHostCta,
  confirmTomorrowUtterance,
  diffWorkdayPlans,
  proposeTomorrowDraft,
  speakEveningPlan,
  speakMorningDelta,
  type WorkdayPlanItem,
} from "./claireWorkday";

function item(overrides: Partial<WorkdayPlanItem> & Pick<WorkdayPlanItem, "id" | "title">): WorkdayPlanItem {
  return {
    source: "tomorrow:test",
    status: "open",
    alreadyExists: true,
    permissionLevel: "APPROVAL_REQUIRED",
    detailState: "COMPLETE",
    missingDetails: [],
    scheduleKind: "UNSCHEDULED",
    scheduledAt: null,
    provenance: "test",
    ...overrides,
  };
}

describe("Claire workday plan seams", () => {
  it("does not invent items when proposing tomorrow", () => {
    const draft = proposeTomorrowDraft([
      item({ id: "a", title: "Los Feliz pickup", scheduleKind: "EXACT_TIME", permissionLevel: "HUMAN_EXECUTION" }),
      item({ id: "b", title: "Research Zeely", detailState: "NEEDS_DETAILS" }),
    ]);
    expect(draft.map(entry => entry.id)).toEqual(["a", "b"]);
  });

  it("diffs overnight adds and removals without an LLM", () => {
    const confirmed = {
      businessDate: "2026-09-15",
      confirmedAt: "2026-09-14T04:00:00.000Z",
      actorId: "op",
      items: [item({ id: "a", title: "Rebecca dropoff" })],
      missingQuestion: null,
    };
    const deltas = diffWorkdayPlans({
      confirmed,
      current: [
        item({ id: "a", title: "Rebecca dropoff" }),
        item({ id: "b", title: "Los Feliz pickup" }),
      ],
    });
    expect(deltas).toEqual([
      expect.objectContaining({ kind: "ADDED", title: "Los Feliz pickup" }),
    ]);
  });

  it("speaks evening and morning without dumping a 30-item list", () => {
    expect(speakEveningPlan([])).toMatch(/what am i missing/i);
    expect(
      speakMorningDelta([{ kind: "ADDED", itemId: "b", title: "Los Feliz pickup" }])
    ).toMatch(/changed overnight/i);
  });

  it("replaces assigned-action jargon with intent CTAs", () => {
    expect(campaignHostCta("action_grammar")).toBe("START");
    expect(campaignHostCta("field_journal")).toBe("REVIEW WITH CLAIRE");
    expect(campaignHostCta("authoritative_visit_route")).toBe("START MISSION");
  });

  it("confirms tomorrow from ordinary speech and surfaces one stale follow-up", () => {
    expect(confirmTomorrowUtterance("Yes, that's tomorrow.")).toBe(true);
    expect(
      speakEveningPlan([item({ id: "s", title: "Dana materials", status: "overdue" })])
    ).toMatch(/hasn't had a meaningful follow-up/i);
  });
});
