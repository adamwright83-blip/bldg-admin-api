import type { ProgressionEvidence } from "./evidence";
import type { ProgressionGrant } from "./evaluate";

/**
 * Persistence seam for the progression layer. Production: drizzleStore.ts.
 * Tests and the simulator: createInMemoryProgressionStore(). The simulator may
 * ONLY ever be given an in-memory store (see simulator.ts).
 */

export type OperatorScope = { tenantId: string; operatorUserId: string };

export type StoredEvidence = ProgressionEvidence & OperatorScope;

export type EntitlementStatus = "unused" | "reserved" | "consumed";

export type DisclosureEntitlement = OperatorScope & {
  id: string;
  /** The single business-progress evidence row that minted this entitlement. Unique. */
  evidenceId: string;
  status: EntitlementStatus;
  mintedAt: string;
  reservedAt: string | null;
  reservationToken: string | null;
  consumedAt: string | null;
  consumedFragmentId: string | null;
  consumedConversationId: string | null;
};

export type PersonalLedgerKind =
  | "asked"
  | "refused"
  | "disclosed"
  | "followup_answered"
  | "thread_closed"
  | "decline_fallback";

/**
 * Durable record of the personal conversation between operator and Claire:
 * prior questions, refusals, disclosures, closed threads, decline fallbacks.
 * This is game state (Claire is a hidden discovery game). It is also the
 * extension seam a future Narrative OS builds on: append-only, keyed by
 * operator, carrying topic + fragment ids + the rung/band at the time.
 */
export type PersonalLedgerEntry = OperatorScope & {
  id: string;
  conversationId: string;
  kind: PersonalLedgerKind;
  topic: string | null;
  fragmentId: string | null;
  entitlementId: string | null;
  rungAtTime: number;
  rapportBandAtTime: number;
  declineId: string | null;
  failureReason: string | null;
  hadUnusedEntitlement: boolean | null;
  /** For decline fallbacks: did the failure occur before or after generation validation? */
  failurePhase: "pre_generation" | "post_validation" | null;
  occurredAt: string;
};

export type NewPersonalLedgerEntry = Omit<PersonalLedgerEntry, "id" | "occurredAt"> & { occurredAt?: string };

