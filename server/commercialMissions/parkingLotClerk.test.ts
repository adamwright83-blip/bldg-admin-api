import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  commercialMissionEvents,
  commercialMissionFieldChecklistItems,
  commercialMissionFieldStates,
  commercialProposals,
  commercialVisitOutcomes,
} from "../../drizzle/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getCommercialMission: vi.fn(),
  readCommercialMissionWith: vi.fn(),
  transitionCommercialMissionWith: vi.fn(),
  awardDriverSalesPoints: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("./commercialMissionStore", () => ({
  getCommercialMission: mocks.getCommercialMission,
  readCommercialMissionWith: mocks.readCommercialMissionWith,
  transitionCommercialMissionWith: mocks.transitionCommercialMissionWith,
}));
vi.mock("./driverSalesMotivationService", () => ({
  awardDriverSalesPoints: mocks.awardDriverSalesPoints,
}));

import {
  getParkingLotClerkObservation,
  recordParkingLotClerkObservation,
} from "./commercialMissionFieldService";

type Row = Record<string, unknown>;

const mission = {
  id: 41,
  tenantId: "tenant-a",
  code: "MISSION 041",
  status: "visit_completed",
  version: 7,
  assignedTo: "driver-1",
  opsTaskId: 12,
  account: {
    accountId: 9,
    name: "Greystar Fixture",
    accountType: "property",
    address: "100 Fixture Way",
    latitude: null,
    longitude: null,
    locationCount: 1,
    decisionMaker: { name: null, title: null },
  },
  opportunity: {
    opportunityId: 3,
    estimatedAnnualValueCents: null,
    estimateConfidence: "low",
    score: 50,
    primarySignal: "field visit",
    reasons: [],
    risks: [],
  },
  brief: {
    laundryOpportunity: "",
    salesAngle: "",
    openingLine: "",
    discoveryQuestions: [],
    objections: [],
  },
  steps: [],
  expiresAt: null,
  createdAt: "2026-09-25T08:00:00.000Z",
  updatedAt: "2026-09-25T08:30:00.000Z",
  completedAt: null,
};

