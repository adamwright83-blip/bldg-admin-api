/**
 * Customer intelligence status model (Phase 2).
 * Recency status and tier are intentionally separate concepts.
 */

export const NEW_WINDOW_DAYS = 7;
export const ACTIVE_WINDOW_DAYS = 14;
export const WARM_WINDOW_DAYS = 45;
export const COOLING_WINDOW_DAYS = 90;

export const VIP_SPEND_THRESHOLD = 300;
export const VIP_ORDER_COUNT_THRESHOLD = 5;

export type CustomerRecencyStatus = "new" | "active" | "warm" | "cooling" | "lapsed";
export type CustomerTier = "vip" | "standard";
export type StatusColorToken =
  | "success"
  | "warning"
  | "danger"
  | "muted"
  | "info"
  | "default";

export const STATUS_COLOR_BY_RECENCY: Record<CustomerRecencyStatus, StatusColorToken> = {
  new: "info",
  active: "success",
  warm: "default",
  cooling: "warning",
  lapsed: "danger",
};

export function daysSince(date: Date | string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const ts = new Date(date).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / msPerDay));
}

export function computeRecencyStatus(params: {
  totalOrders: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
}): CustomerRecencyStatus {
  const { totalOrders, firstOrderAt, lastOrderAt } = params;
  const daysFromFirst = daysSince(firstOrderAt);
  const daysFromLast = daysSince(lastOrderAt);

  if (totalOrders === 1 && daysFromFirst < NEW_WINDOW_DAYS) return "new";
  if (daysFromLast < ACTIVE_WINDOW_DAYS) return "active";
  if (daysFromLast <= WARM_WINDOW_DAYS) return "warm";
  if (daysFromLast <= COOLING_WINDOW_DAYS) return "cooling";
  return "lapsed";
}

export function computeCustomerTier(params: {
  lifetimeSpend: number;
  totalOrders: number;
}): CustomerTier {
  const { lifetimeSpend, totalOrders } = params;
  return lifetimeSpend > VIP_SPEND_THRESHOLD || totalOrders >= VIP_ORDER_COUNT_THRESHOLD
    ? "vip"
    : "standard";
}
