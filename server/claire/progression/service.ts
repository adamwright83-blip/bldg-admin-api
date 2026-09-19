import { evaluateProgression, type ProgressionGrant, EMPTY_GRANT } from "./evaluate";
import {
  validateEvidenceInput,
  progressStrength,
  type EvidenceCategory,
  type ProgressionEvidence,
} from "./evidence";
import { PROGRESSION_POLICY, type ProgressionPolicy } from "./policy";
import type { DisclosureEntitlement, OperatorScope, PersonalLedgerEntry, ProgressionStore, ReservationContext } from "./store";

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
 * Recompute from canonical evidence, persist the monotonic grant, and mint entitlements under the
 * NO-BACKLOG rule:
 *
 *  - Business results are preserved as evidence regardless; only entitlement MINTING is limited.
 *  - While the operator is below Rung 1, nothing mints and the watermark stays unset.
 *  - The first time the operator is eligible (Rung >= 1), AT MOST ONE prior qualifying progress
 *    event funds the initial entitlement (the most recently recognized). Older events never
 *    become a warehouse of retroactive reveals.
 *  - After that, each newly recognized qualifying event (recognizedAt after the watermark) mints
 *    at most one entitlement. Entitlements are unique per evidence row.
 *
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

  let toMint: ProgressionEvidence[] = [];
  let watermark = prior.entitlementWatermark;
  if (evaluation.grant.personalRung >= 1) {
    if (!watermark) {
      const newest = evaluation.qualifyingProgress[evaluation.qualifyingProgress.length - 1];
      toMint = newest ? [newest] : [];
    } else {
      toMint = evaluation.qualifyingProgress.filter(item => Date.parse(item.recognizedAt) > Date.parse(watermark!));
    }
    watermark = asOf.toISOString();
  }

  const grant = await store.upsertGrantMonotonic(scope, { ...evaluation.grant, entitlementWatermark: watermark });
  const minted: string[] = [];
  for (const item of toMint) {
    const { row, created } = await store.insertEntitlementIfAbsent({
      ...scope,
      evidenceId: item.id,
      status: "unused",
      mintedAt: asOf.toISOString(), // recognition-forward: never backdated
      reservedAt: null,
      reservationToken: null,
      reservation: null,
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

/** Phase 1 of a reveal: reserve one entitlement, durably recording everything needed to commit it later from any process. */
export async function reserveDisclosureEntitlement(
  store: ProgressionStore,
  entitlement: DisclosureEntitlement,
  context: ReservationContext,
  now: () => Date = () => new Date()
): Promise<{ token: string } | null> {
  const token = `res_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const ok = await store.reserveEntitlement({ id: entitlement.id, token, now: now().toISOString(), context });
  return ok ? { token } : null;
}

/**
 * Phase 2, at the delivery boundary: commit every reveal reserved for this conversation. Atomic per
 * reveal (consume + `disclosed` ledger row in one transaction). Idempotent, stateless in-process, and
 * safe to call from any replica or after a restart. Never throws mid-call.
 */
export async function commitPendingDisclosuresForConversation(
  store: ProgressionStore,
  input: { tenantId: string; conversationId: string },
  now: () => Date = () => new Date()
): Promise<number> {
  let committed = 0;
  try {
    for (const entitlement of await store.listReservedForConversation(input)) {
      if (!entitlement.reservationToken) continue;
      try {
        if (await store.commitReservedDisclosure({ entitlementId: entitlement.id, token: entitlement.reservationToken, now: now().toISOString() })) {
          committed += 1;
        }
      } catch (error) {
        // The reservation is untouched (transaction rolled back); its TTL returns it to unused.
        console.warn("[Claire progression] disclosure commit failed; reveal not consumed", error instanceof Error ? error.message : error);
      }
    }
  } catch (error) {
    console.warn("[Claire progression] could not list pending disclosures", error instanceof Error ? error.message : error);
  }
  return committed;
}

/** Compensation: a reveal that never reached the operator returns to unused. */
export async function abandonDisclosure(
  store: ProgressionStore,
  input: { entitlementId: string; token: string }
): Promise<boolean> {
  return store.releaseReservation({ id: input.entitlementId, token: input.token });
}
