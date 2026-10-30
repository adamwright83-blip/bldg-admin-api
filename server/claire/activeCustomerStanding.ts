/**
 * Where the operator stands on an active-customer goal: today's verified count,
 * whether it is complete or only a minimum, and how far each source reaches.
 *
 * Same definition and ledger as `getActiveCustomerMetric`
 * (ACTIVE_CUSTOMER_DEFINITION), with two differences found on 2026-10-29:
 *
 * - Scope. Laundry Farm is one company kept in two books: CleanCloud orders
 *   under `laundry_farm`, Laundry Butler orders under `default`
 *   (laundryFarmCompanyView.ts). The operator's goal lives on `default`, so a
 *   default-only read counted 2 customers while the company had 23. A goal on
 *   either tenant is measured across both, customers deduplicated across books,
 *   but only the books the operator is authorized to read (the company view's rule).
 * - Freshness. The ledger calls itself complete when its sources load, even
 *   when CleanCloud has not been imported for days. Source coverage says how
 *   far each source reaches.
 *
 * The count is always TODAY's 30-day window over the records that could be
 * read (PR #775 review: a today-window count labeled "as of the 26th" is
 * neither). Missing records can only leave customers out, so an incomplete
 * count is a minimum: "at least 23", with the sources that are behind.
 * Never throws for a missing source: what could not be read, including the
 * coverage check itself, becomes a caveat and the count is incomplete.
 */
import { reconcileLedgerSpan } from "../analytics/canonicalRevenue";
import { activeCustomerPopulation } from "../analytics/businessMetrics";
import { LAUNDRY_FARM_COMPANY_TENANTS, membershipTenantIds } from "../analytics/laundryFarmCompanyView";
import { loadPaidOrderLedger, type PaidOrderEvent, type PaidOrderLedger } from "../analytics/paidOrderLedger";
import type { BusinessSourceCoverageSnapshot } from "../analytics/sourceCoverage";
import { getDashboardTimeZone, zonedYmd } from "../dashboardZoned";
import { activeCustomerWindow } from "./activeCustomerMetric";

export type ActiveCustomerStanding = {
  /** Distinct active customers in the records that could be read and verified. Null when nothing could be read. */
  value: number | null;
  /** Every book loaded, every paid order verified, coverage readable, and every held source current. */
  complete: boolean;
  /** Incomplete but readable: the true count today is at least `value`. */
  atLeast: boolean;
  /** Business-local day the 30-day window ends (today). */
  windowEnd: string;
  /** How far each held source reaches; `current` false when it is behind or unknown. */
  sources: Array<{ source: string; through: string | null; current: boolean }>;
  tenants: string[];
  /** Plain sentences: why the count may be low. Empty when complete. */
  caveats: string[];
};

export type ActiveCustomerStandingDeps = {
  loadAuthorizedTenantIds?: (operatorUserId: string) => Promise<readonly string[]>;
  loadLedger?: (input: { tenantId: string; startUtc: Date; endExclusiveUtc: Date; timeZone: string }) => Promise<PaidOrderLedger>;
  loadCoverage?: (input: { tenantId: string; now: Date }) => Promise<BusinessSourceCoverageSnapshot>;
};

/**
 * The tenants whose books measure a goal set on `tenantId`: the goal's own tenant, plus the
 * other books of the same company that the operator is authorized to read.
 */
export function standingTenants(tenantId: string, authorized: readonly string[] = [tenantId]): string[] {
  if (!(LAUNDRY_FARM_COMPANY_TENANTS as readonly string[]).includes(tenantId)) return [tenantId];
  const allowed = new Set([tenantId, ...authorized]);
  return LAUNDRY_FARM_COMPANY_TENANTS.filter(candidate => allowed.has(candidate));
}

