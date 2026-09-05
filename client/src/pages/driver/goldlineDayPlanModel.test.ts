import { describe, expect, it } from "vitest";
import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import {
  buildDayPlanProjection,
  liveObjectivesFromFieldToday,
} from "./goldlineDayPlanModel";

const native = (id: number, status: Order["status"] = "new") =>
  ({
    id,
    status,
    firstName: "Brightline",
    lastName: "Builders",
    address: "123 Gold Line",
    pickupTimeWindow: "9:00–10:00",
    deliveryTimeWindow: "10:30–11:30",
    updatedAt: new Date("2026-08-25T17:14:00.000Z"),
  }) as Order;

const external = (
  reviewState: ExternalOperationalOrder["reviewState"],
  jobKind: ExternalOperationalOrder["jobKind"] = "dropoff",
  id = `clean-${reviewState}`
) =>
  ({
    id,
    sourceSystem: "cleancloud",
    ingestionMethod: "screenshot",
    externalOrderId: null,
    jobKind,
    customerName: "Evergreen CPAs",
    address: "456 World Road",
    scheduledDate: "2026-08-25",
    windowStart: "10:30",
    windowEnd: "11:30",
    notes: null,
    operationalStatus: "scheduled",
    completedAt: null,
    reconciliationStatus: "update_required",
    reconciledAt: null,
    reviewState,
    importBatchId: "batch-1",
    createdAt: "2026-08-25T15:00:00.000Z",
  }) satisfies ExternalOperationalOrder;

const greystar = (status: CommercialMission["status"]) =>
  ({
    id: 6,
    code: "GREYSTAR-6",
    status,
    account: { name: "Greystar 6", address: "6 Castle Way" },
    steps: [],
    completedAt: null,
    expiresAt: null,
  }) as CommercialMission;

