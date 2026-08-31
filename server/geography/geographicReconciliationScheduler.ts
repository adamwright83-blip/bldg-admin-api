import { geocodePendingLocations } from "./geographicTruthService";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_INTERVAL_MS = 15 * 60_000;

type Reconcile = (input: {
  tenantId: string;
  batchSize: number;
}) => Promise<unknown>;

let activeRun: Promise<void> | null = null;

export function triggerAutomaticGeographicReconciliation(
  reconcile: Reconcile = geocodePendingLocations,
  tenantId = "default"
): Promise<void> {
  if (activeRun) return activeRun;
  activeRun = reconcile({ tenantId, batchSize: DEFAULT_BATCH_SIZE })
    .then(() => undefined)
    .catch(error => {
      console.warn(
        "[GeographicTruth] Automatic reconciliation failed; customer/order writes remain available.",
        error instanceof Error ? error.message : error
      );
    })
    .finally(() => {
      activeRun = null;
    });
  return activeRun;
}

export function startAutomaticGeographicReconciliation(input?: {
  intervalMs?: number;
  reconcile?: Reconcile;
  tenantId?: string;
}) {
  const run = () =>
    triggerAutomaticGeographicReconciliation(
      input?.reconcile,
      input?.tenantId ?? "default"
    );
  void run();
  const timer = setInterval(run, input?.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

