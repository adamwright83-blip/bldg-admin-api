import { describe, expect, it } from "vitest";
import {
  GOLDLINE_PROGRESSION_RECENCY_DAYS,
  GOLDLINE_PROGRESSION_RULE_VERSION,
  classifyGoldlineArmoryOutcome,
  classifyGoldlineCallOutcome,
  classifyGoldlineVisitOutcome,
  projectGoldlineProgression,
  type GoldlineArmoryOutcomeEvidence,
  type GoldlineArmoryUsageEvidence,
  type GoldlineCallEvidence,
  type GoldlineFollowUpEvidence,
  type GoldlineMissionEvidence,
  type GoldlineProgressionEvidence,
} from "./goldlineProgression";

const ACTOR = "driver-a";
const NOW = new Date("2026-08-12T12:00:00.000Z");

function mission(
  missionId: number,
  overrides: Partial<GoldlineMissionEvidence> = {}
): GoldlineMissionEvidence {
  return {
    missionId,
    accountId: missionId,
    assignedTo: ACTOR,
    status: "phone_ready",
    pipelineStage: "field_ready",
    completedAt: null,
    updatedAt: "2026-08-10T12:00:00.000Z",
    ...overrides,
  };
}

function usage(
  missionId: number,
  overrides: Partial<GoldlineArmoryUsageEvidence> = {}
): GoldlineArmoryUsageEvidence {
  return {
    usageId: `usage-${missionId}`,
    missionId,
    actorId: ACTOR,
    weaponId: "foundation:gatekeeper:phone:when",
    frameworkId: null,
    archetype: "GATEKEEPER",
    channel: "phone",
    requestId: `request-${missionId}`,
    usedAt: `2026-08-${String(missionId).padStart(2, "0")}T08:00:00.000Z`,
    ...overrides,
  };
}

function call(
  missionId: number,
  outcome: GoldlineCallEvidence["outcome"] = "no_answer"
): GoldlineCallEvidence {
  return {
    eventId: missionId,
    missionId,
    actorId: ACTOR,
    outcome,
    createdAt: `2026-08-${String(missionId).padStart(2, "0")}T09:00:00.000Z`,
  };
}

function outcome(
  missionId: number,
  kind: GoldlineArmoryOutcomeEvidence["outcomeKind"] = "follow_up_created"
): GoldlineArmoryOutcomeEvidence {
  return {
    outcomeId: `outcome-${missionId}`,
    usageId: `usage-${missionId}`,
    missionId,
    actorId: ACTOR,
    outcomeKind: kind,
    outcomeReference: `business:${missionId}`,
    observedAt: `2026-08-${String(missionId).padStart(2, "0")}T10:00:00.000Z`,
  };
}

function evidence(
  overrides: Partial<GoldlineProgressionEvidence> = {}
): GoldlineProgressionEvidence {
  return {
    tenantId: "tenant-a",
    actorId: ACTOR,
    missions: [],
    calls: [],
    followUps: [],
    visits: [],
    recoveries: [],
    armoryUsages: [],
    armoryOutcomes: [],
    trainerFrameworks: [],
    scoutDiscoveries: [],
    ...overrides,
  };
}

function unlock(
  projection: ReturnType<typeof projectGoldlineProgression>,
  ruleId: string
) {
  return projection.unlocks.find(item => item.ruleId === ruleId);
}

function branch(
  projection: ReturnType<typeof projectGoldlineProgression>,
  branchId: string
) {
  return projection.branches.find(item => item.branchId === branchId);
}

