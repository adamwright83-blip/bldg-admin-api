import { fromZonedTime } from "date-fns-tz";
import { getDashboardTimeZone, zonedYmd } from "../dashboardZoned";
import { activeCustomerPopulation } from "../analytics/businessMetrics";
import { resolveCustomerIdentities } from "../analytics/customerIdentityResolution";
import {
  databaseLedgerLoaders,
  loadPaidOrderLedger,
  type LedgerLoaders,
  type LedgerSource,
} from "../analytics/paidOrderLedger";

/**
 * Claire's verified active-customer count. It is the default interpretation
 * of "active customer", computed through the same paid-order ledger and
 * identity rules as every other Goldline analytic — not a separate truth.
 */

export const ACTIVE_CUSTOMER_DEFINITION =
  "Distinct customer identity (matched by phone, email, Goldline resident id, or CleanCloud customer id) with at least one paid order on the current business-local calendar day or the preceding 29 calendar days. Native orders count only with Stripe payment evidence.";

export type ActiveCustomerSource = LedgerSource;
export type ActiveCustomerCompleteness = "complete" | "partial" | "unavailable";
export type ActiveCustomerMetric = {
  value: number | null;
  definition: string;
  windowStart: string;
  windowEnd: string;
  sources: ActiveCustomerSource[];
  unmatchedCount: number;
  completeness: ActiveCustomerCompleteness;
  computedAt: string;
};

export type PaidCustomerObservation = {
  source: ActiveCustomerSource;
  phone: string | null;
  email: string | null;
};

export type ActiveCustomerOrderCandidate = PaidCustomerObservation & {
  paid: boolean;
  orderDate: Date | null;
};

export function qualifiesActiveCustomerOrder(
  candidate: ActiveCustomerOrderCandidate,
  windowStart: Date,
  windowEnd: Date
): boolean {
  return Boolean(candidate.paid && candidate.orderDate && candidate.orderDate >= windowStart && candidate.orderDate <= windowEnd);
}

export type ActiveCustomerLoaders = LedgerLoaders;

export function countDistinctActiveCustomers(rows: PaidCustomerObservation[]): {
  value: number;
  unmatchedCount: number;
} {
  const resolved = resolveCustomerIdentities(rows, row => ({ phone: row.phone, email: row.email }));
  return { value: resolved.groups.length, unmatchedCount: resolved.unmatchedRecordCount };
}

export function activeCustomerWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(part => [part.type, part.value]));
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 29, 12));
  const startDate = localDate.toISOString().slice(0, 10);
  return { start: fromZonedTime(`${startDate}T00:00:00`, timeZone), end: now };
}

export async function getActiveCustomerMetric(input: {
  tenantId: string;
  now?: Date;
  timeZone?: string;
}, loaders: ActiveCustomerLoaders = databaseLedgerLoaders): Promise<ActiveCustomerMetric> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? getDashboardTimeZone();
  const window = activeCustomerWindow(now, timeZone);
  const ledger = await loadPaidOrderLedger(
    {
      tenantId: input.tenantId,
      startUtc: window.start,
      endExclusiveUtc: new Date(now.getTime() + 1),
      timeZone,
    },
    loaders
  );
  const population = activeCustomerPopulation(
    ledger.events,
    { start: zonedYmd(window.start, timeZone), end: zonedYmd(now, timeZone) },
    1
  );
  const unavailable = ledger.completeness === "unavailable";
  return {
    value: unavailable ? null : population.count,
    definition: ACTIVE_CUSTOMER_DEFINITION,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    sources: ledger.loadedSources,
    unmatchedCount: unavailable ? 0 : population.unmatchedCount,
    completeness: ledger.completeness,
    computedAt: now.toISOString(),
  };
}
