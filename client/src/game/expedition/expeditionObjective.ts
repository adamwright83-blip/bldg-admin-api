import type { Order } from "@shared/types";
import type { OpenChannelMission } from "../../../../server/openChannel/openChannelTypes";

export type NativePickupExpeditionObjective = {
  kind: "native_pickup";
  key: string;
  planSeed: number;
  label: string;
  detail: string;
  orderId: number;
};

export type OpenChannelExpeditionObjective = {
  kind: "open_channel";
  key: string;
  planSeed: number;
  label: string;
  detail: string;
  missionId: string;
  taskId: string;
};

export type PreparedExpeditionObjective =
  | NativePickupExpeditionObjective
  | OpenChannelExpeditionObjective;

/**
 * Deterministic fictional seed. It may vary expedition dressing but
 * can never create, erase, or resolve business truth.
 */
export function stableObjectiveSeed(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

/**
 * One truthful bridge into the expedition shell.
 *
 * Native pickup keeps priority when one is genuinely due. Otherwise
 * the first pending, human-approved Open Channel task becomes the
 * expedition objective. No task is invented here and completed tasks
 * can never re-enter the run.
 */
export function prepareExpeditionObjective(input: {
  pickup: Order | null;
  openChannelMission: OpenChannelMission | null;
}): PreparedExpeditionObjective | null {
  const pickupAddress = input.pickup?.address?.trim();
  if (input.pickup && pickupAddress) {
    const key = `pickup:${input.pickup.id}`;
    return {
      kind: "native_pickup",
      key,
      planSeed: stableObjectiveSeed(key),
      label:
        `${input.pickup.firstName ?? ""} ${input.pickup.lastName ?? ""}`.trim() ||
        `Order #${input.pickup.id}`,
      detail: pickupAddress,
      orderId: input.pickup.id,
    };
  }

  if (input.openChannelMission?.status !== "active") return null;
  const task = input.openChannelMission.tasks.find(
    candidate => candidate.status === "pending"
  );
  if (!task) return null;

  const key = `open-channel:${input.openChannelMission.id}:${task.id}`;
  return {
    kind: "open_channel",
    key,
    planSeed: stableObjectiveSeed(key),
    label: task.title,
    detail: task.detail,
    missionId: input.openChannelMission.id,
    taskId: task.id,
  };
}
