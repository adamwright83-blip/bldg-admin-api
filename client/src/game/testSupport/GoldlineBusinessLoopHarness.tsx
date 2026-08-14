import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import type {
  CommercialMission,
  CommercialMissionStatus,
} from "../../../../shared/commercialMission";
import type {
  DriverGameWorldNode,
  WorldMissionState,
} from "../../../../shared/driverGameWorld";
import type {
  ArmoryItem,
  ArmoryWeapon,
} from "../../../../server/armory/armoryTypes";
import GoldlineGameHome from "../GoldlineGameHome";
import type {
  GoldlineActionServices,
  GoldlineVisitContext,
} from "../actions/actionServices";

const FIXTURES = ["CALL", "VISIT", "FOLLOW_UP", "RECOVER", "STALLER"] as const;
type BusinessLoopFixture = (typeof FIXTURES)[number];

type FixtureWrite = {
  kind:
    | "CALL_ATTEMPT"
    | "FIELD_PREPARE"
    | "FIELD_DEPART"
    | "FIELD_ARRIVE"
    | "FIELD_OUTCOME"
    | "FOLLOW_UP_COMPLETE"
    | "FOLLOW_UP_RESCHEDULE"
    | "RECOVER";
  missionId: number;
  requestId: string;
};

type FixtureProof = {
  fixture: BusinessLoopFixture;
  writes: FixtureWrite[];
  refetches: number;
  projectedState: WorldMissionState;
};

declare global {
  interface Window {
    __GOLDLINE_BUSINESS_FIXTURE__?: FixtureProof;
  }
}

type PendingTruth = {
  missionStatus: CommercialMissionStatus;
  visualState: WorldMissionState;
  contestedUntil: string | null;
  unlockedPath: string | null;
  isHistorical: boolean;
};

const MISSION_ID = 7801;
const PAST_DUE = "2026-08-01T12:00:00.000Z";
const FOLLOW_UP_ID = "1cba7f83-9f6f-42c2-a819-d2556cf19f78";

const ANCHOR_ITEM: ArmoryItem = {
  id: "fixture:no-risk-trial",
  title: "NO-RISK TRIAL",
  cue: "Switching feels risky",
  response: "Try one run without replacing the current provider.",
  outcome: "guidance",
  provenance: "foundation",
  sourceReference: "fixture:armory:no-risk-trial",
};

function fixtureKind(value: string): BusinessLoopFixture {
  const match = FIXTURES.find(candidate => candidate === value.toUpperCase());
  if (!match) throw new Error(`Unsupported Goldline browser fixture: ${value}`);
  return match;
}

function initialMissionStatus(
  fixture: BusinessLoopFixture
): CommercialMissionStatus {
  return fixture === "FOLLOW_UP" ||
    fixture === "RECOVER" ||
    fixture === "STALLER"
    ? "follow_up"
    : "phone_ready";
}

function initialWorldState(fixture: BusinessLoopFixture): WorldMissionState {
  if (fixture === "FOLLOW_UP") return "contested";
  if (fixture === "STALLER") return "contested";
  if (fixture === "RECOVER") return "recovery_available";
  return "active";
}

function commercialMission(
  fixture: BusinessLoopFixture,
  status: CommercialMissionStatus,
  version: number
): CommercialMission {
  const hasPhone = fixture !== "VISIT";
  return {
    id: MISSION_ID,
    tenantId: "goldline-browser-fixture",
    code: "MISSION 7801",
    status,
    version,
    assignedTo: "goldline-e2e",
    opsTaskId: null,
    account: {
      accountId: 7801,
      name: `${fixture} Authoritative Fixture`,
      accountType: "commercial",
      address: "7801 Goldline Way, Los Angeles, CA 90001",
      latitude: 34.0522,
      longitude: -118.2437,
      locationCount: 1,
      decisionMaker: {
        name: hasPhone ? "Casey Fixture" : null,
        title: hasPhone ? "Operations Director" : null,
        phone: hasPhone ? "+13235550100" : null,
      },
    },
    opportunity: {
      opportunityId: 7801,
      estimatedAnnualValueCents: 240_000,
      estimateConfidence: "high",
      score: 80,
      primarySignal: "deterministic_browser_fixture",
      reasons: ["Permanent Goldline release proof"],
      risks: [],
    },
    brief: {
      laundryOpportunity: "Browser fixture only",
      salesAngle: "Browser fixture only",
      openingLine: "Browser fixture only",
      discoveryQuestions: [],
      objections: [],
    },
    steps: [],
    expiresAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    completedAt:
      status === "won" || status === "lost" ? "2026-08-12T00:00:00.000Z" : null,
  };
}

