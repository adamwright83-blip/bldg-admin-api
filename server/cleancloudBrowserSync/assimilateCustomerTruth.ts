import { getGeographicTruth, geocodePendingLocations } from "../geography/geographicTruthService";
import { listCityWorldEntities } from "../goldlineWorld/cityWorldService";
import { drainEconomicOutbox } from "./worldOutbox";
import type { GumballAssimilationStatus } from "./gumballOperatorStatus";

export const GEOGRAPHY_MAP_REFRESH_TIMEOUT_MS = 8_000;

export type CustomerTruthAssimilation = {
  customerTruth: GumballAssimilationStatus;
  map: GumballAssimilationStatus;
  customerCount: number | null;
  unresolvedGeographyCount: number | null;
  outboxDrained: boolean;
  error: string | null;
};

export type CustomerTruthAssimilationDeps = {
  drainOutbox?: () => Promise<unknown>;
  refreshCustomerTruth?: (tenantId: string) => Promise<{
    customers: Array<{ geocodeStatus?: string | null }>;
  }>;
  geocode?: (tenantId: string) => Promise<unknown>;
  refreshMap?: (tenantId: string) => Promise<unknown>;
  /** When true (the HTTP default), skip unbounded Google and return map=pending. */
  deferMapRefresh?: boolean;
  mapRefreshTimeoutMs?: number;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * After CleanCloud rows are committed, rebuild the same geographic / lantern
 * customer read models the admin map uses. Import success is independent:
 * a failed or slow geography refresh must not be reported as an import failure.
 *
 * Deterministic customer-truth (outbox drain + getGeographicTruth) stays
 * synchronous. External Google geocoding is deferred unless tests inject it.
 */
export async function assimilateImportedCustomerTruth(
  tenantId: string,
  deps: CustomerTruthAssimilationDeps = {}
): Promise<CustomerTruthAssimilation> {
  const result: CustomerTruthAssimilation = {
    customerTruth: "failed",
    map: "failed",
    customerCount: null,
    unresolvedGeographyCount: null,
    outboxDrained: false,
    error: null,
  };
  try {
    await (deps.drainOutbox ?? drainEconomicOutbox)();
    result.outboxDrained = true;
  } catch (error) {
    result.error = messageOf(error);
  }

  try {
    const truth = await (deps.refreshCustomerTruth ??
      ((id: string) => getGeographicTruth({ tenantId: id })))(tenantId);
    result.customerTruth = "refreshed";
    result.customerCount = truth.customers.length;
    result.unresolvedGeographyCount = truth.customers.filter(
      customer =>
        customer.geocodeStatus !== "success" &&
        customer.geocodeStatus !== "missing_address"
    ).length;
  } catch (error) {
    result.error = messageOf(error);
    return result;
  }

  const deferMap =
    deps.deferMapRefresh ??
    (deps.geocode == null && deps.refreshMap == null);
  if (deferMap) {
    result.map = "pending";
    return result;
  }

  return applyGeographyMapRefresh(tenantId, result, deps);
}

export async function refreshImportedGeographyMap(
  tenantId: string,
  deps: CustomerTruthAssimilationDeps = {}
): Promise<Pick<CustomerTruthAssimilation, "map" | "error">> {
  const timeoutMs = deps.mapRefreshTimeoutMs ?? GEOGRAPHY_MAP_REFRESH_TIMEOUT_MS;
  try {
    await withTimeout(
      Promise.resolve(
        (deps.geocode ??
          ((id: string) => geocodePendingLocations({ tenantId: id })))(tenantId)
      ),
      timeoutMs,
      "geography geocode"
    );
    await withTimeout(
      Promise.resolve(
        (deps.refreshMap ??
          ((id: string) => listCityWorldEntities({ tenantId: id })))(tenantId)
      ),
      timeoutMs,
      "geography map refresh"
    );
    return { map: "refreshed", error: null };
  } catch (error) {
    return { map: "failed", error: messageOf(error) };
  }
}

async function applyGeographyMapRefresh(
  tenantId: string,
  result: CustomerTruthAssimilation,
  deps: CustomerTruthAssimilationDeps
): Promise<CustomerTruthAssimilation> {
  const refreshed = await refreshImportedGeographyMap(tenantId, deps);
  result.map = refreshed.map;
  if (refreshed.error) result.error = refreshed.error;
  return result;
}

export function assimilationReceiptFields(result: CustomerTruthAssimilation) {
  return {
    importCommitted: true,
    customerTruth: result.customerTruth,
    map: result.map,
    customerCount: result.customerCount,
    unresolvedGeographyCount: result.unresolvedGeographyCount,
    outboxDrained: result.outboxDrained,
    assimilationError: result.error,
  };
}

/** Customer truth finished; HTTP must not wait on Google. */
export function isCustomerTruthAssimilated(
  receipt: Record<string, unknown> | null | undefined
) {
  return receipt?.customerTruth === "refreshed";
}

export function isFullyAssimilated(receipt: Record<string, unknown> | null | undefined) {
  return (
    receipt?.customerTruth === "refreshed" &&
    (receipt?.map === "refreshed" ||
      receipt?.map === "pending" ||
      receipt?.map === "failed" ||
      receipt?.map === "skipped")
  );
}
