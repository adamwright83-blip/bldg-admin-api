/**
 * THE DONE CONDITION — docs/goldline/FICTION_PACKS.md section 11.
 *
 *   "Same Campaign Run. Same targets. Same evidence. Same completion
 *    calculation. Change only the fiction-pack binding, and the mundane
 *    operation becomes the counter-terror operation."
 *
 * If this file ever needs the truth layer to change in order to pass, the
 * abstraction has failed and the slice is not done.
 */
import { describe, expect, it } from "vitest";
import {
  deriveRunCadence,
  deriveRunProgress,
  type CampaignTargetEvent,
  type RunTargetSlot,
} from "../../shared/campaignRun";
import {
  composeCompletion,
  resolveIncompleteCopy,
  resolveReachedBeats,
  type FictionPack,
  type FictionSlots,
} from "../../shared/fictionPack";
import { BIO_CONTAINMENT_PACK } from "./bioContainment";
import { PLAIN_OPERATION_PACK } from "./plainOperation";

const RUN = "run-reskin";
const TOTAL = 24;

const slots: RunTargetSlot[] = Array.from({ length: TOTAL }, (_, index) => ({
  campaignRunId: RUN,
  slotId: `slot-${index + 1}`,
  originalTargetId: `t${index + 1}`,
}));

function presenceAt(eventId: string, occurredAt: string): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId: null,
    kind: "territory_presence",
    occurredAt,
    operatorUserId: "op-1",
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    lat: 34.07,
    lng: -118.4,
    accuracyMeters: 10,
    note: null,
  };
}

/**
 * Two real field sessions, each opened by its own presence ping, because one
 * ping does not vouch for work days later.
 */
function eventsFor(placed: number): CampaignTargetEvent[] {
  const day1 = presenceAt("p1", "2026-09-16T17:00:00.000Z");
  const day2 = presenceAt("p2", "2026-09-17T17:00:00.000Z");
  const placements = Array.from({ length: placed }, (_, index) => ({
    eventId: `e${index + 1}`,
    campaignRunId: RUN,
    targetId: `t${index + 1}`,
    kind: "placement_reported" as const,
    occurredAt:
      index < 10
        ? `2026-09-16T17:${String(10 + index).padStart(2, "0")}:00.000Z`
        : `2026-09-17T17:${String(index).padStart(2, "0")}:00.000Z`,
    operatorUserId: "op-1",
    provenance: "operator_reported" as const,
    epistemicState: "confirmed" as const,
    supportingPresenceEventId: index < 10 ? "p1" : "p2",
    replacementTargetId: null,
    lat: null,
    lng: null,
    accuracyMeters: null,
    note: null,
  }));
  return [day1, day2, ...placements];
}

function packSlots(pack: FictionPack, placed: number): FictionSlots {
  return {
    count: String(placed),
    total: String(TOTAL),
    remaining: String(TOTAL - placed),
    unit: pack.objectiveLabels.unit,
    unitPlural: pack.objectiveLabels.unitPlural,
    actionVerb: pack.objectiveLabels.action,
  };
}

describe("re-skin test", () => {
  it("computes identical truth under both packs at every stage", () => {
    for (const placed of [0, 6, 12, 18, 24]) {
      const progress = deriveRunProgress({
        campaignRunId: RUN,
        slots,
        events: eventsFor(placed),
      });
      expect(progress.qualified).toBe(placed);
      expect(progress.total).toBe(TOTAL);
      expect(progress.fraction).toBe(placed / TOTAL);
      expect(progress.complete).toBe(placed === TOTAL);
    }
  });

  it("fires the same beat positions under both packs, with different words", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots,
      events: eventsFor(18),
    });

    const plain = resolveReachedBeats(
      PLAIN_OPERATION_PACK,
      progress.fraction,
      packSlots(PLAIN_OPERATION_PACK, 18)
    );
    const drama = resolveReachedBeats(
      BIO_CONTAINMENT_PACK,
      progress.fraction,
      packSlots(BIO_CONTAINMENT_PACK, 18)
    );

    expect(plain.length).toBe(drama.length);
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.map(beat => beat.text)).not.toEqual(
      drama.map(beat => beat.text)
    );
    expect(drama.at(-1)?.text).toContain("18");
    expect(plain.at(-1)?.text).toContain("18");
  });

  it("reaches completion at the same moment and grades the same tier", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots,
      events: eventsFor(24),
    });
    const cadence = deriveRunCadence(progress);
    const tempo = {
      sessionCount: cadence.sessionCount,
      largestGapDays: cadence.largestGapDays,
    };

    const plain = composeCompletion(
      PLAIN_OPERATION_PACK,
      tempo,
      packSlots(PLAIN_OPERATION_PACK, 24)
    );
    const drama = composeCompletion(
      BIO_CONTAINMENT_PACK,
      tempo,
      packSlots(BIO_CONTAINMENT_PACK, 24)
    );

    expect(progress.complete).toBe(true);
    expect(plain.tier).toBe(drama.tier);
    expect(plain.victory).not.toBe(drama.victory);
    expect(drama.victory).toContain("GRID COMPLETE");
  });

  it("shows held ground under both packs while incomplete, never a verdict", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      slots,
      events: eventsFor(10),
    });
    for (const pack of [PLAIN_OPERATION_PACK, BIO_CONTAINMENT_PACK]) {
      const copy = resolveIncompleteCopy(
        pack,
        { campaignHasFailureCondition: false, failureConditionMet: false },
        packSlots(pack, 10)
      );
      expect(copy.kind).toBe("echo");
      expect(copy.text).toContain("10");
      expect(copy.text).toContain("14");
    }
  });

  it("switching packs never changes what the evidence proved", () => {
    const events = eventsFor(12);
    const before = deriveRunProgress({ campaignRunId: RUN, slots, events });
    const after = deriveRunProgress({ campaignRunId: RUN, slots, events });
    expect(after).toEqual(before);
  });
});