describe("authoritative Goldline Day Plan projection", () => {
  it("merges native, confirmed external, and approved briefing tasks while preserving provenance", () => {
    const plan = buildDayPlanProjection({
      businessDate: "2026-08-25",
      pickups: [native(1)],
      externalOrders: [external("confirmed"), external("pending_review")],
      openChannelMission: {
        id: "briefing-1",
        businessDate: "2026-08-25",
        status: "active",
        title: "Day plan",
        operatorBriefing: "",
        transcript: "",
        generationSource: "deterministic_fallback",
        gapStartedAt: "2026-08-25T15:00:00.000Z",
        nextCommitmentAt: null,
        availableMinutes: null,
        approvedAt: "2026-08-25T15:00:00.000Z",
        completedAt: null,
        tasks: [
          {
            id: "prep-1",
            position: 0,
            title: "Print collateral",
            detail: "",
            estimatedMinutes: 15,
            category: "operations",
            navigationQuery: null,
            status: "pending",
            completedAt: null,
          },
        ],
      },
      now: new Date(2026, 7, 25, 8),
    });
    expect(plan.stops).toHaveLength(3);
    expect(plan.stops.map(stop => stop.source)).toEqual(
      expect.arrayContaining(["laundry_butler", "cleancloud", "open_channel"])
    );
    expect(plan.cleanCloudCount).toBe(1);
    expect(plan.stops.map(stop => stop.action)).toEqual(expect.arrayContaining([
      { type: "order", orderId: 1, status: "collected", eligible: true },
      { type: "external", id: "clean-confirmed" },
      { type: "task", missionId: "briefing-1", taskId: "prep-1" },
    ]));
  });

  it("maps factual completion without converting provenance", () => {
    const plan = buildDayPlanProjection({
      businessDate: "2026-08-25",
      pickups: [native(1, "collected")],
      now: new Date(2026, 7, 25, 11),
    });
    expect(plan.stops[0]).toMatchObject({
      status: "completed",
      source: "laundry_butler",
    });
    expect(plan.stops[0].completedAt).toBeTruthy();
  });

  it("only wakes an eligible playable mission when the real schedule has room", () => {
    const now = new Date(2026, 7, 25, 11);
    const ready = buildDayPlanProjection({
      businessDate: "2026-08-25",
      salesMissions: [greystar("game_ready")],
      nextCommitmentAt: new Date(now.getTime() + 120 * 60_000).toISOString(),
      now,
    });
    const blocked = buildDayPlanProjection({
      businessDate: "2026-08-25",
      salesMissions: [greystar("game_ready")],
      nextCommitmentAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
      now,
    });
    expect(ready.stops.find(stop => stop.id.endsWith("-email"))).toMatchObject({
      status: "ready",
      missionTarget: "colosseum",
    });
    expect(
      blocked.stops.find(stop => stop.id.endsWith("-visits"))
    ).toMatchObject({
      status: "upcoming",
      missionTarget: "colosseum",
    });
  });

  const processingLocation = {
    name: "Lugo's Lavanderia",
    locality: "Huntington Park",
    address: null,
  };

  it("derives one processing handoff immediately after one pickup", () => {
    const plan = buildDayPlanProjection({
      businessDate: "2026-08-25",
      pickups: [native(1)],
      processingLocation,
    });
    expect(plan.stops.map(stop => stop.kind)).toEqual(["pickup", "processing"]);
    expect(plan.stops[1]).toMatchObject({
      title: "Lugo's Lavanderia",
      source: "derived_operation",
    });
  });

  it("derives exactly one handoff after the final pickup across native and confirmed CleanCloud work", () => {
    const first = native(1);
    first.pickupTimeWindow = "9:00–10:00";
    const second = native(2);
    second.pickupTimeWindow = "12:00–2:00";
    const plan = buildDayPlanProjection({
      businessDate: "2026-08-25",
      pickups: [first, second],
      externalOrders: [external("confirmed", "pickup", "cc-pickup")],
      processingLocation,
    });
    expect(plan.stops.filter(stop => stop.kind === "processing")).toHaveLength(
      1
    );
    const processingIndex = plan.stops.findIndex(
      stop => stop.kind === "processing"
    );
    expect(processingIndex).toBeGreaterThan(
      plan.stops.findIndex(stop => stop.id === "native-pickup-2")
    );
  });

  it("does not derive processing for dropoff-only or pending external work", () => {
    const dropoffs = buildDayPlanProjection({
      businessDate: "2026-08-25",
      deliveries: [native(1)],
      externalOrders: [external("pending_review", "pickup")],
      processingLocation,
    });
    expect(dropoffs.stops.some(stop => stop.kind === "processing")).toBe(false);
  });

  it("projects confirmed user truth once and keeps Greystar email actionable while field visits are blocked", () => {
    const plan = buildDayPlanProjection({
      businessDate: "2026-08-25",
      salesMissions: [greystar("game_ready")],
      physicalVisitBlocked: true,
      commitments: [
        {
          id: "postcards",
          businessDate: "2026-08-25",
          title: "Mail 4 customer postcards",
          kind: "growth",
          quantity: 4,
          provenance: "user_reported",
          status: "open",
          completedAt: null,
        },
      ],
    });
    expect(
      plan.stops.filter(stop => stop.id === "commitment-postcards")
    ).toHaveLength(1);
    expect(plan.stops.find(stop => stop.id.endsWith("-email"))?.status).toBe(
      "ready"
    );
    expect(plan.stops.find(stop => stop.id.endsWith("-visits"))?.status).toBe(
      "blocked"
    );
    expect(plan.growthCoverage).toBe("covered");
  });
});

const fieldItem = (
  overrides: Partial<Parameters<typeof liveObjectivesFromFieldToday>[0][number]> = {}
) => ({
  id: "recovery:abc",
  kind: "customer_recovery",
  title: "Recovery · Marisol Vega",
  subtitle: "Dormant beyond observed cadence",
  status: "approved",
  urgency: "urgent",
  scheduledAt: null,
  destination: null,
  physicalEntityId: null,
  whySurfaced: null,
  whySourceOccurredAt: null,
  source: { sourceReference: "customer_recovery_interventions:abc" },
  ...overrides,
});

