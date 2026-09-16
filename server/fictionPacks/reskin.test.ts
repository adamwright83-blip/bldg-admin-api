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
  type CampaignTarget,
  type CampaignTargetEvent,
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

const targets: CampaignTarget[] = Array.from({ length: TOTAL }, (_, index) => ({
  targetId: `t${index + 1}`,
  targetSetId: "set-reskin",
  label: `Target ${index + 1}`,
  address: `${index + 1} Example Street`,
  lat: null,
  lng: null,
  placementPoint: "front_door_knob",
  sourceNote: "operator confirmed access from the sidewalk",
  provenance: "operator_observed",
}));

/** One presence event, then `placed` qualifying placements across two days. */
function eventsFor(placed: number): CampaignTargetEvent[] {
  const presence: CampaignTargetEvent = {
    eventId: "p1",
    campaignRunId: RUN,
    targetId: null,
    kind: "territory_presence",
    occurredAt: "2026-09-16T17:00:00.000Z",
    operatorUserId: "op-1",
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    note: null,
  };
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
    supportingPresenceEventId: "p1",
    replacementTargetId: null,
    note: null,
  }));
  return [presence, ...placements];
}

function slotsFor(pack: FictionPack, placed: number): FictionSlots {
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
        targets,
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
      targets,
      events: eventsFor(18),
    });

    const plain = resolveReachedBeats(
      PLAIN_OPERATION_PACK,
      progress.fraction,
      slotsFor(PLAIN_OPERATION_PACK, 18)
    );
    const drama = resolveReachedBeats(
      BIO_CONTAINMENT_PACK,
      progress.fraction,
      slotsFor(BIO_CONTAINMENT_PACK, 18)
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
      targets,
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
      slotsFor(PLAIN_OPERATION_PACK, 24)
    );
    const drama = composeCompletion(
      BIO_CONTAINMENT_PACK,
      tempo,
      slotsFor(BIO_CONTAINMENT_PACK, 24)
    );

    expect(progress.complete).toBe(true);
    expect(plain.tier).toBe(drama.tier);
    expect(plain.victory).not.toBe(drama.victory);
    expect(drama.victory).toContain("GRID COMPLETE");
  });

  it("shows held ground under both packs while incomplete, never a verdict", () => {
    const progress = deriveRunProgress({
      campaignRunId: RUN,
      targets,
      events: eventsFor(10),
    });
    for (const pack of [PLAIN_OPERATION_PACK, BIO_CONTAINMENT_PACK]) {
      const copy = resolveIncompleteCopy(
        pack,
        { campaignHasFailureCondition: false, failureConditionMet: false },
        slotsFor(pack, 10)
      );
      expect(copy.kind).toBe("echo");
      expect(copy.text).toContain("10");
      expect(copy.text).toContain("14");
    }
  });

  it("switching packs never changes what the evidence proved", () => {
    const events = eventsFor(12);
    const before = deriveRunProgress({ campaignRunId: RUN, targets, events });
    const after = deriveRunProgress({ campaignRunId: RUN, targets, events });
    expect(after).toEqual(before);
  });
});
