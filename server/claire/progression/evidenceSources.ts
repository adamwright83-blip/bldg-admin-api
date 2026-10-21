import { listCompletedCommercialFollowUpsForOperator } from "../../domains/commercial/commercialFollowUpReadService";
import { groupCustomerOrderTruth, loadCustomerOrderTruth, type CustomerOrderTruthRecord } from "../../geography/customerOrderTruth";
import { listClaireRelationshipEvents } from "../character/relationshipEvents";
import { evaluateDisclosureSafetyOk } from "../character/tierEngine";
import { deriveProgressFromOrderTruth } from "./paidOrderProgress";
import { recordProgressionEvidence, refreshProgression } from "./service";
import type { OperatorScope, ProgressionStore } from "./store";
import { getProgressionStore } from "./drizzleStore";
import { getDay1TenDoorsMissionReadOnly, listDay1TenDoorsDriverIds } from "../../openChannel/day1TenDoorsService";
import { listCommercialVisitOutcomesCreditedTo } from "../../commercialMissions/commercialMissionFieldService";
import type { Day1TenDoorsPayload } from "../../../shared/day1TenDoors";
import type { Day1EvidencePayloadExtension } from "../../../shared/day1Evidence";
import { deriveCommercialVisitEvidence, deriveDay1VisitEvidence, type CommercialVisitOutcomeRow, type DerivedEvidence } from "./fieldEvidence";
import type { BackfillCandidate, BackfillSources } from "./backfill";

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
  return listCompletedCommercialFollowUpsForOperator({
    tenantId: scope.tenantId,
    operatorUserId: scope.operatorUserId,
  });
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

// ---------------------------------------------------------------------------------------------
// Field-effort feeds (W4, 2026-10-21). Every field writer now reaches progression, and every feed
// credits the CANONICAL operator so a legacy login id (driver-primary, a numeric id) cannot split it.
// ---------------------------------------------------------------------------------------------

/**
 * The operator scope progression credits. A login alias that the persistent-operator identity layer
 * binds to a canonical operator is credited to that operator; an unresolved id stays as it is
 * (never guessed, never merged by name).
 */
export async function canonicalProgressionOperator(tenantId: string, openId: string): Promise<string> {
  try {
    const { resolveCanonicalOperatorIdentity } = await import("../../agents/persistentOperator/identity");
    const resolved = await resolveCanonicalOperatorIdentity({
      tenantId,
      source: { type: "open_id", value: openId },
      subsystem: "claire.progression",
    });
    return resolved.ok ? resolved.identity.canonicalOpenId : openId;
  } catch {
    return openId;
  }
}

async function recordDerived(
  store: ProgressionStore,
  scope: OperatorScope,
  evidence: readonly DerivedEvidence[],
  now: () => Date
): Promise<number> {
  let created = 0;
  for (const item of evidence) {
    const result = await recordProgressionEvidence(store, { ...scope, ...item }, now);
    if (result.ok && result.created) created += 1;
  }
  return created;
}

/**
 * A Day 1 Ten Doors outcome was just committed by the operator's explicit tap. Credit the visit
 * (see deriveDay1VisitEvidence for what counts), then sync order truth and refresh, in that order
 * (same reason as recordConfirmedVisitEvidence: the cursor must not pass an earlier import).
 * Never throws: a progression failure must not fail the field tap.
 */
export async function creditDay1OutcomeProgression(
  input: { tenantId: string; driverId: string; payload: Day1TenDoorsPayload & Day1EvidencePayloadExtension },
  options: { store?: ProgressionStore; now?: () => Date; resolveOperator?: typeof canonicalProgressionOperator } = {}
): Promise<void> {
  try {
    const now = options.now ?? (() => new Date());
    const store = options.store ?? getProgressionStore();
    const operatorUserId = await (options.resolveOperator ?? canonicalProgressionOperator)(input.tenantId, input.driverId);
    if (!operatorUserId) return;
    const scope = { tenantId: input.tenantId, operatorUserId };
    const { evidence } = deriveDay1VisitEvidence({ payload: input.payload });
    if (!(await recordDerived(store, scope, evidence, now))) return;
    await syncProgressionForOperator(scope, { store, now, force: true });
  } catch (error) {
    console.warn("[Claire progression] Day 1 outcome credit failed", error instanceof Error ? error.message : error);
  }
}

/**
 * A commercial mission visit outcome was just persisted by its ONE writer (which requires a verified
 * arrival). Covers every caller: the Claire debrief call, the mission-linked debrief and the field UI.
 * Credit belongs to the assigned operator, matching the writer's own visit-score rule.
 */
