import { TOWER_WARS_ATTACK_THRESHOLD_CENTS } from "./goldlineGameConfig";
import type { PropertyGroup } from "./propertyTowers";

export type TowerWarsBuildingId = Exclude<PropertyGroup, "unknown">;
export type TowerWarsRevenueSource =
  | "stripe"
  | "local_order_payment"
  | "cleancloud"
  | "clearent_xplorpay";

export type TowerWarsBusinessEvent = {
  eventId: string;
  occurredAt: string;
  businessDate: string;
  buildingId: TowerWarsBuildingId;
  buildingDisplayName: string;
  orderId: string | number | null;
  customerIdentity: string | null;
  customerDisplayName: string | null;
  customerPhone: string | null;
  revenueSource: TowerWarsRevenueSource;
  realOrderValueCents: number;
  sourceEvidence: Record<string, string | number | boolean | null>;
};

export type TowerWarsWeapon =
  | "opus_architectural_driver"
  | "century_valet_bazooka";

export type TowerWarsAttackEvent = {
  attackId: string;
  occurredAt: string;
  attackerBuildingId: TowerWarsBuildingId;
  defenderBuildingId: TowerWarsBuildingId;
  triggeringEventId: string;
  triggeringOrderId: string | number | null;
  thresholdCents: number;
  cumulativeValueAtTriggerCents: number;
  weapon: TowerWarsWeapon;
};

export type TowerDamageState =
  | "pristine"
  | "chipped"
  | "cracked"
  | "heavily-damaged"
  | "critical";

export type TowerWarsBuildingState = {
  buildingId: TowerWarsBuildingId;
  revenueCents: number;
  orderCount: number;
  attackCount: number;
  incomingAttackCount: number;
  unspentValueCents: number;
  damage: TowerDamageState;
  lastRevenueEventAt: string | null;
};

export type TowerWarsBattleState = {
  buildings: Record<TowerWarsBuildingId, TowerWarsBuildingState>;
  processedEventIds: string[];
  attacks: TowerWarsAttackEvent[];
};

function emptyBuilding(
  buildingId: TowerWarsBuildingId
): TowerWarsBuildingState {
  return {
    buildingId,
    revenueCents: 0,
    orderCount: 0,
    attackCount: 0,
    incomingAttackCount: 0,
    unspentValueCents: 0,
    damage: "pristine",
    lastRevenueEventAt: null,
  };
}

export function initialTowerWarsState(): TowerWarsBattleState {
  return {
    buildings: {
      opus_la: emptyBuilding("opus_la"),
      century_park_east: emptyBuilding("century_park_east"),
    },
    processedEventIds: [],
    attacks: [],
  };
}

export function compareTowerWarsEvents(
  left: TowerWarsBusinessEvent,
  right: TowerWarsBusinessEvent
): number {
  return (
    Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
    left.eventId.localeCompare(right.eventId)
  );
}

export function damageStateForIncomingAttacks(count: number): TowerDamageState {
  if (count <= 0) return "pristine";
  if (count === 1) return "chipped";
  if (count === 2) return "cracked";
  if (count === 3) return "heavily-damaged";
  return "critical";
}

function weaponFor(buildingId: TowerWarsBuildingId): TowerWarsWeapon {
  return buildingId === "opus_la"
    ? "opus_architectural_driver"
    : "century_valet_bazooka";
}

function opponentOf(buildingId: TowerWarsBuildingId): TowerWarsBuildingId {
  return buildingId === "opus_la" ? "century_park_east" : "opus_la";
}

/** Pure reducer used by both live compilation and theatrical replay. */
export function applyTowerWarsEvent(
  prior: TowerWarsBattleState,
  event: TowerWarsBusinessEvent
): TowerWarsBattleState {
  if (prior.processedEventIds.includes(event.eventId)) return prior;
  const state: TowerWarsBattleState = {
    buildings: {
      opus_la: { ...prior.buildings.opus_la },
      century_park_east: { ...prior.buildings.century_park_east },
    },
    processedEventIds: [...prior.processedEventIds, event.eventId],
    attacks: [...prior.attacks],
  };
  const attacker = state.buildings[event.buildingId];
  const defenderId = opponentOf(event.buildingId);
  const defender = state.buildings[defenderId];
  const total = attacker.unspentValueCents + event.realOrderValueCents;
  const emitted = Math.floor(total / TOWER_WARS_ATTACK_THRESHOLD_CENTS);

  attacker.revenueCents += event.realOrderValueCents;
  attacker.orderCount += 1;
  attacker.unspentValueCents = total % TOWER_WARS_ATTACK_THRESHOLD_CENTS;
  attacker.lastRevenueEventAt = event.occurredAt;

  for (let index = 0; index < emitted; index += 1) {
    state.attacks.push({
      attackId: `${event.eventId}:attack:${index + 1}`,
      occurredAt: event.occurredAt,
      attackerBuildingId: event.buildingId,
      defenderBuildingId: defenderId,
      triggeringEventId: event.eventId,
      triggeringOrderId: event.orderId,
      thresholdCents: TOWER_WARS_ATTACK_THRESHOLD_CENTS,
      cumulativeValueAtTriggerCents:
        attacker.revenueCents -
        attacker.unspentValueCents -
        (emitted - index - 1) * TOWER_WARS_ATTACK_THRESHOLD_CENTS,
      weapon: weaponFor(event.buildingId),
    });
  }
  attacker.attackCount += emitted;
  defender.incomingAttackCount += emitted;
  defender.damage = damageStateForIncomingAttacks(defender.incomingAttackCount);
  return state;
}

export function compileTowerWarsState(
  events: readonly TowerWarsBusinessEvent[]
): TowerWarsBattleState {
  return [...events]
    .sort(compareTowerWarsEvents)
    .reduce(applyTowerWarsEvent, initialTowerWarsState());
}

export type TowerWarsPromiseType =
  | "offer_insert"
  | "referral_card"
  | "loyalty_reward"
  | "thank_you_presentation"
  | "other";
export type TowerWarsPermissionStatus =
  | "not_required_physical_fulfillment"
  | "recorded"
  | "not_recorded"
  | "revoked";
export type TowerWarsPermissionChannel =
  | "physical_delivery"
  | "sms"
  | "email"
  | "phone"
  | "none";

export interface TowerWarsPromiseRecord {
  id: string;
  tenantId: string;
  buildingId: TowerWarsBuildingId;
  customerIdentity: string | null;
  promiseType: TowerWarsPromiseType;
  sourceText: string;
  quantity: number | null;
  permissionStatus: TowerWarsPermissionStatus;
  permissionChannel: TowerWarsPermissionChannel;
  permissionEvidence: string | null;
  createdAt: string;
  fulfilledAt: string | null;
  sourceReference: string;
}

export function canUsePromiseForDirectOutreach(
  promise: Pick<
    TowerWarsPromiseRecord,
    "permissionStatus" | "permissionChannel"
  >
) {
  return (
    promise.permissionStatus === "recorded" &&
    (promise.permissionChannel === "sms" ||
      promise.permissionChannel === "email" ||
      promise.permissionChannel === "phone")
  );
}

export function canExecuteTowerWarsPromise(
  promise: Pick<
    TowerWarsPromiseRecord,
    "permissionStatus" | "permissionChannel" | "permissionEvidence"
  >
): boolean {
  if (promise.permissionStatus === "not_required_physical_fulfillment") {
    return promise.permissionChannel === "physical_delivery";
  }
  return (
    promise.permissionStatus === "recorded" &&
    Boolean(promise.permissionEvidence?.trim())
  );
}