describe("Goldline authoritative progression", () => {
  it("uses one central version and the explicit 90-day recency rule", () => {
    const projection = projectGoldlineProgression(evidence(), NOW);
    expect(projection.ruleVersion).toBe(GOLDLINE_PROGRESSION_RULE_VERSION);
    expect(projection.recencyDays).toBe(GOLDLINE_PROGRESSION_RECENCY_DAYS);
  });

  it("derives FIRST_CAPTURE and SCOUT only from explicit won business truth", () => {
    const projection = projectGoldlineProgression(
      evidence({
        missions: [
          mission(1, {
            status: "won",
            pipelineStage: "won",
            completedAt: "2026-08-11T12:00:00.000Z",
          }),
        ],
      }),
      NOW
    );
    expect(unlock(projection, "FIRST_CAPTURE")?.eligible).toBe(true);
    expect(unlock(projection, "CLOSED_WON")?.eligible).toBe(true);
    expect(
      projection.agents.find(agent => agent.agentId === "SCOUT")?.eligible
    ).toBe(true);
  });

  it("does not reinterpret generic closed/lost or game performance as won", () => {
    const projection = projectGoldlineProgression(
      evidence({
        missions: [
          mission(1, {
            status: "lost",
            pipelineStage: "lost",
            completedAt: "2026-08-11T12:00:00.000Z",
          }),
        ],
      }),
      NOW
    );
    expect(unlock(projection, "FIRST_CAPTURE")?.eligible).toBe(false);
    expect(unlock(projection, "CLOSED_WON")?.eligible).toBe(false);
  });

  it("requires a persisted backend recovery result, not recovery availability", () => {
    const available = projectGoldlineProgression(
      evidence({
        recoveries: [
          {
            missionId: 1,
            actorId: ACTOR,
            state: "recovery_available",
            verifiedAt: null,
            sourceRef: "commercial_follow_ups:f1",
          },
        ],
      }),
      NOW
    );
    expect(unlock(available, "FIRST_VERIFIED_RECOVERY")?.eligible).toBe(false);

    const persisted = projectGoldlineProgression(
      evidence({
        recoveries: [
          {
            missionId: 1,
            actorId: ACTOR,
            state: "recovery_active",
            verifiedAt: "2026-08-11T12:00:00.000Z",
            sourceRef: "driver_game_world_nodes:1",
          },
        ],
      }),
      NOW
    );
    expect(unlock(persisted, "FIRST_VERIFIED_RECOVERY")?.eligible).toBe(true);
  });

  it("correlates no-answer and follow-up by actor, mission, and chronology", () => {
    const followUp: GoldlineFollowUpEvidence = {
      followUpId: "follow-1",
      missionId: 1,
      status: "open",
      dueAt: "2026-08-13T12:00:00.000Z",
      assignedTo: ACTOR,
      createdBy: ACTOR,
      createdAt: "2026-08-11T10:00:00.000Z",
      completedAt: null,
      completedBy: null,
    };
    const valid = projectGoldlineProgression(
      evidence({
        calls: [
          { ...call(1, "no_answer"), createdAt: "2026-08-11T09:00:00.000Z" },
        ],
        followUps: [followUp],
      }),
      NOW
    );
    expect(unlock(valid, "FOLLOW_UP_AFTER_NO_ANSWER")?.eligible).toBe(true);
    expect(
      valid.agents.find(agent => agent.agentId === "FOLLOW_UP")?.eligible
    ).toBe(true);

    const unrelated = projectGoldlineProgression(
      evidence({ calls: [call(2, "no_answer")], followUps: [followUp] }),
      NOW
    );
    expect(unlock(unrelated, "FOLLOW_UP_AFTER_NO_ANSWER")?.eligible).toBe(
      false
    );
  });

  it("uses the authoritative visit outcome for completed field visit", () => {
    const projection = projectGoldlineProgression(
      evidence({
        visits: [
          {
            visitOutcomeId: 7,
            missionId: 1,
            recordedBy: ACTOR,
            outcome: "follow_up",
            createdAt: "2026-08-11T12:00:00.000Z",
          },
        ],
      }),
      NOW
    );
    expect(unlock(projection, "FIRST_COMPLETED_FIELD_VISIT")?.eligible).toBe(
      true
    );
  });

  it("projects OBSERVED and ACTIVE only after real mission actions", () => {
    const observed = projectGoldlineProgression(
      evidence({ armoryUsages: [usage(1)], calls: [call(1)] }),
      NOW
    );
    expect(branch(observed, "GATEKEEPER")?.state).toBe("OBSERVED");

    const active = projectGoldlineProgression(
      evidence({
        armoryUsages: [usage(1), usage(2), usage(3)],
        calls: [call(1), call(2), call(3)],
        armoryOutcomes: [outcome(1)],
      }),
      NOW
    );
    expect(branch(active, "GATEKEEPER")).toMatchObject({
      state: "ACTIVE",
      distinctMissionCount: 3,
      persistedRealActionCount: 3,
      relevantMoveUseCount: 3,
    });
    expect(
      active.agents.find(agent => agent.agentId === "INTEL")?.eligible
    ).toBe(true);
  });

  it("passes the deterministic Gatekeeper 8/6/2 deepening fixture", () => {
    const usages = Array.from({ length: 8 }, (_, index) =>
      usage(index + 1, {
        usedAt:
          index < 6
            ? `2026-08-${String(index + 1).padStart(2, "0")}T08:00:00.000Z`
            : `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
      })
    );
    const projection = projectGoldlineProgression(
      evidence({
        armoryUsages: usages,
        calls: Array.from({ length: 8 }, (_, index) => call(index + 1)),
        armoryOutcomes: [
          outcome(1),
          outcome(2, "account_won"),
          outcome(7, "no_change"),
          outcome(8, "no_change"),
        ],
        trainerFrameworks: [
          {
            frameworkId: "framework-1",
            sourceArtifactId: "source-1",
            archetype: "GATEKEEPER",
            channel: "phone",
            responseFamily: "timing",
            independentSourceSupportCount: 1,
            acceptedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
      NOW
    );
    expect(branch(projection, "GATEKEEPER")).toMatchObject({
      state: "DEEPENED",
      distinctMissionCount: 8,
      relevantMoveUseCount: 6,
      positiveAuthoritativeOutcomeCount: 2,
      positiveOutcomeMissionCount: 2,
    });
    expect(projection.techniques[0]).toMatchObject({
      eligible: true,
      deeperEligible: true,
      reviewOnly: false,
    });
  });

  it("cannot deepen from eight arcade-only mission encounters", () => {
    const projection = projectGoldlineProgression(
      evidence({
        armoryUsages: Array.from({ length: 8 }, (_, index) => usage(index + 1)),
      }),
      NOW
    );
    expect(branch(projection, "GATEKEEPER")?.state).toBe("LOCKED");
    expect(branch(projection, "GATEKEEPER")?.relevantMoveUseCount).toBe(0);
    expect(unlock(projection, "ARCHETYPE_EVIDENCE")?.eligible).toBe(false);
  });

  it("deduplicates repeated missions and duplicate source references", () => {
    const projection = projectGoldlineProgression(
      evidence({
        armoryUsages: [
          usage(1),
          usage(1, { usageId: "usage-1b", requestId: "request-1b" }),
        ],
        calls: [call(1), call(1)],
        armoryOutcomes: [outcome(1), outcome(1)],
      }),
      NOW
    );
    expect(branch(projection, "GATEKEEPER")?.distinctMissionCount).toBe(1);
    expect(branch(projection, "GATEKEEPER")?.persistedRealActionCount).toBe(1);
  });

  it("retains historical evidence but marks it STALE after 90 days", () => {
    const old = "2026-01-01T00:00:00.000Z";
    const projection = projectGoldlineProgression(
      evidence({
        armoryUsages: Array.from({ length: 8 }, (_, index) =>
          usage(index + 1, { usedAt: old })
        ),
        calls: Array.from({ length: 8 }, (_, index) => ({
          ...call(index + 1),
          createdAt: old,
        })),
        armoryOutcomes: [
          { ...outcome(1), observedAt: old },
          { ...outcome(2), observedAt: old },
        ],
      }),
      NOW
    );
    expect(branch(projection, "GATEKEEPER")).toMatchObject({
      state: "STALE",
      distinctMissionCount: 8,
      positiveOutcomeMissionCount: 2,
    });
  });

  it("keeps an unseen branch LOCKED", () => {
    const projection = projectGoldlineProgression(evidence(), NOW);
    expect(branch(projection, "STALLER")?.state).toBe("LOCKED");
  });

  it("does not let accepted trainer content alone unlock a technique or Intel", () => {
    const projection = projectGoldlineProgression(
      evidence({
        trainerFrameworks: [
          {
            frameworkId: "accepted-framework",
            sourceArtifactId: "source",
            archetype: "GATEKEEPER",
            channel: "phone",
            responseFamily: "timing",
            independentSourceSupportCount: 4,
            acceptedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
      NOW
    );
    expect(projection.techniques[0]?.eligible).toBe(false);
    expect(
      projection.agents.find(agent => agent.agentId === "INTEL")?.eligible
    ).toBe(false);
  });

  it("returns zero Agent mission candidates when source data is empty", () => {
    const projection = projectGoldlineProgression(
      evidence({
        missions: [
          mission(1, {
            status: "won",
            pipelineStage: "won",
            completedAt: "2026-08-11T12:00:00.000Z",
          }),
        ],
      }),
      NOW
    );
    expect(projection.missionCandidates).toEqual([]);
  });

  it("projects only source-referenced Scout and linked follow-up candidates", () => {
    const followUp: GoldlineFollowUpEvidence = {
      followUpId: "follow-1",
      missionId: 2,
      status: "open",
      dueAt: "2026-08-12T10:00:00.000Z",
      assignedTo: ACTOR,
      createdBy: ACTOR,
      createdAt: "2026-08-11T10:00:00.000Z",
      completedAt: null,
      completedBy: null,
    };
    const projection = projectGoldlineProgression(
      evidence({
        missions: [
          mission(1, {
            status: "won",
            pipelineStage: "won",
            completedAt: "2026-08-11T12:00:00.000Z",
          }),
        ],
        calls: [
          { ...call(2, "no_answer"), createdAt: "2026-08-11T09:00:00.000Z" },
        ],
        followUps: [followUp],
        scoutDiscoveries: [
          {
            reportId: "report-1",
            missionId: 3,
            actorId: ACTOR,
            sourceRef: "territory_scan_results:scan-1:real-place",
            generatedAt: "2026-08-11T11:00:00.000Z",
          },
        ],
      }),
      NOW
    );
    expect(projection.missionCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "SCOUT",
          missionId: 3,
          sourceRef: "territory_scan_results:scan-1:real-place",
        }),
        expect.objectContaining({
          agentId: "FOLLOW_UP",
          missionId: 2,
          affordance: "FOLLOW_UP",
          sourceRef: "commercial_follow_ups:follow-1",
        }),
      ])
    );
    expect(
      projection.missionCandidates.every(
        candidate => candidate.sourceRef.length > 0
      )
    ).toBe(true);
  });

  it("scopes every progression input to the requested identity", () => {
    const projection = projectGoldlineProgression(
      evidence({
        actorId: "driver-b",
        missions: [
          mission(1, {
            assignedTo: ACTOR,
            status: "won",
            pipelineStage: "won",
            completedAt: "2026-08-11T12:00:00.000Z",
          }),
        ],
        armoryUsages: [usage(1)],
      }),
      NOW
    );
    expect(unlock(projection, "FIRST_CAPTURE")?.eligible).toBe(false);
    expect(branch(projection, "GATEKEEPER")?.state).toBe("LOCKED");
  });

  it("uses an explicit real-outcome classifier with no game score input", () => {
    expect(classifyGoldlineCallOutcome("visit_booked")).toBe(
      "positive_evidence"
    );
    expect(classifyGoldlineCallOutcome("no_answer")).toBe("unresolved");
    expect(classifyGoldlineArmoryOutcome("account_won")).toBe(
      "positive_evidence"
    );
    expect(classifyGoldlineArmoryOutcome("account_lost")).toBe(
      "negative_evidence"
    );
    expect(classifyGoldlineVisitOutcome("won")).toBe("positive_evidence");
    expect(classifyGoldlineVisitOutcome("lost")).toBe("negative_evidence");
  });

  it("has no XP, player level, Agent level, or client unlock mutation contract", () => {
    const serialized = JSON.stringify(
      projectGoldlineProgression(evidence(), NOW)
    );
    expect(serialized).not.toMatch(/"xp"|playerLevel|agentLevel|skillLevel/i);
  });
});
