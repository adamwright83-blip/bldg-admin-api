import { and, eq, isNotNull } from "drizzle-orm";
import { commercialFollowUps } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";
import { groupCustomerOrderTruth, loadCustomerOrderTruth, type CustomerOrderTruthRecord } from "../../geography/customerOrderTruth";
import { listClaireRelationshipEvents } from "../character/relationshipEvents";
import { evaluateDisclosureSafetyOk } from "../character/tierEngine";
import { deriveProgressFromOrderTruth } from "./paidOrderProgress";
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
  // Bring canonical order truth up to date BEFORE refreshing: an import recognized earlier than this
  // debrief must be evidenced first, or the entitlement cursor could advance past it.
  await syncProgressionForOperator(input, { store, now, force: true });
  await refreshProgression(store, input, { disclosureSafetyOk: await loadDisclosureSafetyOk(input), now });
}

export type CompletedFollowUp = { id: string; completedAt: Date };

/**
 * Persisted proof of a completed follow-up: `commercial_follow_ups` rows with status "completed", a
 * completion time, and the operator who completed them. Nothing a model or a chat said can appear here.
 */
export async function loadCompletedFollowUps(scope: OperatorScope): Promise<CompletedFollowUp[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({ id: commercialFollowUps.id, completedAt: commercialFollowUps.completedAt })
      .from(commercialFollowUps)
      .where(
        and(
          eq(commercialFollowUps.tenantId, scope.tenantId),
          eq(commercialFollowUps.status, "completed"),
          eq(commercialFollowUps.completedBy, scope.operatorUserId),
          isNotNull(commercialFollowUps.completedAt)
        )
      );
    return rows.flatMap(row => (row.completedAt ? [{ id: row.id, completedAt: row.completedAt }] : []));
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
    /** Canonical order truth (native + CleanCloud, deduped). Defaults to the production loader. */
    loadTruth?: (tenantId: string) => Promise<CustomerOrderTruthRecord[]>;
    /** Completed follow-ups for this operator. Defaults to the production loader. */
    loadFollowUps?: (scope: OperatorScope) => Promise<CompletedFollowUp[]>;
    force?: boolean;
  } = {}
): Promise<void> {
  const now = options.now ?? (() => new Date());
  const key = `${scope.tenantId}::${scope.operatorUserId}`;
  if (!options.force && now().getTime() - (lastSync.get(key) ?? 0) < SYNC_MIN_INTERVAL_MS) return;
  lastSync.set(key, now().getTime());
  const store = options.store ?? getProgressionStore();
  // Each source is independent: one failing (e.g. no database) must not hide the other.
  try {
    // Effort: completed follow-ups (recognized when the completion was persisted).
    for (const followUp of await (options.loadFollowUps ?? loadCompletedFollowUps)(scope)) {
      await recordProgressionEvidence(store, {
        ...scope, category: "growth_action", kind: "follow_up_done", sourceType: "commercial_follow_up",
        sourceId: followUp.id, provenance: "commercial_follow_up_completed",
        occurredAt: followUp.completedAt, recognizedAt: followUp.completedAt,
      }, now);
    }
  } catch (error) {
    console.warn("[Claire progression] follow-up effort sync failed", error instanceof Error ? error.message : error);
  }
  try {
    const records = await (options.loadTruth ?? ((tenantId: string) => loadCustomerOrderTruth(tenantId)))(scope.tenantId);
    const derived = deriveProgressFromOrderTruth(groupCustomerOrderTruth(scope.tenantId, records));
    // Skip source events we already hold (one order = one evidence identity), so a sync is cheap.
    const known = new Set((await store.listEvidence(scope)).filter(item => item.category === "business_progress").map(item => `${item.sourceType}:${item.sourceId}`));
    for (const progress of derived) {
      if (known.has(`${progress.sourceType}:${progress.sourceId}`)) continue;
      await recordProgressionEvidence(store, { ...scope, ...progress }, now);
    }
  } catch (error) {
    console.warn("[Claire progression] order-truth sync failed", error instanceof Error ? error.message : error);
  }
  try {
    await refreshProgression(store, scope, { disclosureSafetyOk: await loadDisclosureSafetyOk(scope), now });
  } catch (error) {
    console.warn("[Claire progression] sync failed; access unchanged", error instanceof Error ? error.message : error);
  }
}
