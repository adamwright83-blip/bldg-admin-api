/**
 * Minimum read contract for a future authoritative Daily Dump promise seam.
 * Tower Wars intentionally does not create these records or infer permission.
 * A producer must persist evidence before an action can become available.
 */
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
  buildingSlug: string;
  promiseType: TowerWarsPromiseType;
  sourceText: string;
  quantity: number | null;
  permissionStatus: TowerWarsPermissionStatus;
  permissionChannel: TowerWarsPermissionChannel;
  createdAt: string;
  fulfilledAt: string | null;
  nextAction: string | null;
  sourceReference: string;
}

export function canUsePromiseForDirectOutreach(
  promise: Pick<TowerWarsPromiseRecord, "permissionStatus" | "permissionChannel">
) {
  return (
    promise.permissionStatus === "recorded" &&
    (promise.permissionChannel === "sms" ||
      promise.permissionChannel === "email" ||
      promise.permissionChannel === "phone")
  );
}
