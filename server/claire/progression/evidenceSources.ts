import { and, eq } from "drizzle-orm";
import { cleancloudPaidOrders } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";
import { listClaireRelationshipEvents } from "../character/relationshipEvents";
import { evaluateDisclosureSafetyOk } from "../character/tierEngine";
import { derivePaidOrderProgress, type PaidOrderRow } from "./paidOrderProgress";
import { recordProgressionEvidence, refreshProgression } from "./service";
import type { OperatorScope, ProgressionStore } from "./store";
import { getProgressionStore } from "./drizzleStore";

/**
 * Where evidence comes from. Every source here reads persisted business truth
 * or a confirmed field debrief; the model never supplies any of it.
 */

/** Existing disclosure-safety requirements (relationship behavior only, never business results). */
export async function loadDisclosureSafetyOk(scope: OperatorScope): Promise<boolean> {
  try {
    const events = await listClaireRelationshipEvents({ ...scope, characterId: "claire" });
    return evaluateDisclosureSafetyOk(events);
  } catch {
    return false; // fail closed
  }
}

/**
 * A confirmed, persisted field-visit outcome (the debrief path, after
 * recordCommercialMissionVisitOutcome already succeeded). Effort is credited
 * whatever the result: a lost or unanswered visit is still a real visit.
 * Only a WON outcome is also business progress. A loss creates no negative evidence.
 */
export async function recordConfirmedVisitEvidence(
  input: OperatorScope & { missionId: number; outcome: string; occurredAt?: Date },
  store: ProgressionStore = getProgressionStore(),
  now: () => Date = () => new Date()
): Promise<void> {
  if (!input.operatorUserId) return;
  const occurredAt = input.occurredAt ?? now();
  await recordProgressionEvidence(store, {
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    category: "growth_action",
    kind: "confirmed_field_visit",
    sourceType: "commercial_mission",
    sourceId: String(input.missionId),
    provenance: "debrief_confirm",
    occurredAt,
  }, now);
  if (input.outcome === "won") {
    await recordProgressionEvidence(store, {
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      category: "business_progress",
      kind: "target_account_won",
      sourceType: "commercial_mission",
      sourceId: String(input.missionId),
      provenance: "debrief_confirm",
      occurredAt,
    }, now);
  }
  await refreshProgression(store, input, { disclosureSafetyOk: await loadDisclosureSafetyOk(input), now });
}

/** Loads canonical paid orders for a tenant. Read-only. */
export async function loadPaidOrderRows(tenantId: string): Promise<PaidOrderRow[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({
        orderId: cleancloudPaidOrders.cleancloudOrderId,
        customerId: cleancloudPaidOrders.cleancloudCustomerId,
        email: cleancloudPaidOrders.customerEmail,
        name: cleancloudPaidOrders.customerName,
        buildingSlug: cleancloudPaidOrders.buildingSlug,
        paidDate: cleancloudPaidOrders.paidDateUtc,
        paymentDate: cleancloudPaidOrders.paymentDateUtc,
        createdAt: cleancloudPaidOrders.createdAt,
      })
      .from(cleancloudPaidOrders)
      .where(and(eq(cleancloudPaidOrders.tenantId, tenantId), eq(cleancloudPaidOrders.paid, true)));
    const out: PaidOrderRow[] = [];
    for (const row of rows) {
      const paidAt = row.paidDate ?? row.paymentDate;
      if (!paidAt) continue;
      out.push({
        orderId: row.orderId,
        customerKey: row.customerId ?? row.email ?? row.name,
        buildingSlug: row.buildingSlug ?? null,
        paidAt,
        recognizedAt: row.createdAt,
      });
    }
    return out;
  } catch (error) {
    if (isMysqlMissingTableError(error)) return [];
    throw error;
  }
}

const lastSync = new Map<string, number>();
const SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Pull fresh business progress from paid-order truth, then refresh the monotonic
 * grant and mint entitlements. Throttled; failures never surface mid-call.
 */
export async function syncProgressionForOperator(
  scope: OperatorScope,
  options: {
    store?: ProgressionStore;
    now?: () => Date;
    loadRows?: (tenantId: string) => Promise<PaidOrderRow[]>;
    force?: boolean;
    targetBuildingSlugs?: readonly string[];
  } = {}
): Promise<void> {
  const now = options.now ?? (() => new Date());
  const key = `${scope.tenantId}::${scope.operatorUserId}`;
  if (!options.force && now().getTime() - (lastSync.get(key) ?? 0) < SYNC_MIN_INTERVAL_MS) return;
  lastSync.set(key, now().getTime());
  try {
    const store = options.store ?? getProgressionStore();
    const rows = await (options.loadRows ?? loadPaidOrderRows)(scope.tenantId);
    for (const progress of derivePaidOrderProgress(rows, { targetBuildingSlugs: options.targetBuildingSlugs ?? [] })) {
      await recordProgressionEvidence(store, { ...scope, ...progress }, now);
    }
    await refreshProgression(store, scope, { disclosureSafetyOk: await loadDisclosureSafetyOk(scope), now });
  } catch (error) {
    console.warn("[Claire progression] sync failed; access unchanged", error instanceof Error ? error.message : error);
  }
}
