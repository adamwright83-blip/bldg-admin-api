import { describe, expect, it, vi } from "vitest";
import { assessAmbiguity, extractConversationalFieldOutcome } from "../../shared/claireRuntime";
import {
  confirmTomorrowUtterance,
  diffWorkdayPlans,
  proposeTomorrowDraft,
  speakEveningPlan,
  speakMorningDelta,
  type WorkdayPlanItem,
} from "../../shared/claireWorkday";
import {
  OPTIONAL_PLAY_CANNOT,
  nextApproachCorridor,
  resolveApproachRoute,
} from "../../shared/claireApproach";
import { campaignHostCta } from "../../shared/claireWorkday";
import { handleVoiceCommitmentTurn, type PendingProposalState } from "./voiceCommitmentLoop";

function item(overrides: Partial<WorkdayPlanItem> & Pick<WorkdayPlanItem, "id" | "title">): WorkdayPlanItem {
  return {
    source: "tomorrow:orders",
    status: "open",
    alreadyExists: true,
    permissionLevel: "HUMAN_EXECUTION",
    detailState: "COMPLETE",
    missingDetails: [],
    scheduleKind: "UNSCHEDULED",
    scheduledAt: null,
    provenance: "orders",
    ...overrides,
  };
}

describe("Claire owns the workday regression matrix", () => {
  it("evening planning uses known work and does not invent appointments", () => {
    const draft = proposeTomorrowDraft([
      item({ id: "p1", title: "Los Feliz pickup", alreadyExists: true }),
    ]);
    expect(draft[0]?.alreadyExists).toBe(true);
    expect(speakEveningPlan(draft)).not.toMatch(/tell me (your|the) whole day/i);
  });

  it("vague valid work stays NEEDS_DETAILS without duplicating", () => {
    const vagueness = assessAmbiguity("Research Zeely for ads");
    expect(vagueness.blocksExecution).toBe(false);
    const items = [item({ id: "z", title: "Research Zeely", detailState: "NEEDS_DETAILS" })];
    expect(proposeTomorrowDraft(items)).toHaveLength(1);
  });

  it("critical ambiguity still blocks unsafe execution", () => {
    expect(assessAmbiguity("Send her the money.").blocksExecution).toBe(true);
  });

  it("overnight add and cancel are deterministic deltas", () => {
    const night = [item({ id: "a", title: "Rebecca dropoff" }), item({ id: "b", title: "Greystar visit" })];
    const morning = [item({ id: "a", title: "Rebecca dropoff" }), item({ id: "c", title: "Los Feliz pickup" })];
    const deltas = diffWorkdayPlans({
      confirmed: {
        businessDate: "2026-09-15",
        confirmedAt: "2026-09-15T02:00:00.000Z",
        actorId: "op",
        items: night,
        missingQuestion: null,
      },
      current: morning,
    });
    expect(deltas.map(delta => delta.kind).sort()).toEqual(["ADDED", "REMOVED"]);
    expect(speakMorningDelta(deltas)).toMatch(/changed overnight/i);
    expect(speakMorningDelta(deltas)).not.toMatch(/tell me your whole day/i);
  });

  it("hearsay remains hearsay and confirmation is required before persist", async () => {
    const extracted = extractConversationalFieldOutcome(
      "Dana wasn't there, I left the flyer, and she said she's usually here after ten."
    );
    expect(extracted?.hearsay.length).toBeGreaterThan(0);
    expect(extracted?.attestedFacts.join(" ")).not.toMatch(/confirmed schedule/i);
    const persistFieldCapture = vi.fn().mockResolvedValue({ ok: true, id: "ev-1" });
    const state: PendingProposalState = { pendingFieldCapture: extracted };
    await handleVoiceCommitmentTurn(
      {
        tenantId: "t",
        actorId: "op",
        businessDate: "2026-09-15",
        utterance: "wait",
        state,
      },
      { persistFieldCapture, propose: vi.fn() }
    );
    expect(persistFieldCapture).not.toHaveBeenCalled();
  });

  it("confirming tomorrow does not create a synthetic duplicate mission", async () => {
    const confirmPlan = vi.fn().mockResolvedValue(undefined);
    const result = await handleVoiceCommitmentTurn(
      {
        tenantId: "t",
        actorId: "op",
        businessDate: "2026-09-14",
        utterance: "Yes, that's tomorrow.",
        state: {},
      },
      { confirmPlan, classify: vi.fn(), propose: vi.fn() }
    );
    expect(confirmTomorrowUtterance("Yes, that's tomorrow.")).toBe(true);
    expect(result.kind).toBe("plan_confirmed");
    expect(confirmPlan).toHaveBeenCalledTimes(1);
  });

  it("assigned-action jargon is replaced and no destination means no fake approach", () => {
    expect(campaignHostCta("action_grammar")).toBe("START");
    expect(resolveApproachRoute({})).toBeNull();
    expect(nextApproachCorridor(null, "corridor_01")).toBeNull();
  });

  it("optional play cannot manufacture business truth", () => {
    expect(OPTIONAL_PLAY_CANNOT).toEqual(
      expect.arrayContaining([
        "add_customers",
        "create_orders",
        "create_revenue",
        "mark_visits_complete",
      ])
    );
  });
});
