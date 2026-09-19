import { evaluateProgression, type ProgressionGrant, EMPTY_GRANT } from "./evaluate";
import {
  validateEvidenceInput,
  progressStrength,
  type EvidenceCategory,
  type ProgressionEvidence,
} from "./evidence";
import { PROGRESSION_POLICY, type ProgressionPolicy } from "./policy";
import type { DisclosureEntitlement, OperatorScope, PersonalLedgerEntry, ProgressionStore } from "./store";

/**
 * Progression service: the only writer of evidence, grants, entitlements.
 * Nothing here is callable by the model. Failures return null/no-op rather
 * than throwing mid-call, matching the relationship emitters' fail-closed rule.
 */

export type RecordEvidenceInput = OperatorScope & {
  category: EvidenceCategory;
  kind: string;
  sourceType: string;
  sourceId: string;
  provenance: string;
  occurredAt: Date | string;
  /** Defaults to now. Delayed imports must pass their real occurredAt and let recognizedAt be now. */
  recognizedAt?: Date | string;
};

export type RecordEvidenceResult =
  | { ok: true; evidence: ProgressionEvidence; created: boolean }
  | { ok: false; reason: string };

const iso = (value: Date | string) => (typeof value === "string" ? new Date(value) : value).toISOString();

export async function recordProgressionEvidence(
  store: ProgressionStore,
  input: RecordEvidenceInput,
  now: () => Date = () => new Date()
): Promise<RecordEvidenceResult> {
  if (!input.operatorUserId) return { ok: false, reason: "operator identity unresolved" };
  const occurredAt = iso(input.occurredAt);
  const recognizedAt = input.recognizedAt ? iso(input.recognizedAt) : now().toISOString();
  const validation = validateEvidenceInput({ category: input.category, kind: input.kind, occurredAt, recognizedAt });
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const { row, created } = await store.insertEvidence({
    id: "",
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    category: input.category,
    kind: input.kind,
    strength: input.category === "business_progress" ? progressStrength(input.kind) : null,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    provenance: input.provenance,
    occurredAt,
    recognizedAt,
  });
  return { ok: true, evidence: row, created };
}

export type ProgressionSnapshot = {
  grant: ProgressionGrant;
  counts: ReturnType<typeof evaluateProgression>["counts"];
  mintedEntitlementIds: string[];
};

/**
 * Recompute from canonical evidence, persist the monotonic grant, and mint at most
 * one entitlement per qualifying business-progress evidence row (unique on evidenceId).
 * Never reads call/chat volume. Never lowers a grant.
 */
export async function refreshProgression(
  store: ProgressionStore,
  scope: OperatorScope,
  options: { disclosureSafetyOk: boolean; now?: () => Date; policy?: ProgressionPolicy }
): Promise<ProgressionSnapshot> {
  const now = options.now ?? (() => new Date());
  const asOf = now();
  const evidence = await store.listEvidence(scope);
  const prior = (await store.getGrant(scope)) ?? EMPTY_GRANT;
  const evaluation = evaluateProgression({
    evidence,
    disclosureSafetyOk: options.disclosureSafetyOk,
    prior,
    asOf,
    policy: options.policy ?? PROGRESSION_POLICY,
  });
  const grant = await store.upsertGrantMonotonic(scope, evaluation.grant);
  const minted: string[] = [];
  for (const evidenceId of evaluation.entitlementEligibleEvidenceIds) {
    const { row, created } = await store.insertEntitlementIfAbsent({
      ...scope,
      evidenceId,
      status: "unused",
      mintedAt: asOf.toISOString(), // recognition-forward: never backdated
      reservedAt: null,
      reservationToken: null,
      consumedAt: null,
      consumedFragmentId: null,
      consumedConversationId: null,
    });
    if (created) minted.push(row.id);
  }
  return { grant, counts: evaluation.counts, mintedEntitlementIds: minted };
}

