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
import type { Order } from "@shared/types";
import {
  toSignalKey,
  type ImpactSignalProposal,
  type ProposedImpactSignal,
} from "../../../../shared/impactSignal";
import { LogSignalSheet } from "@/components/driver/LogSignalSheet";
import type { CollectedEvidenceOrder } from "../expedition/strongholdRestoration";
import type { OpenChannelMission } from "../../../../server/openChannel/openChannelTypes";
import type { ExternalOperationalOrder } from "../../../../shared/externalOperationalOrder";

/**
 * How long the fixture waits before authoritative evidence reports the
 * collection, standing in for the real gap between the canonical mutation
 * resolving and the next admin.listByStatus poll returning it.
 */
const SERVER_TRUTH_DELAY_MS = 900;

/**
 * The fixture's stand-in for THE SERVER'S OWN STORAGE — not app state.
 *
 * A reload must reproduce the Stronghold from real order truth. That claim
 * is only testable if the thing standing in for the database behaves like
 * one: production re-queries admin.listByStatus and the collected order is
 * still there, so this fixture has to still have it too. Without this, a
 * reload would wipe the fixture's "server" and the test would prove nothing
 * except that a page reload clears React state.
 *
 * The application itself stores NOTHING about restoration. That is the
 * whole point, and it is exactly what the reload check verifies: the app
 * re-derives the payoff from whatever this stand-in reports.
 */
const FIXTURE_SERVER_EVIDENCE_KEY = "goldline-fixture:server-collected-orders";

/**
 * Field intel the fixture "server" has accepted. Same stand-in trick as the
 * collected-order evidence above: the app holds nothing, so a reload proves the
 * capture actually left the sheet.
 */
const FIXTURE_SIGNALS_KEY = "goldline-fixture:confirmed-signals";

function readFixtureSignals(): ProposedImpactSignal[] {
  try {
    const raw = window.sessionStorage.getItem(FIXTURE_SIGNALS_KEY);
    return raw ? (JSON.parse(raw) as ProposedImpactSignal[]) : [];
  } catch {
    return [];
  }
}

/**
 * Stands in for the extraction call. Deliberately dumb — it structures the
 * sentence without judging it, and never chooses a class stronger than
 * `field_activity`. The real prompt's refusal to inflate is covered by the
 * shared model's own tests; what this fixture exercises is the SURFACE: that a
 * sentence can be captured, seen, corrected, and confirmed on a phone.
 */
function proposeFixtureSignals(speech: string): ImpactSignalProposal {
  const said = speech.trim();
  const count = said.match(/\b(\d+)\b/)?.[1] ?? null;
  if (!said) {
    return { proposalId: "fixture-empty", signals: [], unrecognized: speech };
  }
  const label = count ? "Door hangers left" : "Field note";
  return {
    proposalId: "fixture-proposal",
    signals: [
      {
        signalKey: toSignalKey(label),
        label,
        valueType: count ? "number" : "text",
        value: count ?? said,
        unit: count ? "hangers" : null,
        // Effort, never outcome. A fixture that flattered the operator would
        // hide exactly the bug this whole feature is guarding against.
        impactClass: count ? "field_activity" : "observation",
        entityType: "building",
        entityLabel: null,
        notes: null,
        metadata: null,
        startsTracking: false,
      },
    ],
    unrecognized: null,
  };
}

function readFixtureServerEvidence(
  seed: CollectedEvidenceOrder[]
): CollectedEvidenceOrder[] {
  try {
    const raw = window.sessionStorage.getItem(FIXTURE_SERVER_EVIDENCE_KEY);
    if (raw) return JSON.parse(raw) as CollectedEvidenceOrder[];
  } catch {
    /* fall through to the seed */
  }
  return seed;
}

function writeFixtureServerEvidence(rows: CollectedEvidenceOrder[]) {
  try {
    window.sessionStorage.setItem(
      FIXTURE_SERVER_EVIDENCE_KEY,
      JSON.stringify(rows)
    );
  } catch {
    /* a fixture that cannot persist still runs, it just cannot prove reload */
  }
}

