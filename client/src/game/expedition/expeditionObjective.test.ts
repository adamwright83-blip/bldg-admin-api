import { describe, expect, it } from "vitest";
import type { Order } from "@shared/types";
import type { OpenChannelMission } from "../../../../server/openChannel/openChannelTypes";
import {
  prepareExpeditionObjective,
  stableObjectiveSeed,
} from "./expeditionObjective";

const pickup = {
  id: 42,
  firstName: "Ada",
  lastName: "Lovelace",
  address: "1 Gold Line",
} as Order;

const mission: OpenChannelMission = {
  id: "day-1",
  businessDate: "2026-08-16",
  status: "active",
  title: "Open the day",
  operatorBriefing: "Real work",
  transcript: "Real work",
  generationSource: "deterministic_fallback",
  gapStartedAt: "2026-08-16T08:00:00.000Z",
  nextCommitmentAt: null,
  availableMinutes: 120,
  tasks: [
    {
      id: "task-1",
      position: 1,
      title: "Forge the message",
      detail: "Finish the door hanger",
      estimatedMinutes: 30,
      category: "sales",
      navigationQuery: null,
      execution: "base",
      status: "pending",
      completedAt: null,
    },
  ],
  approvedAt: "2026-08-16T08:01:00.000Z",
  completedAt: null,
};

describe("prepareExpeditionObjective", () => {
  it("keeps a genuine native pickup as the first expedition objective without changing PR #70's plan seed", () => {
    const objective = prepareExpeditionObjective({
      pickup,
      openChannelMission: mission,
    });
    expect(objective).toMatchObject({
      kind: "native_pickup",
      orderId: 42,
      planSeed: 42,
      label: "Ada Lovelace",
    });
  });

  it("promotes the first pending approved Open Channel task when no pickup exists", () => {
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: mission,
    });
    expect(objective).toMatchObject({
      kind: "open_channel",
      missionId: "day-1",
      taskId: "task-1",
      label: "Forge the message",
      detail: "Finish the door hanger",
    });
  });

  it("never replays a completed Open Channel task", () => {
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: {
        ...mission,
        tasks: mission.tasks.map(task => ({
          ...task,
          status: "completed" as const,
          completedAt: "2026-08-16T09:00:00.000Z",
        })),
      },
    });
    expect(objective).toBeNull();
  });

  it("uses a stable nonzero fictional seed for non-order objectives", () => {
    expect(stableObjectiveSeed("open-channel:day-1:task-1")).toBe(
      stableObjectiveSeed("open-channel:day-1:task-1")
    );
    expect(stableObjectiveSeed("open-channel:day-1:task-1")).toBeGreaterThan(0);
  });
});

describe("prepareExpeditionObjective (§R1 physical_stop honesty)", () => {
  const physicalMission: OpenChannelMission = {
    ...mission,
    tasks: [
      {
        id: "task-mona",
        position: 0,
        title: "Pick up Mona's order at Opus LA",
        detail: "Mona's order is ready — collect it in person.",
        estimatedMinutes: 30,
        category: "operations",
        navigationQuery: "Opus LA, 1601 Vine St",
        execution: "physical_stop",
        status: "pending",
        completedAt: null,
      },
    ],
  };

  it("resolves an operator-approved physical_stop task to the physical_stop kind, never open_channel", () => {
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: physicalMission,
    });
    expect(objective).toMatchObject({
      kind: "physical_stop",
      missionId: "day-1",
      taskId: "task-mona",
      label: "Pick up Mona's order at Opus LA",
      detail: "Opus LA, 1601 Vine St",
    });
  });

  it("the operator's explicit base override wins even with a navigationQuery present", () => {
    // The operator is the authority — the model/legacy default only
    // PROPOSES; whatever the approved row says persists.
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: {
        ...physicalMission,
        tasks: [{ ...physicalMission.tasks[0]!, execution: "base" }],
      },
    });
    expect(objective?.kind).toBe("open_channel");
  });

  it("never fabricates a NAVIGATE destination: a physical_stop task with no navigationQuery falls back to the honest open_channel presentation", () => {
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: {
        ...physicalMission,
        tasks: [{ ...physicalMission.tasks[0]!, navigationQuery: null }],
      },
    });
    expect(objective?.kind).toBe("open_channel");
  });
});

