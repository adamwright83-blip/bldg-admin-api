import { useMemo, useState, type ComponentProps } from "react";
import type { CommercialMission } from "../../../../shared/commercialMission";
import type { DriverGameWorldNode } from "../../../../shared/driverGameWorld";
import type { ArmoryItem } from "../../../../server/armory/armoryTypes";
import type { FieldMoveCandidate, FieldMovesResult } from "../../../../server/field/types";
import GoldlineGameHome from "../GoldlineGameHome";
import type { GoldlineActionServices } from "../actions/actionServices";

/**
 * Deterministic browser fixture for the canonical NEUTRALIZE journey
 * (Slice 102). Same proof philosophy as GoldlineBusinessLoopHarness.tsx:
 * every field here is either real production shape or a clearly-fixture
 * value, never a fabricated production data path.
 *
 * REPORTED GAP, honestly: this business domain has no real batch/route
 * completion write-path (see shared/actionGrammar.ts's discrepancy note),
 * so `authoritativeCount` in the LIVE app is always genuinely 0 — there is
 * no real endpoint to source a positive number from. This fixture
 * *simulates* what real evidence would look like (via the "MARK STOP
 * COVERED" test-only control below), exactly the way every other fixture
 * in this file simulates real service responses, so the two-clock
 * separation and world-consequence wiring can be proven end-to-end even
 * though the underlying business endpoint doesn't exist yet.
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
    target: { entityType: "commercial_mission", entityId: `stop-${index}`, name: `Property ${index}` },
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
  // Test-only: simulates a real authoritative change (a stop resolved or
  // expired) so Slice 96's dynamic reprojection can be proven against a
  // live UI re-render, not just the pure-function unit tests.
  const [liveStopCount, setLiveStopCount] = useState(ROUTE_STOP_COUNT);
  const moves = useMemo<FieldMovesResult>(
    () => ({
      generatedAt: new Date().toISOString(),
      recommendedMoves: Array.from({ length: liveStopCount }, (_, i) => routeMove(i)),
      reason: "MOVES_AVAILABLE",
      constraints: { availableMinutes: 90, capacityFull: false, currentLocationAvailable: true },
      dataQuality: { status: "trusted", warnings: [], sources: ["fixture"] },
    }),
    [liveStopCount]
  );

  const services = useMemo<GoldlineActionServices>(
    () => ({
      recordCall: async () => undefined,
      loadVisit: async () => {
        throw new Error("Not exercised by the NEUTRALIZE fixture");
      },
      startVisitPreparation: async () => {
        throw new Error("Not exercised by the NEUTRALIZE fixture");
      },
      departVisit: async () => {
        throw new Error("Not exercised by the NEUTRALIZE fixture");
      },
      arriveVisit: async () => {
        throw new Error("Not exercised by the NEUTRALIZE fixture");
      },
      recordVisitOutcome: async () => {
        throw new Error("Not exercised by the NEUTRALIZE fixture");
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
    onRequestWeapons: async () => ({ weapons: [], trainerIntelligenceAvailable: false }),
    onRecordWeaponUsage: async () => undefined,
    actionServices: services,
    authoritativeRouteCoverage: coveredCount,
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
        onClick={() => setCoveredCount(count => Math.min(ROUTE_STOP_COUNT, count + 1))}
      >
        MARK STOP COVERED ({coveredCount}/{ROUTE_STOP_COUNT})
      </button>
      <button
        type="button"
        data-testid="fixture-resolve-live-stop"
        onClick={() => setLiveStopCount(count => Math.max(0, count - 1))}
      >
        RESOLVE ONE REAL STOP (real change → dynamic reroute)
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
