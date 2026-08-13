import {
  projectGoldlineProgression,
  type GoldlineArmoryUsageEvidence,
  type GoldlineCallEvidence,
  type GoldlineProgressionEvidence,
} from "../../../../shared/goldlineProgression";
import { selectMissionDirector } from "../state/MissionDirector";
import type { PlayableMission } from "../state/GameState";

const ACTOR = "progression-driver-a";
const NOW = new Date("2026-08-12T12:00:00.000Z");

function base(
  overrides: Partial<GoldlineProgressionEvidence> = {}
): GoldlineProgressionEvidence {
  return {
    tenantId: "goldline-progression-browser-fixture",
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

function usage(
  missionId: number,
  usedAt?: string
): GoldlineArmoryUsageEvidence {
  return {
    usageId: `browser-usage-${missionId}`,
    missionId,
    actorId: ACTOR,
    weaponId: "foundation:ask-timing",
    frameworkId: null,
    archetype: "GATEKEEPER",
    channel: "phone",
    requestId: `browser-request-${missionId}`,
    usedAt:
      usedAt ?? `2026-08-${String(missionId).padStart(2, "0")}T08:00:00.000Z`,
  };
}

function call(missionId: number): GoldlineCallEvidence {
  return {
    eventId: missionId,
    missionId,
    actorId: ACTOR,
    outcome: "no_answer",
    createdAt: `2026-08-${String(missionId).padStart(2, "0")}T09:00:00.000Z`,
  };
}

function playable(
  missionId: number,
  key: string,
  state: PlayableMission["state"]
): PlayableMission {
  return {
    key,
    missionId,
    moveId: null,
    name: key,
    address: null,
    navigationUrl: null,
    phoneUrl: null,
    destinationPath: null,
    state,
    timeBurdenMinutes: null,
    travelBurdenMinutes: null,
    estimatedValueLowCents: null,
    estimatedValueHighCents: null,
    confidence: "unknown",
    expiresAt: null,
    contestedUntil: null,
    verifiedAnnualValueCents: null,
    realizedRevenueCents: 0,
    unlockedPath: null,
    lossReason: null,
  };
}

export default function GoldlineProgressionHarness() {
  const capturedEvidence = base({
    missions: [
      {
        missionId: 101,
        accountId: 101,
        assignedTo: ACTOR,
        status: "won",
        pipelineStage: "won",
        completedAt: "2026-08-10T12:00:00.000Z",
        updatedAt: "2026-08-10T12:00:00.000Z",
      },
    ],
  });
  const captured = projectGoldlineProgression(capturedEvidence, NOW);
  const noEvidence = projectGoldlineProgression(base(), NOW);
  const followUp = projectGoldlineProgression(
    base({
      calls: [
        {
          eventId: 201,
          missionId: 201,
          actorId: ACTOR,
          outcome: "no_answer",
          createdAt: "2026-08-10T08:00:00.000Z",
        },
      ],
      followUps: [
        {
          followUpId: "browser-follow-up",
          missionId: 201,
          status: "open",
          dueAt: "2026-08-11T08:00:00.000Z",
          assignedTo: ACTOR,
          createdBy: ACTOR,
          createdAt: "2026-08-10T09:00:00.000Z",
          completedAt: null,
          completedBy: null,
        },
      ],
    }),
    NOW
  );
  const recovered = projectGoldlineProgression(
    base({
      recoveries: [
        {
          missionId: 301,
          actorId: ACTOR,
          state: "recovery_active",
          verifiedAt: "2026-08-11T12:00:00.000Z",
          sourceRef: "driver_game_world_nodes:mission:301",
        },
      ],
    }),
    NOW
  );
  const usages = Array.from({ length: 8 }, (_, index) =>
    usage(
      index + 1,
      index < 6
        ? undefined
        : `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`
    )
  );
  const deepened = projectGoldlineProgression(
    base({
      armoryUsages: usages,
      calls: Array.from({ length: 8 }, (_, index) => call(index + 1)),
      armoryOutcomes: [1, 2, 7, 8].map(missionId => ({
        outcomeId: `browser-outcome-${missionId}`,
        usageId: `browser-usage-${missionId}`,
        missionId,
        actorId: ACTOR,
        outcomeKind:
          missionId <= 2
            ? ("follow_up_created" as const)
            : ("no_change" as const),
        outcomeReference: `commercial_follow_ups:browser-${missionId}`,
        observedAt: `2026-08-0${missionId}T11:00:00.000Z`,
      })),
      trainerFrameworks: [
        {
          frameworkId: "browser-framework",
          sourceArtifactId: "browser-source",
          archetype: "GATEKEEPER",
          channel: "phone",
          responseFamily: "seek_callback_window",
          independentSourceSupportCount: 1,
          acceptedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    }),
    NOW
  );
  const arcadeOnly = projectGoldlineProgression(
    base({
      armoryUsages: Array.from({ length: 8 }, (_, index) => usage(index + 1)),
    }),
    NOW
  );
  const stale = projectGoldlineProgression(
    base({
      armoryUsages: [usage(401, "2026-01-01T08:00:00.000Z")],
      calls: [{ ...call(401), createdAt: "2026-01-01T09:00:00.000Z" }],
    }),
    NOW
  );
  const contentOnly = projectGoldlineProgression(
    base({
      trainerFrameworks: deepened.techniques.map(technique => ({
        frameworkId: technique.frameworkId,
        sourceArtifactId: "browser-source",
        archetype: technique.branchId,
        channel: technique.channel,
        responseFamily: "seek_callback_window",
        independentSourceSupportCount: 1,
        acceptedAt: "2026-08-01T00:00:00.000Z",
      })),
    }),
    NOW
  );
  const isolated = projectGoldlineProgression(
    { ...capturedEvidence, actorId: "progression-driver-b" },
    NOW
  );
  const missionDirector = selectMissionDirector(
    [
      playable(1, "progression-relevant", "available"),
      playable(999, "real-recovery", "recovery_active"),
    ],
    NOW,
    deepened
  );
  const deepChallenge = selectMissionDirector(
    [playable(1, "progression-relevant", "available")],
    NOW,
    deepened
  );
  const branch = (projection: typeof deepened, id: "GATEKEEPER" | "STALLER") =>
    projection.branches.find(item => item.branchId === id)?.state ?? "MISSING";
  const eligible = (projection: typeof deepened, ruleId: string) =>
    projection.unlocks.find(item => item.ruleId === ruleId)?.eligible ?? false;
  const agent = (projection: typeof deepened, agentId: string) =>
    projection.agents.find(item => item.agentId === agentId)?.eligible ?? false;

  return (
    <main
      data-testid="goldline-progression-harness"
      data-first-capture={eligible(captured, "FIRST_CAPTURE")}
      data-scout={agent(captured, "SCOUT")}
      data-fake-arcade-capture={eligible(noEvidence, "FIRST_CAPTURE")}
      data-follow-up-agent={agent(followUp, "FOLLOW_UP")}
      data-verified-recovery={eligible(recovered, "FIRST_VERIFIED_RECOVERY")}
      data-gatekeeper={branch(deepened, "GATEKEEPER")}
      data-arcade-gatekeeper={branch(arcadeOnly, "GATEKEEPER")}
      data-unseen-staller={branch(deepened, "STALLER")}
      data-content-only={branch(contentOnly, "GATEKEEPER")}
      data-stale={branch(stale, "GATEKEEPER")}
      data-zero-source-candidates={captured.missionCandidates.length}
      data-identity-b-first-capture={eligible(isolated, "FIRST_CAPTURE")}
      data-director-primary={missionDirector.primary?.key ?? "NONE"}
      data-challenge-depth={deepChallenge.challengeDepth}
      data-rule-version={captured.ruleVersion}
    >
      AUTHORITATIVE PROGRESSION FIXTURE
    </main>
  );
}
