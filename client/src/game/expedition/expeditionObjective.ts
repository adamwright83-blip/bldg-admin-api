import type { Order } from "@shared/types";
import type { OpenChannelMission } from "../../../../server/openChannel/openChannelTypes";
import {
  isPlayableExternalOrder,
  type ExternalOperationalOrder,
} from "../../../../shared/externalOperationalOrder";

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

/**
 * Real work owned by another system — a CleanCloud pickup or dropoff.
 *
 * Carries its provenance in the type, not as a flag on the side, so no
 * consumer can render or complete one of these without having had to see
 * which system actually owns it.
 */
export type ExternalOrderExpeditionObjective = {
  kind: "external_order";
  key: string;
  planSeed: number;
  label: string;
  detail: string;
  externalOrderId: string;
  sourceSystem: ExternalOperationalOrder["sourceSystem"];
  jobKind: ExternalOperationalOrder["jobKind"];
};

export type PreparedExpeditionObjective =
  | NativePickupExpeditionObjective
  | OpenChannelExpeditionObjective
  | ExternalOrderExpeditionObjective;

/**
 * Deterministic fictional seed for non-order objectives. It may vary
 * expedition dressing but can never create, erase, or resolve business truth.
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
 * Native pickup keeps priority when one is genuinely due. Its expedition seed
 * remains the real order id so PR #70's deterministic pickup composition does
 * not change. Otherwise the first pending, human-approved Open Channel task
 * becomes the expedition objective. No task is invented here and completed
 * tasks can never re-enter the run.
 */
export function prepareExpeditionObjective(input: {
  pickup: Order | null;
  openChannelMission: OpenChannelMission | null;
  externalOrders?: readonly ExternalOperationalOrder[];
}): PreparedExpeditionObjective | null {
  const pickupAddress = input.pickup?.address?.trim();
  if (input.pickup && pickupAddress) {
    const key = `pickup:${input.pickup.id}`;
    return {
      kind: "native_pickup",
      key,
      planSeed: input.pickup.id,
      label:
        `${input.pickup.firstName ?? ""} ${input.pickup.lastName ?? ""}`.trim() ||
        `Order #${input.pickup.id}`,
      detail: pickupAddress,
      orderId: input.pickup.id,
    };
  }

  // Externally-managed work outranks an Open Channel task: a customer waiting
  // on a pickup is time-bound in a way that "finish the door hanger" is not.
  // It sits below a native pickup only because that one is this business's own
  // obligation end to end.
  const external = (input.externalOrders ?? []).find(isPlayableExternalOrder);
  if (external) {
    const key = `external:${external.id}`;
    return {
      kind: "external_order",
      key,
      // A fictional seed, deliberately NOT the external id: expedition
      // dressing must never be derivable from another system's identifiers.
      planSeed: stableObjectiveSeed(key),
      label: external.customerName,
      detail: external.address?.trim() || "Address not recorded",
      externalOrderId: external.id,
      sourceSystem: external.sourceSystem,
      jobKind: external.jobKind,
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
