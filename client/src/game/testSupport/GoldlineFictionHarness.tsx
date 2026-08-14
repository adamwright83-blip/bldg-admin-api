import { useMemo, useRef, useState, type ComponentProps } from "react";
import type {
  CommercialMission,
  CommercialMissionStatus,
} from "../../../../shared/commercialMission";
import type { DriverGameWorldNode } from "../../../../shared/driverGameWorld";
import type { ArmoryItem } from "../../../../server/armory/armoryTypes";
import type {
  FieldMoveCandidate,
  FieldMovesResult,
} from "../../../../server/field/types";
import type { AuthoritativeVisitRouteProjection } from "../../../../server/field/types";
import GoldlineGameHome from "../GoldlineGameHome";
import type {
  GoldlineActionServices,
  GoldlineVisitContext,
} from "../actions/actionServices";
import type { DriverSafeSalesIntel } from "../../../../shared/driverSafeSalesIntel";

/**
 * Deterministic per-mission visit state machine backing the NEUTRALIZE route
 * stops' in-game VISIT surface — mirrors the real production status
 * sequence (phone_ready -> preparing -> en_route -> arrived) exercised by
 * `GoldlineActionSurface`'s `VisitSurface`, so the browser proof for
 * "Keep NEUTRALIZE Commercial Visits In-Game" exercises the real UI states
 * without a database. Never used for anything but this fixture harness.
 */
type FixtureVisitStatus = "phone_ready" | "preparing" | "en_route" | "arrived";

/**
 * Genuine field prep starts INCOMPLETE — mirrors production, where
 * `fieldStartPreparation` seeds a required, pending checklist item that the
 * driver must actually complete (via the same `fieldChecklist` mutation the
 * in-game surface now calls) before `readyToDepart` can become true. Never
 * pre-completed here — that would fabricate the exact prep gap this fixture
 * exists to exercise.
 */
function fixtureVisitContext(
  missionId: number,
  status: FixtureVisitStatus,
  checklistCompleted: boolean
): GoldlineVisitContext {
  const started = status !== "phone_ready";
  return {
    mission: { id: missionId, version: 1, status: status as CommercialMissionStatus },
    field: started
      ? {
          version: 1,
          notes: "",
          preparationStartedAt: "2026-08-13T16:00:00.000Z",
          departedAt:
            status === "en_route" || status === "arrived"
              ? "2026-08-13T16:05:00.000Z"
              : null,
          arrivedAt: status === "arrived" ? "2026-08-13T16:15:00.000Z" : null,
        }
      : null,
    checklist: started
      ? [
          {
            itemKey: "fixture-confirm-address",
            label: "Confirm address",
            required: true,
            status: checklistCompleted ? "completed" : "pending",
          },
        ]
      : [],
    visitOutcome: null,
    proposal: started
      ? {
          id: "fixture-proposal",
          status: "sent",
          validThrough: "2026-08-20T00:00:00.000Z",
        }
      : null,
    navigationUrl: null,
  };
}

/**
 * Deterministic browser fixture for the canonical NEUTRALIZE journey
 * (Slice 102). Same proof philosophy as GoldlineBusinessLoopHarness.tsx:
 * every field here is either real production shape or a clearly-fixture
 * value, never a fabricated production data path.
 *
 * Production now reads frozen commercial-visit route membership and derives
 * coverage from authoritative visit outcomes. This fixture still simulates
 * those service responses via the test-only control below so the two-clock
 * UI remains deterministic without requiring a database in browser CI.
 */
const ROUTE_STOP_COUNT = 5;
const ANCHOR_ITEM: ArmoryItem = {
  id: "fixture:no-risk-trial",
  title: "NO-RISK TRIAL",
  cue: "Switching feels risky",
  response: "Try one run without replacing the current provider.",
  outcome: "guidance",
  provenance: "foundation",
  sourceReference: "fixture:armory:no-risk-trial",
};

function routeMove(index: number): FieldMoveCandidate {
  return {
    id: `neutralize-stop-${index}`,
    moveType: "nearby_commercial_visit",
    title: `Stop ${index}`,
    target: {
      entityType: "commercial_mission",
      entityId: `stop-${index}`,
      name: `Property ${index}`,
    },
    expectedDurationMinutes: 6,
    travelMinutes: 3,
    expectedValue: {
      value: null,
      provenance: "UNKNOWN",
      sourceReference: null,
      confidence: "unknown",
    },
    confidence: "unknown",
    relevance: "Deterministic browser fixture — canonical NEUTRALIZE journey",
    evidence: [],
    expiresAt: null,
    contactAllowed: false,
    withinServiceRadius: true,
    missionId: null,
    missionVersion: null,
    destinationPath: `/driver/field/neutralize-stop-${index}`,
  };
}