export type ProgressionStore = {
  /** Distinguishes ephemeral stores from the production database. The simulator accepts only "in_memory". */
  readonly kind: "in_memory" | "drizzle";
  /** Idempotent on (operator, category, kind, sourceType, sourceId). Returns the stored row either way. */
  insertEvidence(input: StoredEvidence): Promise<{ row: StoredEvidence; created: boolean }>;
  listEvidence(scope: OperatorScope): Promise<StoredEvidence[]>;
  getGrant(scope: OperatorScope): Promise<ProgressionGrant | null>;
  /** Must itself refuse to lower any component (defense in depth beyond evaluate.ts). */
  upsertGrantMonotonic(scope: OperatorScope, grant: ProgressionGrant): Promise<ProgressionGrant>;
  /** Idempotent on evidenceId. */
  insertEntitlementIfAbsent(input: Omit<DisclosureEntitlement, "id">): Promise<{ row: DisclosureEntitlement; created: boolean }>;
  listEntitlements(scope: OperatorScope): Promise<DisclosureEntitlement[]>;
  /** Atomic: only succeeds when status is currently "unused". */
  reserveEntitlement(input: { id: string; token: string; now: string }): Promise<boolean>;
  /** Atomic: only succeeds when status is "reserved" with this token. */
  consumeReservedEntitlement(input: {
    id: string;
    token: string;
    fragmentId: string;
    conversationId: string;
    now: string;
  }): Promise<boolean>;
  /** Returns a reservation to "unused" (compensation, or TTL expiry). No-op unless "reserved". */
  releaseReservation(input: { id: string; token?: string }): Promise<boolean>;
  appendLedger(entry: NewPersonalLedgerEntry): Promise<PersonalLedgerEntry>;
  listLedger(scope: OperatorScope, options?: { conversationId?: string }): Promise<PersonalLedgerEntry[]>;
  /** Admin telemetry across operators for a tenant. */
  listDeclineFallbacks(input: { tenantId: string; limit?: number }): Promise<PersonalLedgerEntry[]>;
  /** All personal-ledger rows for a tenant (asked/answered/declined), for fallback-rate denominators. */
  listTenantLedger(input: { tenantId: string; limit?: number }): Promise<PersonalLedgerEntry[]>;
};

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(counter += 1).toString(36)}`;

const scopeKey = (scope: OperatorScope) => `${scope.tenantId}::${scope.operatorUserId}`;
const evidenceKey = (row: ProgressionEvidence & OperatorScope) =>
  `${scopeKey(row)}::${row.category}::${row.kind}::${row.sourceType}::${row.sourceId}`;

export function createInMemoryProgressionStore(): ProgressionStore {
  const evidence = new Map<string, StoredEvidence>();
  const grants = new Map<string, ProgressionGrant>();
  const entitlements = new Map<string, DisclosureEntitlement>();
  const ledger: PersonalLedgerEntry[] = [];

  return {
    kind: "in_memory" as const,
    async insertEvidence(input) {
      const key = evidenceKey(input);
      const existing = evidence.get(key);
      if (existing) return { row: existing, created: false };
      const row = { ...input, id: input.id || nextId("ev") };
      evidence.set(key, row);
      return { row, created: true };
    },
    async listEvidence(scope) {
      return [...evidence.values()].filter(row => scopeKey(row) === scopeKey(scope));
    },
    async getGrant(scope) {
      return grants.get(scopeKey(scope)) ?? null;
    },
    async upsertGrantMonotonic(scope, grant) {
      const prior = grants.get(scopeKey(scope));
      const merged: ProgressionGrant = prior
        ? {
            rapportBand: Math.max(prior.rapportBand, grant.rapportBand) as ProgressionGrant["rapportBand"],
            rapportPolicyVersion:
              grant.rapportBand > prior.rapportBand ? grant.rapportPolicyVersion : prior.rapportPolicyVersion,
            personalRung: Math.max(prior.personalRung, grant.personalRung) as ProgressionGrant["personalRung"],
            rungPolicyVersion:
              grant.personalRung > prior.personalRung ? grant.rungPolicyVersion : prior.rungPolicyVersion,
          }
        : grant;
      grants.set(scopeKey(scope), merged);
      return merged;
    },
    async insertEntitlementIfAbsent(input) {
      const existing = [...entitlements.values()].find(
        row => scopeKey(row) === scopeKey(input) && row.evidenceId === input.evidenceId
      );
      if (existing) return { row: existing, created: false };
      const row: DisclosureEntitlement = { ...input, id: nextId("ent") };
      entitlements.set(row.id, row);
      return { row, created: true };
    },
    async listEntitlements(scope) {
      return [...entitlements.values()].filter(row => scopeKey(row) === scopeKey(scope));
    },
    async reserveEntitlement({ id, token, now }) {
      const row = entitlements.get(id);
      if (!row || row.status !== "unused") return false;
      entitlements.set(id, { ...row, status: "reserved", reservedAt: now, reservationToken: token });
      return true;
    },
    async consumeReservedEntitlement({ id, token, fragmentId, conversationId, now }) {
      const row = entitlements.get(id);
      if (!row || row.status !== "reserved" || row.reservationToken !== token) return false;
      entitlements.set(id, {
        ...row,
        status: "consumed",
        consumedAt: now,
        consumedFragmentId: fragmentId,
        consumedConversationId: conversationId,
      });
      return true;
    },
    async releaseReservation({ id, token }) {
      const row = entitlements.get(id);
      if (!row || row.status !== "reserved") return false;
      if (token && row.reservationToken !== token) return false;
      entitlements.set(id, { ...row, status: "unused", reservedAt: null, reservationToken: null });
      return true;
    },
    async appendLedger(entry) {
      const row: PersonalLedgerEntry = {
        ...entry,
        id: nextId("led"),
        occurredAt: entry.occurredAt ?? new Date().toISOString(),
      };
      ledger.push(row);
      return row;
    },
    async listLedger(scope, options) {
      return ledger.filter(
        row =>
          scopeKey(row) === scopeKey(scope) &&
          (!options?.conversationId || row.conversationId === options.conversationId)
      );
    },
    async listDeclineFallbacks({ tenantId, limit }) {
      return ledger
        .filter(row => row.tenantId === tenantId && row.kind === "decline_fallback")
        .slice(-(limit ?? 200));
    },
    async listTenantLedger({ tenantId, limit }) {
      return ledger.filter(row => row.tenantId === tenantId).slice(-(limit ?? 2000));
    },
  };
}