/**
 * A deterministic, real-Order-shaped fixture row — every field is either the
 * genuine production default or a clearly-fixture value, matching the file's
 * existing proof philosophy. Never a fabricated business fact.
 */
function fixtureOrder(overrides: Partial<Order> & { id: number }): Order {
  return {
    tenantId: "default",
    serviceType: "wash_fold",
    pickupDate: "2026-08-13",
    pickupTimeWindow: "9AM-11AM",
    deliveryDate: "2026-08-13",
    deliveryTimeWindow: "4PM-6PM",
    address: "200 Fixture Ave, Testville",
    unit: null,
    specialInstructions: null,
    heldRawRequestText: null,
    heldCleanedRequestText: null,
    heldServiceSummary: null,
    heldRequestedPickupWindow: null,
    heldRequestedReturnBy: null,
    heldSource: null,
    heldMetadataJson: null,
    residentClientRequestId: null,
    firstName: "Fixture",
    lastName: "Customer",
    phone: "555-0100",
    email: null,
    bldgUserId: null,
    stripeCustomerId: null,
    stripePaymentMethodId: null,
    stripePaymentIntentId: null,
    status: "new",
    weightLbs: null,
    bagCount: 1,
    garmentCount: null,
    subtotal: "0",
    discountPercent: "0",
    total: "0",
    upchargesJson: null,
    drycleanItemsJson: null,
    paid: false,
    paidAt: null,
    isFirstPaidOrder: false,
    portalJwt: null,
    buildingSlug: null,
    vendorId: null,
    vendorNameSnapshot: null,
    routingPrioritySnapshot: null,
    platformFeeCents: null,
    vendorPayoutCents: null,
    stripeConnectedAccountIdSnapshot: null,
    manualRiskFlag: false,
    createdAt: new Date("2026-08-13T08:00:00.000Z"),
    updatedAt: new Date("2026-08-13T08:00:00.000Z"),
    ...overrides,
  };
}

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

/**
 * True when the URL requests the deterministic empty-day fixture
 * (`?goldlineFixture=NEUTRALIZE&goldlineEmptyDay=1`) — a real player day
 * with genuinely zero NEUTRALIZE visit stops, pickups, or deliveries.
 * Reused throughout this component to zero every real-work source rather
 * than adding a second harness: missions are already always [] here, so
 * this only needs to zero the route/pickup/delivery arrays this file
 * itself seeds.
 */
function readEmptyDayFlag(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("goldlineEmptyDay") === "1";
}

/**
 * A day with no native orders but a briefing the operator has ALREADY given
 * and approved.
 *
 * Deliberately its own flag rather than riding on `goldlineEmptyDay`. An
 * empty day means genuinely nothing to do, and three specs assert exactly
 * that — Goldline must ask for a truthful briefing rather than leave
 * Trailblazer aimless. Attaching an approved Open Channel mission to that
 * flag makes the day no longer empty and breaks those assertions, correctly.
 * This is the state AFTER the briefing: zero orders, real approved work.
 */
/**
 * A day whose work is owned by CleanCloud, not Laundry Butler.
 *
 * Its own flag because it is a genuinely different operational situation from
 * both an empty day and a native-order day: real customers waiting, real
 * addresses to drive to, and an external system this app cannot update.
 */
function readExternalDayFlag(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("goldlineExternalDay") === "1"
  );
}

function readOpenChannelDayFlag(): boolean {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("goldlineOpenChannelDay") ===
    "1"
  );
}