function memoryDb(input?: {
  arrivedAt?: Date | null;
  outcomeRecordedBy?: string;
  outcomePresent?: boolean;
}) {
  const events: Row[] = [];
  const fieldRows: Row[] = [
    {
      id: 1,
      tenantId: "tenant-a",
      missionId: 41,
      version: 3,
      notes: "",
      preparationStartedAt: new Date("2026-09-25T08:00:00.000Z"),
      departedAt: new Date("2026-09-25T08:10:00.000Z"),
      arrivedAt:
        input?.arrivedAt === undefined
          ? new Date("2026-09-25T08:20:00.000Z")
          : input.arrivedAt,
      checkInMethod: "location",
      latitude: "34.1000000",
      longitude: "-118.2000000",
      locationAccuracyMeters: 12,
    },
  ];
  const outcomes: Row[] =
    input?.outcomePresent === false
      ? []
      : [
          {
            id: 7,
            tenantId: "tenant-a",
            missionId: 41,
            outcome: "no_decision",
            notes: "Spoke with front desk.",
            followUpAt: null,
            estimatedContractValueCents: null,
            decisionMakerStatus: "not_recorded",
            collateralDelivered: true,
            quoteRequested: false,
            pilotRequested: false,
            followUpRequested: false,
            reason: null,
            evidenceJson: {},
            recordedBy: input?.outcomeRecordedBy ?? "driver-1",
            createdAt: new Date("2026-09-25T08:25:00.000Z"),
          },
        ];

  const rowsFor = (table: object): Row[] => {
    if (table === commercialMissionEvents) return events;
    if (table === commercialMissionFieldStates) return fieldRows;
    if (table === commercialVisitOutcomes) return outcomes;
    if (table === commercialMissionFieldChecklistItems) return [];
    if (table === commercialProposals) return [];
    return [];
  };

  const select = (_selection?: unknown) => ({
    from(table: object) {
      const chain = {
        where(_predicate: unknown) {
          return chain;
        },
        orderBy(..._args: unknown[]) {
          return chain;
        },
        limit(_count: number) {
          return Promise.resolve(rowsFor(table));
        },
        then<TResult1 = Row[], TResult2 = never>(
          onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve(rowsFor(table)).then(onfulfilled, onrejected);
        },
      };
      return chain;
    },
  });

  const tx = {
    select,
    insert(table: object) {
      return {
        values(values: Row) {
          if (table === commercialMissionEvents) {
            events.push({
              id: events.length + 1,
              createdAt: new Date("2026-09-25T08:30:00.000Z"),
              ...values,
            });
          }
          return Promise.resolve([{ insertId: events.length }]);
        },
      };
    },
  };

  return {
    events,
    db: {
      select,
      transaction: async <T>(work: (inner: typeof tx) => Promise<T>) =>
        work(tx),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCommercialMission.mockResolvedValue(mission);
  mocks.readCommercialMissionWith.mockResolvedValue(mission);
});

describe("Parking-Lot Clerk persistence", () => {
  it("stores one operator-reported observation on the existing mission identity", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);

    const state = await recordParkingLotClerkObservation({
      tenantId: "tenant-a",
      missionId: 41,
      actorId: "driver-1",
      requestId: "7f326e52-0f8b-4c11-b069-2b88a8fa1f91",
      text: "Nobody home.",
    });

    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]).toEqual(
      expect.objectContaining({
        tenantId: "tenant-a",
        missionId: 41,
        eventName: "parking_lot_clerk_observation",
        actorType: "driver",
        actorId: "driver-1",
        idempotencyKey: "parking-lot-clerk:41",
        metadataJson: expect.objectContaining({
          text: "Nobody home.",
          provenance: "operator_reported",
          visitOutcomeId: 7,
        }),
      })
    );
    expect(state.parkingLotClerkObservation).toEqual({
      missionId: 41,
      text: "Nobody home.",
      provenance: "operator_reported",
      reportedBy: "driver-1",
      reportedAt: "2026-09-25T08:30:00.000Z",
    });
  });

  it.each(["Left a card.", "Call next week."])(
    "preserves legitimate freeform testimony: %s",
    async text => {
      const memory = memoryDb();
      mocks.getDb.mockResolvedValue(memory.db);
      await recordParkingLotClerkObservation({
        tenantId: "tenant-a",
        missionId: 41,
        actorId: "driver-1",
        requestId: "18e05363-4c04-48a2-bdd0-7ef9f09c6b20",
        text,
      });
      expect(
        (memory.events[0]?.metadataJson as Record<string, unknown>)?.text
      ).toBe(text);
    }
  );

  it("requires persisted arrival and a persisted visit outcome", async () => {
    const noArrival = memoryDb({ arrivedAt: null });
    mocks.getDb.mockResolvedValue(noArrival.db);
    await expect(
      recordParkingLotClerkObservation({
        tenantId: "tenant-a",
        missionId: 41,
        actorId: "driver-1",
        requestId: "e696153f-775b-48c7-ac0b-45613d82a055",
        text: "Nobody home.",
      })
    ).rejects.toThrow("persisted real visit arrival");

    const noOutcome = memoryDb({ outcomePresent: false });
    mocks.getDb.mockResolvedValue(noOutcome.db);
    await expect(
      recordParkingLotClerkObservation({
        tenantId: "tenant-a",
        missionId: 41,
        actorId: "driver-1",
        requestId: "37ae8306-5360-42be-a09d-e228b8484f2b",
        text: "Nobody home.",
      })
    ).rejects.toThrow("persisted real visit outcome");
  });

  it("does not let a different operator author the visit testimony", async () => {
    const memory = memoryDb({ outcomeRecordedBy: "driver-1" });
    mocks.getDb.mockResolvedValue(memory.db);
    await expect(
      recordParkingLotClerkObservation({
        tenantId: "tenant-a",
        missionId: 41,
        actorId: "driver-2",
        requestId: "a995b830-71cf-4813-9ec4-63043e6ee68f",
        text: "Left a card.",
      })
    ).rejects.toThrow("operator who recorded the visit");
    expect(memory.events).toHaveLength(0);
  });

  it("is one-per-mission and idempotent across retries", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    await recordParkingLotClerkObservation({
      tenantId: "tenant-a",
      missionId: 41,
      actorId: "driver-1",
      requestId: "a98a6c4a-24c5-4563-8f7b-a23a264a50d7",
      text: "Left a card.",
    });
    await recordParkingLotClerkObservation({
      tenantId: "tenant-a",
      missionId: 41,
      actorId: "driver-1",
      requestId: "ce57d081-f873-4e1f-a18b-b510a1afcc02",
      text: "This retry must not create another note.",
    });
    expect(memory.events).toHaveLength(1);
    expect(
      (memory.events[0]?.metadataJson as Record<string, unknown>)?.text
    ).toBe("Left a card.");
  });

  it("reads the same durable observation back by mission identity", async () => {
    const memory = memoryDb();
    mocks.getDb.mockResolvedValue(memory.db);
    await recordParkingLotClerkObservation({
      tenantId: "tenant-a",
      missionId: 41,
      actorId: "driver-1",
      requestId: "568c7d6d-e3e9-41d1-bdd3-15a6bc3263fd",
      text: "Call next week.",
    });

    await expect(
      getParkingLotClerkObservation({
        tenantId: "tenant-a",
        missionId: 41,
      })
    ).resolves.toEqual(
      expect.objectContaining({
        missionId: 41,
        text: "Call next week.",
        provenance: "operator_reported",
      })
    );
  });
});
