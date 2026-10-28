/**
 * The snapshot strip on the main account page: week to date and month to date, each against the comparable stretch
 * of the period before. Figures come from the canonical paid-order ledger on the server, never from this file.
 *
 * A number the server cannot source is `null`, and the page says "Not wired yet". It is never a zero.
 */

export type AccountSnapshotPrecision = "exact" | "recorded" | "unavailable";

export type AccountSnapshotMetric = {
  /** Null when the figure cannot be sourced, or when it would be an unproven zero. */
  value: number | null;
  previous: number | null;
  /** Percent change against `previous`, one decimal. Null without two sourced figures or when `previous` is 0. */
  changePct: number | null;
  /** "exact": coverage licenses the figure. "recorded": what the ledger holds, coverage incomplete. */
  precision: AccountSnapshotPrecision;
};

export type AccountSnapshotPeriod = {
  key: "week" | "month";
  label: string;
  start: string;
  end: string;
  comparison: { start: string; end: string; label: string };
  revenueCents: AccountSnapshotMetric;
  orders: AccountSnapshotMetric;
  newCustomers: AccountSnapshotMetric;
};

export type AccountSnapshot = {
  generatedAt: string;
  timeZone: string;
  /** Business-local date, YYYY-MM-DD. */
  today: string;
  /** Business-local month name, e.g. "October". */
  monthName: string;
  /** City of the tenant's primary location, when its address names one. Null is shown as nothing. */
  city: string | null;
  week: AccountSnapshotPeriod;
  month: AccountSnapshotPeriod;
};

/** Percent change, one decimal. Null when either side is unknown or the base is zero. */
export function percentChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