export default function GoldlineFictionHarness() {
  const emptyDay = useRef(readEmptyDayFlag()).current;
  const openChannelDay = useRef(readOpenChannelDayFlag()).current;
  const externalDay = useRef(readExternalDayFlag()).current;
  /** Both fixtures represent a day with no Laundry Butler-native route work. */
  const noNativeOrders = emptyDay || openChannelDay || externalDay;

  /**
   * Real CleanCloud work, as the driver surface receives it. Starts confirmed
   * and scheduled — the review gate is exercised by the intake tests, not by
   * every expedition run.
   */
  const [externalOrders, setExternalOrders] = useState<ExternalOperationalOrder[]>(
    () =>
      externalDay
        ? [
            {
              id: "3f0b8c11-77aa-4c1e-9a52-6d2e4b8f0c31",
              sourceSystem: "cleancloud",
              ingestionMethod: "screenshot",
              externalOrderId: "CC-4471",
              jobKind: "pickup",
              customerName: "Miso",
              address: "Opus LA, 1601 Vine St",
              scheduledDate: "2026-08-13",
              windowStart: "09:00",
              windowEnd: "11:00",
              notes: "Comforter",
              operationalStatus: "scheduled",
              completedAt: null,
              reconciliationStatus: "update_required",
              reconciledAt: null,
              reviewState: "confirmed",
              importBatchId: null,
              createdAt: "2026-08-13T08:00:00.000Z",
            },
          ]
        : []
  );

  /**
   * The physical work happened. Mirrors the real service: it sets operational
   * truth and pointedly leaves reconciliation at `update_required`, because
   * nothing in this build can tell CleanCloud anything.
   */
  function completeFixtureExternalOrder(id: string): boolean {
    const target = externalOrders.find(row => row.id === id);
    if (!target || target.operationalStatus === "completed") return false;
    window.setTimeout(() => {
      setExternalOrders(current =>
        current.map(row =>
          row.id === id
            ? {
                ...row,
                operationalStatus: "completed" as const,
                completedAt: "2026-08-13T10:00:00.000Z",
              }
            : row
        )
      );
    }, SERVER_TRUTH_DELAY_MS);
    return true;
  }

  /** The operator states they updated CleanCloud. Never a verification. */
  function reconcileFixtureExternalOrder(id: string): boolean {
    const target = externalOrders.find(row => row.id === id);
    if (!target || target.operationalStatus !== "completed") return false;
    setExternalOrders(current =>
      current.map(row =>
        row.id === id
          ? {
              ...row,
              reconciliationStatus: "reconciled" as const,
              reconciledAt: "2026-08-13T10:05:00.000Z",
            }
          : row
      )
    );
    return true;
  }
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
  const [logSignalOpen, setLogSignalOpen] = useState(false);
  const [confirmedSignals, setConfirmedSignals] = useState<
    ProposedImpactSignal[]
  >(() => readFixtureSignals());
  const [liveStopCount, setLiveStopCount] = useState(
    noNativeOrders ? 0 : ROUTE_STOP_COUNT
  );
  // Test-only: lets a browser test exercise a genuine no-address route stop
  // (CASE B — truthful unavailable treatment) without altering the other
  // four stops' real-address behavior the rest of the suite depends on.
  const [firstStopAddressStripped, setFirstStopAddressStripped] =
    useState(false);
  // Genuine pickup/delivery route-work fixture — mirrors production's
  // `admin.listByDate` result shape exactly (real Order rows). One pickup
  // has no address on file (CASE C — fails closed truthfully); one delivery
  // is genuinely unpaid (payment-blocked, cannot be bypassed by fiction).
  const [pickupOrders, setPickupOrders] = useState<Order[]>(
    noNativeOrders
      ? []
      : [
          fixtureOrder({ id: 9300, firstName: "Pickup", lastName: "Alpha" }),
          fixtureOrder({
            id: 9301,
            firstName: "Pickup",
            lastName: "NoAddress",
            address: "",
          }),
        ]
  );
  /**
   * AUTHORITATIVE collected-order evidence, as the real driver surface
   * receives it from admin.listByStatus. Starts with genuine history so the
   * Stronghold is partially restored before this expedition — a payoff
   * measured against an empty world would prove far less.
   */
  const [collectedEvidence, setCollectedEvidence] = useState<
    CollectedEvidenceOrder[]
  >(() =>
    noNativeOrders
      ? []
      : readFixtureServerEvidence([
          { id: 9100, status: "delivered" },
          { id: 9101, status: "ready" },
        ])
  );

  /**
   * A real ZERO-ORDER DAY, as an operator actually has one.
   *
   * PR #71 made the expedition shell objective-agnostic so an approved Open
   * Channel task can prepare the heartbeat when no Laundry Butler-native
   * pickup exists. Nothing exercised that path: this harness supplied no
   * openChannelMission at all, so `prepareExpeditionObjective` could only
   * ever take its native-pickup branch here. The headline behaviour of #71
   * was covered by a markdown acceptance file and four pure-function unit
   * tests, none of which mount the HUD or press anything.
   *
   * These tasks are the operator's own real words — design the door hanger,
   * send it to the printer, walk existing collateral to nearby shops. They
   * are real operational work with no revenue attached, which is exactly the
   * case that must play without inventing a customer.
   */
  const [openChannelMission, setOpenChannelMission] =
    useState<OpenChannelMission | null>(() =>
      openChannelDay
        ? {
            id: "fixture-open-channel-1",
            businessDate: "2026-08-13",
            status: "active",
            title: "OPEN NEW GROUND",
            operatorBriefing:
              "No orders today. Finish the door hanger, send it to the printer, then walk the collateral I already have to the barbers on the block.",
            transcript:
              "No orders today. Finish the door hanger, send it to the printer, then walk the collateral I already have to the barbers on the block.",
            generationSource: "deterministic_fallback",
            gapStartedAt: "2026-08-13T09:00:00.000Z",
            nextCommitmentAt: null,
            availableMinutes: 240,
            approvedAt: "2026-08-13T09:05:00.000Z",
            completedAt: null,
            tasks: [
              {
                id: "task-forge-the-message",
                position: 0,
                title: "Finish the door hanger design",
                detail: "Export print-ready artwork for the block campaign.",
                estimatedMinutes: 60,
                category: "sales",
                navigationQuery: null,
                status: "pending",
                completedAt: null,
              },
              {
                id: "task-send-to-press",
                position: 1,
                title: "Send the hanger to the printer",
                detail: "Hand the finished file to the print shop on 3rd.",
                estimatedMinutes: 30,
                category: "operations",
                navigationQuery: "print shop 3rd street",
                status: "pending",
                completedAt: null,
              },
            ],
          }
        : null
    );

  /**
   * The fixture's stand-in for the canonical `openChannel.completeTask`
   * write. It marks the pinned task completed the way the server would —
   * on its own delay, so VERIFYING remains observable and a returned
   * mutation is never mistaken for confirmed truth.
   */
  function completeFixtureOpenChannelTask(
    missionId: string,
    taskId: string
  ): boolean {
    if (!openChannelMission || openChannelMission.id !== missionId) return false;
    const task = openChannelMission.tasks.find(row => row.id === taskId);
    if (!task || task.status === "completed") return false;
    window.setTimeout(() => {
      setOpenChannelMission(current =>
        current
          ? {
              ...current,
              tasks: current.tasks.map(row =>
                row.id === taskId
                  ? {
                      ...row,
                      status: "completed" as const,
                      completedAt: "2026-08-13T10:00:00.000Z",
                    }
                  : row
              ),
            }
          : current
      );
    }, SERVER_TRUTH_DELAY_MS);
    return true;
  }

  const [deliveryOrders, setDeliveryOrders] = useState<Order[]>(noNativeOrders ? [] : [
    fixtureOrder({
      id: 9310,
      firstName: "Delivery",
      lastName: "Paid",
      status: "ready",
      paid: true,
      paidAt: new Date("2026-08-13T09:00:00.000Z"),
    }),
    fixtureOrder({
      id: 9311,
      firstName: "Delivery",
      lastName: "Blocked",
      status: "ready",
      paid: false,
    }),
  ]);
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

  // Records a genuine pickup/delivery completion by removing the resolved
  // order from the fixture's own pickups/deliveries arrays — standing in for
  // production's canonical `admin.updateStatus` write plus its broad
  // authoritative refetch (`invalidateDriverTruth`), which is what actually
  // removes a resolved order from `admin.listByDate`'s cache in production.
  function resolveFixtureOrder(
    orderId: number,
    status: "collected" | "delivered"
  ): boolean {
    if (status === "delivered") {
      const order = deliveryOrders.find(row => row.id === orderId);
      if (!order || !order.paid) return false;
      setDeliveryOrders(current => current.filter(row => row.id !== orderId));
    } else {
      const order = pickupOrders.find(row => row.id === orderId);
      if (!order) return false;
      setPickupOrders(current => current.filter(row => row.id !== orderId));
      // Stand in for the SERVER's own view catching up, on its own delay.
      //
      // In production the collected order appears in admin.listByStatus on
      // the next poll, which is strictly later than the mutation resolving.
      // Reproducing that gap is the entire point: a fixture that flipped the
      // evidence synchronously would make VERIFYING SERVER TRUTH
      // unobservable and would hide the exact bug this design prevents —
      // treating a returned mutation as a secured pickup.
      window.setTimeout(() => {
        setCollectedEvidence(current => {
          if (current.some(row => row.id === orderId)) return current;
          const next = [
            ...current,
            { id: orderId, status: "collected" } as CollectedEvidenceOrder,
          ];
          // The stand-in "server" keeps it, so a reload can prove the app
          // rebuilds the Stronghold from order truth rather than memory.
          writeFixtureServerEvidence(next);
          return next;
        });
      }, SERVER_TRUTH_DELAY_MS);
    }
    return true;
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
      resolveOrder: async ({ orderId, status }) =>
        resolveFixtureOrder(orderId, status),
    }),
    // Recreated whenever the fixture's real pickup/delivery arrays change so
    // resolveOrder never closes over a stale removed/duplicate order list.
    [pickupOrders, deliveryOrders]
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
    pickups: pickupOrders,
    deliveries: deliveryOrders,
    collectedOrderEvidence: collectedEvidence,
    externalOrders,
    onCompleteExternalOrder: async id => completeFixtureExternalOrder(id),
    onReconcileExternalOrder: async id => reconcileFixtureExternalOrder(id),
    isResolvingOrder: false,
    onResolveOrder: async (orderId, status) =>
      resolveFixtureOrder(orderId, status),
    onAcceptMove: async () => undefined,
    onOpenWalkIn: () => undefined,
    onOpenNewOrder: () => undefined,
    onOpenLogSignal: () => setLogSignalOpen(true),
    onOpenJournal: () => undefined,
    onResolveDay: async () => undefined,
    openChannelMission,
    onGenerateOpenChannel: async () => undefined,
    onApproveOpenChannel: async () => undefined,
    onCompleteOpenChannelTask: async (missionId, taskId) =>
      completeFixtureOpenChannelTask(missionId, taskId),
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
      {/*
        The confirmed count is what a reload has to survive: the sheet holds
        nothing, so if this number persists, the capture genuinely left it.
      */}
      <div data-testid="fixture-signal-count" style={{ display: "none" }}>
        {confirmedSignals.length}
      </div>
      <div data-testid="fixture-signal-classes" style={{ display: "none" }}>
        {confirmedSignals.map(s => s.impactClass).join(",")}
      </div>
      <GoldlineGameHome {...gameProps} />
      <LogSignalSheet
        open={logSignalOpen}
        onClose={() => setLogSignalOpen(false)}
        onPropose={async ({ speech }) => proposeFixtureSignals(speech)}
        onConfirm={async signals => {
          const next = [...confirmedSignals, ...signals];
          setConfirmedSignals(next);
          try {
            window.sessionStorage.setItem(
              FIXTURE_SIGNALS_KEY,
              JSON.stringify(next)
            );
          } catch {
            /* a fixture that cannot persist still runs */
          }
        }}
      />
    </>
  );
}
