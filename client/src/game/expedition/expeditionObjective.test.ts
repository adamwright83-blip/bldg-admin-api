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
      status: "pending",
      completedAt: null,
    },
  ],
  approvedAt: "2026-08-16T08:01:00.000Z",
  completedAt: null,
};

describe("prepareExpeditionObjective", () => {
  it("keeps a genuine native pickup as the first expedition objective", () => {
    const objective = prepareExpeditionObjective({
      pickup,
      openChannelMission: mission,
    });
    expect(objective).toMatchObject({
      kind: "native_pickup",
      orderId: 42,
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

  it("uses a stable nonzero fictional seed", () => {
    expect(stableObjectiveSeed("open-channel:day-1:task-1")).toBe(
      stableObjectiveSeed("open-channel:day-1:task-1")
    );
    expect(stableObjectiveSeed("open-channel:day-1:task-1")).toBeGreaterThan(0);
  });
});