export async function creditCommercialVisitProgression(
  input: { tenantId: string; missionId: number; operatorOpenId: string; outcome: string; recordedAt: Date },
  options: { store?: ProgressionStore; now?: () => Date; resolveOperator?: typeof canonicalProgressionOperator } = {}
): Promise<void> {
  try {
    const operatorUserId = await (options.resolveOperator ?? canonicalProgressionOperator)(input.tenantId, input.operatorOpenId);
    await recordConfirmedVisitEvidence(
      { tenantId: input.tenantId, operatorUserId, missionId: input.missionId, outcome: input.outcome, occurredAt: input.recordedAt },
      options.store,
      options.now
    );
  } catch (error) {
    console.warn("[Claire progression] commercial visit credit failed", error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------------------------
// Backfill source loaders (read-only).
// ---------------------------------------------------------------------------------------------

async function loadDay1Payloads(tenantId: string, driverId: string) {
  const mission = await getDay1TenDoorsMissionReadOnly({ tenantId, driverId });
  if (!mission) return [];
  const payload: Day1TenDoorsPayload & Day1EvidencePayloadExtension = {
    kind: "day1_ten_doors",
    targets: mission.targets,
    outcomes: mission.outcomes,
    evidenceEvents: mission.evidenceEvents,
    visitEvidence: mission.visitEvidence,
  };
  return [{ missionId: mission.missionId, payload }];
}

async function loadCommercialVisitOutcomes(tenantId: string, ids: readonly string[]): Promise<CommercialVisitOutcomeRow[]> {
  return listCommercialVisitOutcomesCreditedTo({ tenantId, operatorIds: ids });
}

/** Every authoritative source, re-derived for one operator and its aliases. Read-only. */
export async function loadProgressionBackfillSources(
  scope: OperatorScope,
  options: {
    aliases?: readonly string[];
    store?: ProgressionStore;
    /** Canonical order truth (native + CleanCloud, deduped). Defaults to the production loader. */
    loadTruth?: (tenantId: string) => Promise<CustomerOrderTruthRecord[]>;
  } = {}
): Promise<BackfillSources> {
  const store = options.store ?? getProgressionStore();
  const aliases = [...new Set((options.aliases ?? []).filter(id => id && id !== scope.operatorUserId))];
  const ids = [scope.operatorUserId, ...aliases];
  const candidates: BackfillCandidate[] = [];
  const skipped: BackfillSources["skipped"] = [];
  const originOf = (id: string) => (id === scope.operatorUserId ? "operator" : `alias:${id}`);

  for (const id of ids) {
    for (const { missionId, payload } of await loadDay1Payloads(scope.tenantId, id)) {
      const derived = deriveDay1VisitEvidence({ payload });
      candidates.push(...derived.evidence.map(item => ({ ...item, origin: `day1:${originOf(id)}:${missionId}` })));
      skipped.push(...derived.skipped.map(item => ({ ...item, origin: `day1:${originOf(id)}:${missionId}` })));
    }
    for (const followUp of await loadCompletedFollowUps({ tenantId: scope.tenantId, operatorUserId: id })) {
      candidates.push({
        category: "growth_action", kind: "follow_up_done", sourceType: "commercial_follow_up", sourceId: followUp.id,
        provenance: "commercial_follow_up_completed", occurredAt: followUp.completedAt, recognizedAt: followUp.completedAt,
        origin: `follow_up:${originOf(id)}`,
      });
    }
  }
  const commercial = deriveCommercialVisitEvidence(await loadCommercialVisitOutcomes(scope.tenantId, ids));
  candidates.push(...commercial.evidence.map(item => ({ ...item, origin: "commercial_visit_outcome" })));

  const truth = await (options.loadTruth ?? ((tenantId: string) => loadCustomerOrderTruth(tenantId)))(scope.tenantId);
  for (const progress of deriveProgressFromOrderTruth(groupCustomerOrderTruth(scope.tenantId, truth))) {
    candidates.push({ ...progress, origin: "customer_order_truth" });
  }

  const aliasHeldEvidence: BackfillSources["aliasHeldEvidence"] = [];
  for (const alias of aliases) {
    const rows = (await store.listEvidence({ tenantId: scope.tenantId, operatorUserId: alias })).length;
    if (rows) aliasHeldEvidence.push({ operatorUserId: alias, rows });
  }
  const unclaimedDay1DriverIds = (await listDay1TenDoorsDriverIds(scope.tenantId)).filter(id => !ids.includes(id));
  return { candidates, skipped, aliasHeldEvidence, unclaimedDay1DriverIds };
}
