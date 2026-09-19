import { getGeographicTruth, geocodePendingLocations } from "../geography/geographicTruthService";
import { listCityWorldEntities } from "../goldlineWorld/cityWorldService";
import { drainEconomicOutbox } from "./worldOutbox";
import type { GumballAssimilationStatus } from "./gumballOperatorStatus";

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
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * After CleanCloud rows are committed, rebuild the same geographic / lantern
 * customer read models the admin map uses. Import success is independent:
 * a failed assimilation must not be reported as a successful city refresh.
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

  try {
    await (deps.geocode ??
      ((id: string) => geocodePendingLocations({ tenantId: id })))(tenantId);
    await (deps.refreshMap ??
      ((id: string) => listCityWorldEntities({ tenantId: id })))(tenantId);
    result.map = "refreshed";
  } catch (error) {
    result.error = messageOf(error);
  }
  return result;
}

export function assimilationReceiptFields(result: CustomerTruthAssimilation) {
  return {
    customerTruth: result.customerTruth,
    map: result.map,
    customerCount: result.customerCount,
    unresolvedGeographyCount: result.unresolvedGeographyCount,
    outboxDrained: result.outboxDrained,
    assimilationError: result.error,
  };
}

export function isFullyAssimilated(receipt: Record<string, unknown> | null | undefined) {
  return (
    receipt?.customerTruth === "refreshed" && receipt?.map === "refreshed"
  );
}