const SOURCE_NAMES: Record<string, string> = { cleancloud: "CleanCloud", laundry_butler: "Laundry Butler" };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export async function getActiveCustomerStanding(
  input: { tenantId: string; operatorUserId: string; now?: Date; timeZone?: string },
  deps: ActiveCustomerStandingDeps = {}
): Promise<ActiveCustomerStanding> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? getDashboardTimeZone();
  const window = activeCustomerWindow(now, timeZone);
  const span = { start: zonedYmd(window.start, timeZone), end: zonedYmd(now, timeZone) };
  const authorized = await (deps.loadAuthorizedTenantIds ?? membershipTenantIds)(input.operatorUserId).catch(() => [] as string[]);
  const tenants = standingTenants(input.tenantId, authorized);
  const loadLedger = deps.loadLedger ?? (ledgerInput => loadPaidOrderLedger(ledgerInput));
  const loadCoverage =
    deps.loadCoverage ??
    (async (coverageInput: { tenantId: string; now: Date }) => {
      const { loadBusinessSourceCoverage } = await import("../analytics/sourceCoverage");
      return loadBusinessSourceCoverage(coverageInput);
    });

  const events: PaidOrderEvent[] = [];
  const caveats: string[] = [];
  const sources: ActiveCustomerStanding["sources"] = [];
  let readable = 0;
  for (const tenantId of tenants) {
    const [ledger, coverage] = await Promise.all([
      // A coverage read that fails is null here and becomes a caveat in coverageCaveats.
      loadLedger({ tenantId, startUtc: window.start, endExclusiveUtc: new Date(now.getTime() + 1), timeZone }).catch(() => null),
      loadCoverage({ tenantId, now }).catch(() => null),
    ]);
    if (!ledger || ledger.completeness === "unavailable") {
      caveats.push(`The ${tenantId === "default" ? "Laundry Butler" : "Laundry Farm"} order book could not be read.`);
      continue;
    }
    readable += 1;
    events.push(...reconcileLedgerSpan(ledger, span).includedEvents);
    for (const source of ledger.failedSources) {
      const unverified = (ledger.unverifiedPaymentAuthority ?? []).filter(item => item.source === source);
      if (unverified.length) {
        const noCapture = unverified.filter(item => item.reason === "captured_amount_unknown").length;
        caveats.push(
          noCapture === unverified.length
            ? `${plural(noCapture, `${SOURCE_NAMES[source] ?? source} order has`, `${SOURCE_NAMES[source] ?? source} orders have`)} a payment with no recorded captured amount, so ${noCapture === 1 ? "it isn't" : "they aren't"} counted.`
            : `${plural(unverified.length, `${SOURCE_NAMES[source] ?? source} order`, `${SOURCE_NAMES[source] ?? source} orders`)} could not be verified as paid, so ${unverified.length === 1 ? "it isn't" : "they aren't"} counted.`
        );
      } else {
        caveats.push(`${SOURCE_NAMES[source] ?? source} orders could not be read.`);
      }
    }
    caveats.push(...coverageCaveats(tenantId, coverage, sources));
  }
  const population = activeCustomerPopulation(events, span, 1);
  const unique = [...new Set(caveats)];
  const complete = readable === tenants.length && unique.length === 0;
  return {
    value: readable ? population.count : null,
    complete,
    atLeast: Boolean(readable) && !complete,
    windowEnd: span.end,
    sources: sources.filter((entry, index) => sources.findIndex(other => other.source === entry.source && other.through === entry.through && other.current === entry.current) === index),
    tenants,
    caveats: unique,
  };
}

export const BOOK_NAMES: Record<string, string> = { default: "Laundry Butler", laundry_farm: "Laundry Farm" };

/**
 * Freshness caveats for one book. A coverage snapshot that could not be read is itself a caveat:
 * unknown freshness is never treated as current (PR #775 review). Fills `sources` as a side record.
 */
export function coverageCaveats(
  tenantId: string,
  coverage: BusinessSourceCoverageSnapshot | null,
  sources: Array<{ source: string; through: string | null; current: boolean }> = []
): string[] {
  if (!coverage) {
    sources.push({ source: BOOK_NAMES[tenantId] ?? tenantId, through: null, current: false });
    return [`Could not check how current the ${BOOK_NAMES[tenantId] ?? tenantId} records are.`];
  }
  const caveats: string[] = [];
  for (const source of coverage.sources) {
    if (!source.includedInCombinedBook) continue;
    const current = source.status === "fresh";
    sources.push({ source: source.name, through: source.coveredThrough ?? null, current });
    if (current) continue;
    caveats.push(
      source.coveredThrough
        ? `${source.name} records only reach ${source.coveredThrough}; nothing newer has been imported.`
        : `${source.name} records are not current.`
    );
  }
  return caveats;
}