function historicalNode(): DriverGameWorldNode {
  return {
    missionId: 9001,
    entityType: "commercial_mission",
    entityId: "9001",
    accountId: 9001,
    accountName: "Chronicle Fixture Account",
    locationId: 9001,
    missionStatus: "won",
    visualState: "captured",
    worldAnchor: "fortress_gate",
    unlockedPath: null,
    discoveryState: "engaged",
    contestedUntil: null,
    verifiedAnnualValueCents: 180_000,
    realizedRevenueCents: 0,
    lossReason: null,
    version: 1,
    isTodayActive: false,
    isHistorical: true,
    regionKey: "fortress_gate",
    resolvedAt: "2026-08-01T00:00:00.000Z",
  };
}

export default function GoldlineFictionHarness() {
  const [coveredCount, setCoveredCount] = useState(0);
  const [driverSafeSalesIntel, setDriverSafeSalesIntel] =
    useState<DriverSafeSalesIntel | null>({
      acceptedTeachingCount: 3,
      byCategory: [
        { category: "discovery", count: 2 },
        { category: "closing", count: 1 },
      ],
    });
  // Test-only: simulates a real authoritative change (a stop resolved or
  // expired) so Slice 96's dynamic reprojection can be proven against a
  // live UI re-render, not just the pure-function unit tests.
  const [liveStopCount, setLiveStopCount] = useState(ROUTE_STOP_COUNT);
  // Test-only: lets a browser test exercise a genuine no-address route stop
  // (CASE B — truthful unavailable treatment) without altering the other
  // four stops' real-address behavior the rest of the suite depends on.
  const [firstStopAddressStripped, setFirstStopAddressStripped] =
    useState(false);
  const moves = useMemo<FieldMovesResult>(
    () => ({
      generatedAt: new Date().toISOString(),
      recommendedMoves: Array.from({ length: liveStopCount }, (_, i) =>
        routeMove(i)
      ),
      reason: "MOVES_AVAILABLE",
      constraints: {
        availableMinutes: 90,
        capacityFull: false,
        currentLocationAvailable: true,
      },
      dataQuality: { status: "trusted", warnings: [], sources: ["fixture"] },
    }),
    [liveStopCount]
  );
  const authoritativeVisitRoute = useMemo<AuthoritativeVisitRouteProjection>(
    () => ({
      occurrenceId: "fixture-neutralize-route",
      businessDate: "2026-08-13",
      startedAt: "2026-08-13T16:00:00.000Z",
      totalStops: liveStopCount,
      coveredCount,
      stops: Array.from({ length: liveStopCount }, (_, index) => {
        const noAddress = index === 0 && firstStopAddressStripped;
        const address = noAddress
          ? null
          : `${100 + index} Fixture St, Testville`;
        return {
          missionId: 9100 + index,
          moveId: `neutralize-stop-${index}`,
          accountName: `Property ${index}`,
          destinationPath: `/driver/sales-mission/${9100 + index}`,
          position: index,
          requiresDriving: false,
          evidenced: index < coveredCount,
          visitOutcomeId: index < coveredCount ? 9200 + index : null,
          address,
          navigationUrl: address
            ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
            : null,
        };
      }),
    }),
    [coveredCount, liveStopCount, firstStopAddressStripped]
  );

  const visitStatusRef = useRef<Map<number, FixtureVisitStatus>>(new Map());
  // Mirrors production's genuinely-incomplete-until-completed field prep —
  // starts false the moment a mission enters "preparing" (see
  // startVisitPreparation below), and only becomes true once the in-game
  // checklist button actually calls updateChecklistItem.
  const checklistCompletedRef = useRef<Map<number, boolean>>(new Map());

  function contextFor(missionId: number): GoldlineVisitContext {
    const status = visitStatusRef.current.get(missionId) ?? "phone_ready";
    const checklistCompleted =
      checklistCompletedRef.current.get(missionId) ?? false;
    return fixtureVisitContext(missionId, status, checklistCompleted);
  }

  const services = useMemo<GoldlineActionServices>(
    () => ({
      recordCall: async () => undefined,
      loadVisit: async missionId => contextFor(missionId),
      startVisitPreparation: async ({ missionId }) => {
        visitStatusRef.current.set(missionId, "preparing");
        checklistCompletedRef.current.set(missionId, false);
        return contextFor(missionId);
      },
      updateChecklistItem: async ({ missionId, status }) => {
        checklistCompletedRef.current.set(missionId, status === "completed");
        return contextFor(missionId);
      },
      departVisit: async ({ missionId }) => {
        visitStatusRef.current.set(missionId, "en_route");
        return contextFor(missionId);
      },
      arriveVisit: async ({ missionId }) => {
        visitStatusRef.current.set(missionId, "arrived");
        return contextFor(missionId);
      },
      recordVisitOutcome: async ({ missionId }) => {
        // Real coverage is server-derived — this fixture simulates the exact
        // canonical write path a route-stop visit reuses (identical services
        // interface `GoldlineActionSurface` already uses for the spotlighted
        // single-mission VISIT flow). Bumping `coveredCount` here stands in
        // for the authoritative `commercial_visit_outcomes` write; production
        // route coverage is genuinely re-derived from that table.
        setCoveredCount(count => Math.min(ROUTE_STOP_COUNT, count + 1));
        visitStatusRef.current.set(missionId, "arrived");
        return contextFor(missionId);
      },
      loadFollowUp: async () => null,
      completeFollowUp: async () => undefined,
      rescheduleFollowUp: async () => undefined,
      recover: async () => {
        throw new Error("Not exercised by the NEUTRALIZE fixture");
      },
      scout: async () => {
        throw new Error("Not exercised by the NEUTRALIZE fixture");
      },
      refetchAuthoritativeTruth: async () => undefined,
    }),
    []
  );

  const missions: CommercialMission[] = [];
  const worldNodes: DriverGameWorldNode[] = [historicalNode()];

  const gameProps: ComponentProps<typeof GoldlineGameHome> = {
    playerIdentity: "goldline-fiction-e2e",
    salesMissions: missions,
    moves,
    worldNodes,
    location: {
      status: "unavailable",
      coordinates: null,
      accuracyMeters: null,
      reason: "Deterministic browser fixture",
    },
    dayResolution: null,
    selectedDate: "2026-08-13",
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
    onBeginRekindle: async () => historicalNode(),
    coldCallEligibleCount: 0,
    coldCallEmptyReason: "No fixture targets",
    onCreateColdCall: async () => null,
    onStartColdCall: async () => {
      throw new Error("Cold Call is outside this fixture");
    },
    onCompleteColdCall: async () => {
      throw new Error("Cold Call is outside this fixture");
    },
    onSelectColdCallChain: async () => {
      throw new Error("Cold Call is outside this fixture");
    },
    onBreakColdCallCombo: async () => {
      throw new Error("Cold Call is outside this fixture");
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
    onRequestWeapons: async () => ({
      weapons: [],
      trainerIntelligenceAvailable: false,
    }),
    onRecordWeaponUsage: async () => undefined,
    actionServices: services,
    driverSafeSalesIntel,
    authoritativeRouteCoverage: coveredCount,
    authoritativeVisitRoute,
  };

  return (
    <>
      {/*
        Test-only evidence simulation control — see the file doc comment.
        Never rendered in a production build (this component only mounts
        behind VITE_GOLDLINE_TEST_HARNESS, compile-time dead code otherwise).
      */}
      <button
        type="button"
        data-testid="fixture-mark-stop-covered"
        onClick={() =>
          setCoveredCount(count => Math.min(ROUTE_STOP_COUNT, count + 1))
        }
      >
        MARK STOP COVERED ({coveredCount}/{ROUTE_STOP_COUNT})
      </button>
      <button
        type="button"
        data-testid="fixture-remove-stronghold-intel"
        onClick={() => setDriverSafeSalesIntel(null)}
      >
        REMOVE AUTHORITATIVE INTEL
      </button>
      <button
        type="button"
        data-testid="fixture-resolve-live-stop"
        onClick={() => setLiveStopCount(count => Math.max(0, count - 1))}
      >
        RESOLVE ONE REAL STOP (real change → dynamic reroute)
      </button>
      <button
        type="button"
        data-testid="fixture-strip-first-stop-address"
        onClick={() => setFirstStopAddressStripped(true)}
      >
        STRIP FIRST STOP ADDRESS (no real location on file)
      </button>
      <div data-testid="fixture-covered-count" style={{ display: "none" }}>
        {coveredCount}
      </div>
      <div data-testid="fixture-live-stop-count" style={{ display: "none" }}>
        {liveStopCount}
      </div>
      <GoldlineGameHome {...gameProps} />
    </>
  );
}