describe("externally-managed work becomes playable without becoming native", () => {
  const externalJob = (
    overrides: Partial<ExternalOperationalOrder> = {}
  ): ExternalOperationalOrder => ({
    id: "0f5c2a7e-2b1d-4f6a-9c3e-1a2b3c4d5e6f",
    sourceSystem: "cleancloud",
    ingestionMethod: "screenshot",
    externalOrderId: "CC-4471",
    jobKind: "pickup",
    customerName: "Miso",
    address: "Opus LA",
    scheduledDate: "2026-08-18",
    windowStart: "09:00",
    windowEnd: "11:00",
    notes: null,
    operationalStatus: "scheduled",
    completedAt: null,
    reconciliationStatus: "update_required",
    reconciledAt: null,
    reviewState: "confirmed",
    importBatchId: null,
    createdAt: "2026-08-17T09:00:00.000Z",
    ...overrides,
  });

  it("prepares a confirmed external job when no native pickup is due", () => {
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: null,
      externalOrders: [externalJob()],
    });
    expect(objective?.kind).toBe("external_order");
    expect(objective?.label).toBe("Miso");
    expect(objective?.detail).toBe("Opus LA");
  });

  it("carries provenance in the objective itself", () => {
    // Not a flag on the side: a consumer cannot render or complete this
    // without having seen which system owns it.
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: null,
      externalOrders: [externalJob()],
    });
    expect(objective).toMatchObject({
      kind: "external_order",
      sourceSystem: "cleancloud",
      jobKind: "pickup",
    });
  });

  it("never derives expedition dressing from another system's identifiers", () => {
    // The fictional seed must not be a function of the CleanCloud order
    // number — external identifiers are not ours to encode into the world.
    const a = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: null,
      externalOrders: [externalJob({ externalOrderId: "CC-1" })],
    });
    const b = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: null,
      externalOrders: [externalJob({ externalOrderId: "CC-99999" })],
    });
    expect(a?.planSeed).toBe(b?.planSeed);
    expect(a?.planSeed).toBeGreaterThan(0);
  });

  it("never plays an unreviewed extraction", () => {
    expect(
      prepareExpeditionObjective({
        pickup: null,
        openChannelMission: null,
        externalOrders: [externalJob({ reviewState: "pending_review" })],
      })
    ).toBeNull();
  });

  it("never replays completed external work", () => {
    expect(
      prepareExpeditionObjective({
        pickup: null,
        openChannelMission: null,
        externalOrders: [externalJob({ operationalStatus: "completed" })],
      })
    ).toBeNull();
  });

  it("keeps a genuine native pickup ahead of external work", () => {
    // This business's own obligation outranks work it merely performs.
    const objective = prepareExpeditionObjective({
      pickup: {
        id: 9300,
        address: "200 Fixture Ave",
        firstName: "Pickup",
        lastName: "Alpha",
      } as never,
      openChannelMission: null,
      externalOrders: [externalJob()],
    });
    expect(objective?.kind).toBe("native_pickup");
  });

  it("puts a waiting customer ahead of a self-directed growth task", () => {
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: {
        id: "m1",
        status: "active",
        tasks: [{ id: "t1", status: "pending", title: "Door hanger", detail: "Design" }],
      } as never,
      externalOrders: [externalJob()],
    });
    expect(objective?.kind).toBe("external_order");
  });

  it("falls back to Open Channel when external work is all done", () => {
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: {
        id: "m1",
        status: "active",
        tasks: [{ id: "t1", status: "pending", title: "Door hanger", detail: "Design" }],
      } as never,
      externalOrders: [externalJob({ operationalStatus: "completed" })],
    });
    expect(objective?.kind).toBe("open_channel");
  });

  it("exposes no native order id on an external objective", () => {
    // Structural: nothing downstream can accidentally resolve a native order
    // from a CleanCloud job, because there is no field to reach for.
    const objective = prepareExpeditionObjective({
      pickup: null,
      openChannelMission: null,
      externalOrders: [externalJob()],
    });
    expect(Object.keys(objective ?? {})).not.toContain("orderId");
  });
});
