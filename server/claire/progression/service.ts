import { evaluateProgression, type ProgressionGrant, EMPTY_GRANT } from "./evaluate";
import {
  validateEvidenceInput,
  progressStrength,
  type EvidenceCategory,
  type ProgressionEvidence,
} from "./evidence";
import { PROGRESSION_POLICY, type ProgressionPolicy } from "./policy";
import { compareEntitlementCursor, formatEntitlementCursor } from "./store";
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

  // Deterministic order for cursor semantics: (recognizedAt, evidenceId).
  const ordered = [...evaluation.qualifyingProgress].sort((a, b) =>
    compareEntitlementCursor(formatEntitlementCursor(a.recognizedAt, a.id), formatEntitlementCursor(b.recognizedAt, b.id))
  );
  const cursorOf = (item: ProgressionEvidence) => formatEntitlementCursor(item.recognizedAt, item.id);
  let toMint: ProgressionEvidence[] = [];
  let cursor = prior.entitlementCursor;
  if (evaluation.grant.personalRung >= 1) {
    if (!cursor) {
      // Initial funding: at most ONE prior event (the newest). The cursor is NOT moved until it exists.
      const newest = ordered[ordered.length - 1];
      toMint = newest ? [newest] : [];
    } else {
      toMint = ordered.filter(item => compareEntitlementCursor(cursorOf(item), cursor!) > 0);
    }
  }

  // Mint in order. The cursor advances ONLY past an event whose entitlement was created or already
  // exists; the first failure stops the run and leaves the cursor before that event so a retry mints it.
  const minted: string[] = [];
  let mintError: unknown = null;
  for (const item of toMint) {
    try {
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
      cursor = cursorOf(item);
    } catch (error) {
      mintError = error;
      break;
    }
  }
  // Initial funding with nothing to fund still needs a cursor so later events are "newly recognized".
  if (evaluation.grant.personalRung >= 1 && !cursor && toMint.length === 0) {
    cursor = formatEntitlementCursor(asOf.toISOString(), "");
  }

  const grant = await store.upsertGrantMonotonic(scope, { ...evaluation.grant, entitlementCursor: cursor });
  if (mintError) console.warn("[Claire progression] entitlement mint failed; cursor held for retry", mintError instanceof Error ? mintError.message : mintError);
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

/**
 * Continuity of personal asking, derived from the existing durable personal ledger (no new
 * persistence). PRESENTATION ONLY: it lets Claire acknowledge repeated asking naturally. It is
 * not a currency — it never earns rapport, never creates an entitlement, never moves the personal
 * rung, never creates canon, and never counts as business progress.
 */
export type TopicAskHistory = { askCount: number; refusalCount: number; lastAskedAt: string | null; lastRefusedAt: string | null };

export function deriveTopicHistory(ledger: PersonalLedgerEntry[]): Record<string, TopicAskHistory> {
  const history: Record<string, TopicAskHistory> = {};
  for (const row of ledger) {
    if (!row.topic) continue;
    const entry = (history[row.topic] ??= { askCount: 0, refusalCount: 0, lastAskedAt: null, lastRefusedAt: null });
    if (row.kind === "asked") {
      entry.askCount += 1;
      entry.lastAskedAt = row.occurredAt;
    } else if (row.kind === "refused" || row.kind === "decline_fallback") {
      entry.refusalCount += 1;
      entry.lastRefusedAt = row.occurredAt;
    }
  }
  return history;
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
  /** Per-topic ask/refusal history from the durable ledger. Presentation continuity only — not progression currency. */
  topicHistory: Record<string, TopicAskHistory>;
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
    topicHistory: deriveTopicHistory(ledger),
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
 * Phase 2, at the next-turn boundary: commit every reveal reserved for this conversation.
 * This is entitlement accounting, NOT proof the operator heard the TTS. Heard confirmation
 * lives on claire_conversation_turns.providerMetadataJson.heardConfirmed and stays false
 * unless a delivery signal exists.
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
