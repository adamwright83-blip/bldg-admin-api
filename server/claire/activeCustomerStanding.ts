/**
 * Where the operator stands on an active-customer goal: the verified count,
 * how complete it is, and the last day the records cover.
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
 *   far each book reaches, so the count says "through when".
 *
 * Never throws for a missing source: what could not be read becomes a caveat.
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
  /** Every book loaded, every paid order verified, and every held source current. */
  complete: boolean;
  /** Last business-local day the records reach. Today when every source is current. */
  countedThrough: string | null;
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
  const throughDays: string[] = [];
  let readable = 0;
  for (const tenantId of tenants) {
    const [ledger, coverage] = await Promise.all([
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
    for (const source of coverage?.sources ?? []) {
      if (!source.includedInCombinedBook || source.status === "fresh") continue;
      if (source.coveredThrough) throughDays.push(source.coveredThrough);
      caveats.push(
        source.coveredThrough
          ? `${source.name} records only reach ${source.coveredThrough}; nothing newer has been imported.`
          : `${source.name} records are not current.`
      );
    }
  }
  const population = activeCustomerPopulation(events, span, 1);
  const unique = [...new Set(caveats)];
  return {
    value: readable ? population.count : null,
    complete: readable === tenants.length && unique.length === 0,
    countedThrough: throughDays.length ? throughDays.sort()[0]! : readable ? span.end : null,
    tenants,
    caveats: unique,
  };
}