function worldNode(
  fixture: BusinessLoopFixture,
  truth: PendingTruth,
  version: number
): DriverGameWorldNode {
  return {
    missionId: MISSION_ID,
    entityType: "commercial_mission",
    entityId: String(MISSION_ID),
    accountId: 7801,
    accountName: `${fixture} Authoritative Fixture`,
    locationId: 7801,
    missionStatus: truth.missionStatus,
    visualState: truth.visualState,
    worldAnchor:
      truth.visualState === "recovery_active"
        ? "gold_side_entrance"
        : "fortress_gate",
    unlockedPath: truth.unlockedPath,
    discoveryState: "engaged",
    contestedUntil: truth.contestedUntil,
    verifiedAnnualValueCents: truth.visualState === "captured" ? 240_000 : null,
    realizedRevenueCents: 0,
    lossReason: null,
    version,
    isTodayActive: !truth.isHistorical,
    isHistorical: truth.isHistorical,
    regionKey:
      truth.visualState === "recovery_active"
        ? "gold_side_entrance"
        : "fortress_gate",
    resolvedAt: truth.isHistorical ? "2026-08-12T00:00:00.000Z" : null,
  };
}

function visitContext(
  status: GoldlineVisitContext["mission"]["status"],
  version: number
): GoldlineVisitContext {
  const hasField = status !== "phone_ready";
  return {
    mission: { id: MISSION_ID, version, status },
    field: hasField
      ? {
          version,
          notes: "",
          preparationStartedAt: "2026-08-12T08:00:00.000Z",
          departedAt:
            status === "en_route" || status === "arrived" || status === "won"
              ? "2026-08-12T08:15:00.000Z"
              : null,
          arrivedAt:
            status === "arrived" || status === "won"
              ? "2026-08-12T08:30:00.000Z"
              : null,
        }
      : null,
    checklist: hasField
      ? [
          {
            itemKey: "fixture-ready",
            label: "Fixture preparation verified",
            required: true,
            status: "completed",
          },
        ]
      : [],
    visitOutcome:
      status === "won" ? { outcome: "won", followUpAt: null } : null,
    proposal: hasField
      ? {
          id: "fixture-proposal",
          status: "approved",
          validThrough: "2027-08-12T00:00:00.000Z",
        }
      : null,
    navigationUrl:
      "https://www.google.com/maps/dir/?api=1&destination=7801%20Goldline%20Way",
  };
}

function baselineWeapon(
  archetype: ArmoryWeapon["archetype"],
  channel: ArmoryWeapon["channel"]
): ArmoryWeapon {
  return {
    id: `fixture:${archetype}:${channel}:when`,
    archetype,
    channel,
    title: "FIND THE REAL WHEN",
    responseFamily: "timing",
    spokenLine: "What real time works for the next step?",
    discoveryQuestion: "When should the next real contact happen?",
    principle: "Record reality rather than inferring it.",
    exampleLanguage: [],
    whenToUse: ["A real mission needs a next step"],
    whenNotToUse: ["No authoritative mission exists"],
    provenance: {
      type: "foundation",
      sourceReference: "fixture:foundation:when",
    },
    personalEvidence: null,
    fit: "high",
    fitReason: "Deterministic browser fixture",
  };
}

