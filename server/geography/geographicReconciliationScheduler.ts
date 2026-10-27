import { geocodePendingLocations } from "./geographicTruthService";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_INTERVAL_MS = 15 * 60_000;

/**
 * Tenants the automatic reconciliation may touch. Geocoding calls a paid provider, so a tenant joins
 * this list only when the operator adds it to GEOGRAPHY_RECONCILE_TENANTS (comma separated).
 * Unset keeps the one tenant production already ran before this was configurable; it is a stated
 * compatibility value, not a fallback for tenants that are missing from a configured list.
 */
export const LEGACY_AUTOMATIC_GEOGRAPHY_TENANTS: readonly string[] = ["default"];

export function authorizedGeographyTenants(
  raw: string | undefined = process.env.GEOGRAPHY_RECONCILE_TENANTS
): string[] {
  if (raw === undefined) return [...LEGACY_AUTOMATIC_GEOGRAPHY_TENANTS];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

type Reconcile = (input: {
  tenantId: string;
  batchSize: number;
}) => Promise<unknown>;

export type TenantReconciliationOutcome = {
  tenantId: string;
  ok: boolean;
  error?: string;
  at: string;
};

/** Last outcome per tenant, so a silent tenant is visible instead of looking healthy. */
const lastOutcomes = new Map<string, TenantReconciliationOutcome>();
const activeRuns = new Map<string, Promise<void>>();

export function lastGeographicReconciliationOutcomes(): TenantReconciliationOutcome[] {
  return [...lastOutcomes.values()];
}

export function resetGeographicReconciliationStateForTest() {
  lastOutcomes.clear();
  activeRuns.clear();
}

export function triggerAutomaticGeographicReconciliation(
  reconcile: Reconcile = geocodePendingLocations,
  tenantId: string
): Promise<void> {
  if (!tenantId) return Promise.resolve();
  const running = activeRuns.get(tenantId);
  if (running) return running;
  let started: Promise<unknown>;
  try {
    started = reconcile({ tenantId, batchSize: DEFAULT_BATCH_SIZE });
  } catch (error) {
    started = Promise.reject(error);
  }
  const run = started
    .then(() => {
      lastOutcomes.set(tenantId, { tenantId, ok: true, at: new Date().toISOString() });
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      lastOutcomes.set(tenantId, { tenantId, ok: false, error: message, at: new Date().toISOString() });
      console.warn(
        `[GeographicTruth] Automatic reconciliation failed for tenant ${tenantId}; customer/order writes remain available.`,
        message
      );
    })
    .finally(() => {
      activeRuns.delete(tenantId);
    });
  activeRuns.set(tenantId, run);
  return run;
}

/** One pass over every authorized tenant. A failing tenant never blocks the next one. */
export async function reconcileAuthorizedGeographyTenants(
  reconcile: Reconcile = geocodePendingLocations,
  tenants: readonly string[] = authorizedGeographyTenants()
): Promise<void> {
  for (const tenantId of tenants) {
    await triggerAutomaticGeographicReconciliation(reconcile, tenantId);
  }
}

export function startAutomaticGeographicReconciliation(input?: {
  intervalMs?: number;
  reconcile?: Reconcile;
  tenants?: readonly string[];
}) {
  const tenants = input?.tenants ?? authorizedGeographyTenants();
  console.info(
    `[GeographicTruth] Automatic reconciliation tenants: ${tenants.length ? tenants.join(", ") : "(none)"}`
  );
  const run = () => reconcileAuthorizedGeographyTenants(input?.reconcile, tenants);
  void run();
  const timer = setInterval(run, input?.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