/** Lazily returns expired reservations to "unused" so a lost delivery never burns a reveal. */
export async function releaseExpiredReservations(
  store: ProgressionStore,
  scope: OperatorScope,
  now: Date,
  ttlMs = PROGRESSION_POLICY.entitlementReservationTtlMs
): Promise<number> {
  let released = 0;
  for (const entitlement of await store.listEntitlements(scope)) {
    if (
      entitlement.status === "reserved" &&
      entitlement.reservedAt &&
      now.getTime() - Date.parse(entitlement.reservedAt) > ttlMs
    ) {
      if (await store.releaseReservation({ id: entitlement.id, token: entitlement.reservationToken ?? undefined })) {
        released += 1;
      }
    }
  }
  return released;
}

export type PersonalProgressionContext = {
  scope: OperatorScope;
  grant: ProgressionGrant;
  unusedEntitlement: DisclosureEntitlement | null;
  unusedEntitlementCount: number;
  consumedEntitlementCount: number;
  disclosedFragmentIds: string[];
  /** Topics the operator previously asked about and was refused (game-state continuity). */
  priorRefusedTopics: string[];
  conversationLedger: PersonalLedgerEntry[];
};

export async function loadPersonalProgressionContext(
  store: ProgressionStore,
  scope: OperatorScope,
  conversationId: string,
  now: () => Date = () => new Date()
): Promise<PersonalProgressionContext> {
  await releaseExpiredReservations(store, scope, now());
  const [grant, entitlements, ledger] = await Promise.all([
    store.getGrant(scope),
    store.listEntitlements(scope),
    store.listLedger(scope),
  ]);
  const unused = entitlements.filter(row => row.status === "unused");
  return {
    scope,
    grant: grant ?? EMPTY_GRANT,
    unusedEntitlement: unused[0] ?? null,
    unusedEntitlementCount: unused.length,
    consumedEntitlementCount: entitlements.filter(row => row.status === "consumed").length,
    disclosedFragmentIds: [...new Set(ledger.filter(row => row.kind === "disclosed" && row.fragmentId).map(row => row.fragmentId!))],
    priorRefusedTopics: [...new Set(ledger.filter(row => (row.kind === "refused" || row.kind === "decline_fallback") && row.topic).map(row => row.topic!))],
    conversationLedger: ledger.filter(row => row.conversationId === conversationId),
  };
}

/** Phase 1 of a reveal: reserve one entitlement. Nothing is disclosed or consumed yet. */
export async function reserveDisclosureEntitlement(
  store: ProgressionStore,
  entitlement: DisclosureEntitlement,
  now: () => Date = () => new Date()
): Promise<{ token: string } | null> {
  const token = `res_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const ok = await store.reserveEntitlement({ id: entitlement.id, token, now: now().toISOString() });
  return ok ? { token } : null;
}

/**
 * Phase 2: only after the validated answer actually cleared the delivery
 * boundary. Marks the fragment disclosed (ledger) and consumes the entitlement.
 */
export async function commitDisclosure(
  store: ProgressionStore,
  input: {
    scope: OperatorScope;
    conversationId: string;
    entitlementId: string;
    token: string;
    fragmentId: string;
    topic: string;
    rung: number;
    rapportBand: number;
  },
  now: () => Date = () => new Date()
): Promise<boolean> {
  const consumed = await store.consumeReservedEntitlement({
    id: input.entitlementId,
    token: input.token,
    fragmentId: input.fragmentId,
    conversationId: input.conversationId,
    now: now().toISOString(),
  });
  if (!consumed) return false;
  await store.appendLedger({
    ...input.scope,
    conversationId: input.conversationId,
    kind: "disclosed",
    topic: input.topic,
    fragmentId: input.fragmentId,
    entitlementId: input.entitlementId,
    rungAtTime: input.rung,
    rapportBandAtTime: input.rapportBand,
    declineId: null,
    failureReason: null,
    hadUnusedEntitlement: null,
    failurePhase: null,
  });
  return true;
}

/** Compensation: a reveal that never reached the operator returns to unused. */
export async function abandonDisclosure(
  store: ProgressionStore,
  input: { entitlementId: string; token: string }
): Promise<boolean> {
  return store.releaseReservation({ id: input.entitlementId, token: input.token });
}