export default function GoldlineBusinessLoopHarness(props: {
  fixture: string;
}) {
  const fixture = fixtureKind(props.fixture);
  const initialTruth = useMemo<PendingTruth>(
    () => ({
      missionStatus: initialMissionStatus(fixture),
      visualState: initialWorldState(fixture),
      contestedUntil:
        fixture === "STALLER"
          ? "2026-08-20T12:00:00.000Z"
          : fixture === "FOLLOW_UP" || fixture === "RECOVER"
            ? PAST_DUE
            : null,
      unlockedPath: fixture === "RECOVER" ? "gold_recovery_path" : null,
      isHistorical: false,
    }),
    [fixture]
  );
  const [truth, setTruth] = useState(initialTruth);
  const [truthVersion, setTruthVersion] = useState(1);
  const [worldMounted, setWorldMounted] = useState(true);
  const pendingTruth = useRef<PendingTruth | null>(null);
  const visit = useRef(visitContext("phone_ready", 1));
  const proof = useRef<FixtureProof>({
    fixture,
    writes: [],
    refetches: 0,
    projectedState: initialTruth.visualState,
  });

  useEffect(() => {
    window.__GOLDLINE_BUSINESS_FIXTURE__ = proof.current;
    return () => {
      delete window.__GOLDLINE_BUSINESS_FIXTURE__;
    };
  }, []);

  function recordWrite(write: FixtureWrite): void {
    proof.current.writes.push(write);
  }

  function stageTruth(next: PendingTruth): void {
    pendingTruth.current = next;
  }

  const services = useMemo<GoldlineActionServices>(
    () => ({
      recordCall: async request => {
        recordWrite({
          kind: request.kind,
          missionId: request.missionId,
          requestId: request.requestId,
        });
        // The production CALL adapter owns its authoritative refetch inside
        // `recordCall`; unlike the other surfaces, RealActionBridge does not
        // invoke refetchAuthoritativeTruth separately.
        proof.current.refetches += 1;
      },
      loadVisit: async () => visit.current,
      startVisitPreparation: async input => {
        recordWrite({ kind: "FIELD_PREPARE", ...input });
        visit.current = visitContext("preparing", 2);
        stageTruth({ ...truth, missionStatus: "preparing" });
        return visit.current;
      },
      updateChecklistItem: async () => {
        throw new Error("Not exercised by this fixture — prep starts ready");
      },
      departVisit: async input => {
        recordWrite({ kind: "FIELD_DEPART", ...input });
        visit.current = visitContext("en_route", 3);
        stageTruth({ ...truth, missionStatus: "en_route" });
        return visit.current;
      },
      arriveVisit: async input => {
        recordWrite({ kind: "FIELD_ARRIVE", ...input });
        visit.current = visitContext("arrived", 4);
        stageTruth({ ...truth, missionStatus: "arrived" });
        return visit.current;
      },
      recordVisitOutcome: async input => {
        recordWrite({
          kind: "FIELD_OUTCOME",
          missionId: input.missionId,
          requestId: input.requestId,
        });
        visit.current = visitContext(input.outcome, 6);
        stageTruth({
          missionStatus: input.outcome,
          visualState:
            input.outcome === "won"
              ? "captured"
              : input.outcome === "lost"
                ? "closed"
                : "contested",
          contestedUntil:
            input.outcome === "follow_up"
              ? (input.followUpAt?.toISOString() ?? null)
              : null,
          unlockedPath: null,
          isHistorical: input.outcome !== "follow_up",
        });
        return visit.current;
      },
      loadFollowUp: async () =>
        fixture === "FOLLOW_UP"
          ? {
              pipelineId: 7801,
              followUpId: FOLLOW_UP_ID,
              dueAt: PAST_DUE,
              note: "Authoritative browser fixture",
              channel: "phone",
            }
          : null,
      completeFollowUp: async input => {
        recordWrite({
          kind: "FOLLOW_UP_COMPLETE",
          missionId: MISSION_ID,
          requestId: input.requestId,
        });
        stageTruth({
          ...truth,
          missionStatus: "follow_up",
          visualState: "contested",
          contestedUntil: null,
        });
      },
      rescheduleFollowUp: async input => {
        recordWrite({
          kind: "FOLLOW_UP_RESCHEDULE",
          missionId: MISSION_ID,
          requestId: input.requestId,
        });
        stageTruth({
          ...truth,
          missionStatus: "follow_up",
          visualState: "contested",
          contestedUntil: input.dueAt.toISOString(),
        });
      },
      recover: async input => {
        recordWrite({ kind: "RECOVER", ...input });
        const next: PendingTruth = {
          ...truth,
          missionStatus: "follow_up",
          visualState: "recovery_active",
          unlockedPath: "gold_recovery_path",
        };
        stageTruth(next);
        return worldNode(fixture, next, truthVersion + 1);
      },
      scout: async () => {
        throw new Error("Scout is outside this action-specific fixture");
      },
      refetchAuthoritativeTruth: async () => {
        proof.current.refetches += 1;
        const next = pendingTruth.current;
        if (!next) return;
        pendingTruth.current = null;
        proof.current.projectedState = next.visualState;
        setTruth(next);
        setTruthVersion(value => value + 1);
      },
    }),
    [fixture, truth, truthVersion]
  );

  const gameProps: ComponentProps<typeof GoldlineGameHome> = {
    playerIdentity: "goldline-e2e",
    salesMissions: [
      commercialMission(fixture, truth.missionStatus, truthVersion),
    ],
    worldNodes: [worldNode(fixture, truth, truthVersion)],
    location: {
      status: "unavailable",
      coordinates: null,
      accuracyMeters: null,
      reason: "Deterministic browser fixture",
    },
    dayResolution: null,
    selectedDate: "2026-08-12",
    onSelectedDateChange: () => undefined,
    onResolveOrder: async () => false,
    onAcceptMove: async () => undefined,
    onOpenWalkIn: () => undefined,
    onOpenNewOrder: () => undefined,
    onOpenJournal: () => undefined,
    onResolveDay: async () => undefined,
    onGenerateOpenChannel: async () => undefined,
    onApproveOpenChannel: async () => undefined,
    onCompleteOpenChannelTask: async () => false,
    onBeginRekindle: async missionId =>
      worldNode(
        fixture,
        { ...truth, visualState: "recovery_active" },
        missionId
      ),
    coldCallEligibleCount: 0,
    coldCallEmptyReason: "No fixture targets",
    onCreateColdCall: async () => null,
    onStartColdCall: async () => {
      throw new Error("Cold Call Burst is outside this fixture");
    },
    onCompleteColdCall: async () => {
      throw new Error("Cold Call Burst is outside this fixture");
    },
    onSelectColdCallChain: async () => {
      throw new Error("Cold Call Burst is outside this fixture");
    },
    onBreakColdCallCombo: async () => {
      throw new Error("Cold Call Burst is outside this fixture");
    },
    onEvaluateScout: async () => undefined,
    onRunScout: async () => undefined,
    armory: {
      items: [ANCHOR_ITEM],
      archetypes: [],
      currentTactic: {
        title: "Fixture tactic",
        cue: "Fixture only",
        response: "Fixture only",
        followUp: "Fixture only",
        provenance: "foundation",
        sourceLabel: "Permanent browser gate",
      },
    },
    onRequestWeapons: async input => ({
      weapons: [baselineWeapon(input.archetype, input.channel)],
      trainerIntelligenceAvailable: false,
    }),
    onRecordWeaponUsage: async () => undefined,
    actionServices: services,
  };

  return (
    <>
      <button
        type="button"
        data-testid="goldline-fixture-toggle-world"
        onClick={() => setWorldMounted(value => !value)}
      >
        {worldMounted ? "DESTROY FIXTURE WORLD" : "MOUNT FIXTURE WORLD"}
      </button>
      {worldMounted ? <GoldlineGameHome {...gameProps} /> : null}
    </>
  );
}