describe("the authoritative day becomes playable objectives", () => {
  it("reshapes real work without inventing any of its own", () => {
    // An empty day is allowed to be empty. Padding it would be fabrication.
    expect(liveObjectivesFromFieldToday([])).toEqual([]);
    const objectives = liveObjectivesFromFieldToday([
      fieldItem(),
      fieldItem({ id: "pickup:1", kind: "pickup", title: "Pickup" }),
    ]);
    expect(objectives).toHaveLength(1);
    expect(objectives[0]!.id).toBe("recovery:abc");
  });

  it("carries the real building and real coordinates, or null", () => {
    const [placed, unplaced] = liveObjectivesFromFieldToday([
      fieldItem({
        id: "forge:1",
        kind: "contextual_move",
        physicalEntityId: "building-9",
        destination: { address: "1100 Wilshire", latitude: 34.05, longitude: -118.25 },
      }),
      fieldItem({ id: "recovery:2" }),
    ]);
    expect(placed!.physicalEntityId).toBe("building-9");
    expect(placed!.latitude).toBe(34.05);
    // Unknown geography stays unknown rather than being estimated.
    expect(unplaced!.physicalEntityId).toBeNull();
    expect(unplaced!.latitude).toBeNull();
    expect(unplaced!.address).toBeNull();
  });

  it("names the source of each objective from the work that produced it", () => {
    const objectives = liveObjectivesFromFieldToday([
      fieldItem(),
      fieldItem({ id: "forge:1", kind: "contextual_move" }),
      fieldItem({ id: "follow:1", kind: "follow_up" }),
    ]);
    expect(objectives.map(item => item.sourceLabel)).toEqual([
      "Dormant relationship",
      "Field discovery",
      "Commercial commitment",
    ]);
    expect(objectives.map(item => item.kind)).toEqual(["growth", "growth", "sales"]);
  });

  it("treats a resolved outcome as done and a blocker as blocked", () => {
    const objectives = liveObjectivesFromFieldToday([
      fieldItem({ id: "a", status: "recovered" }),
      fieldItem({ id: "b", status: "published" }),
      fieldItem({ id: "c", urgency: "blocked" }),
      fieldItem({ id: "d" }),
    ]);
    expect(objectives.map(item => item.status)).toEqual([
      "completed",
      "completed",
      "blocked",
      "ready",
    ]);
  });

  it("preserves why/provenance for carried-forward pressure", () => {
    const objective = liveObjectivesFromFieldToday([
      fieldItem({
        id: "pressure:1",
        kind: "reported_opportunity",
        subtitle: "Fallback subtitle",
        whySurfaced: "Front desk said she should be back Wednesday — not an appointment.",
        whySourceOccurredAt: "2026-09-01T22:14:00.000Z",
        source: { sourceReference: "driver_sales_journals:journal-9" },
      }),
    ])[0]!;
    expect(objective.explanation).toMatch(/not an appointment/);
    expect(objective.sourceOccurredAt).toBe("2026-09-01T22:14:00.000Z");
    const stop = buildDayPlanProjection({
      businessDate: "2026-09-02",
      liveObjectives: [objective],
    }).stops[0]!;
    expect(stop.whySurfaced).toBe(objective.explanation);
    expect(stop.sourceEvidenceReference).toBe("driver_sales_journals:journal-9");
  });

  it("carries real objectives into the day the driver actually plays", () => {
    const plan = buildDayPlanProjection({
      businessDate: "2026-08-25",
      pickups: [native(1)],
      liveObjectives: liveObjectivesFromFieldToday([
        fieldItem({ physicalEntityId: "building-9" }),
      ]),
    });
    const stop = plan.stops.find(item => item.source === "living_world");
    expect(stop).toBeTruthy();
    expect(stop!.physicalEntityId).toBe("building-9");
    // The fixed pickup window still outranks flexible growth work.
    expect(plan.stops[0]!.kind).toBe("pickup");
    expect(plan.growthCoverage).toBe("covered");
  });

  it("drops an objective from the remaining day once the real work resolves", () => {
    const remaining = buildDayPlanProjection({
      businessDate: "2026-08-25",
      liveObjectives: liveObjectivesFromFieldToday([
        fieldItem({ status: "recovered" }),
      ]),
    }).stops.find(item => item.source === "living_world");
    // Completed history is kept, not erased — it simply stops being pending.
    expect(remaining?.status).toBe("completed");
  });

  it("lets the campaign order the briefing instead of compiling a second adventure", () => {
    const plan = buildDayPlanProjection({
      businessDate: "2026-08-25",
      pickups: [native(1), native(2)],
      campaignChapters: [
        { objectiveIds: ["pickup:2"] },
        { objectiveIds: ["pickup:1"] },
      ],
    });
    expect(plan.stops.map(stop => stop.id)).toEqual([
      "native-pickup-2",
      "native-pickup-1",
    ]);
  });
});
