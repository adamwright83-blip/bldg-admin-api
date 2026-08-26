import { describe, expect, it } from "vitest";
import type { Order } from "@shared/types";
import type { CommercialMission } from "@shared/commercialMission";
import type { ExternalOperationalOrder } from "@shared/externalOperationalOrder";
import { buildDayPlanProjection } from "./goldlineDayPlanModel";

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

const external = (reviewState: ExternalOperationalOrder["reviewState"]) =>
  ({
    id: `clean-${reviewState}`,
    sourceSystem: "cleancloud",
    ingestionMethod: "screenshot",
    externalOrderId: null,
    jobKind: "dropoff",
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
    expect(ready.stops[0]).toMatchObject({
      status: "ready",
      missionTarget: "colosseum",
    });
    expect(blocked.stops[0]).toMatchObject({
      status: "upcoming",
      missionTarget: "colosseum",
    });
  });
});
