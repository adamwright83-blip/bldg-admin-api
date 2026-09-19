import { and, desc, eq, sql } from "drizzle-orm";
import {
  claireDisclosureEntitlements,
  clairePersonalLedger,
  claireProgressionEvidence,
  claireProgressionGrants,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";
import type { ProgressionGrant } from "./evaluate";
import type {
  DisclosureEntitlement,
  PersonalLedgerEntry,
  ProgressionStore,
  StoredEvidence,
} from "./store";

/**
 * Production store. Every method fails CLOSED when the database or a table is
 * unavailable: reads return empty/zero (no access), writes return "did not
 * happen" so callers never treat a lost write as a grant, an entitlement
 * consumption, or a disclosure. Atomicity of reserve/consume relies on
 * conditional UPDATE ... WHERE status = ... and the affected-row count.
 */

async function closed<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isMysqlMissingTableError(error)) return fallback;
    throw error;
  }
}

const affected = (result: unknown): number => {
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
};

const toEvidence = (row: typeof claireProgressionEvidence.$inferSelect): StoredEvidence => ({
  id: String(row.id),
  tenantId: row.tenantId,
  operatorUserId: row.operatorUserId,
  category: row.category as StoredEvidence["category"],
  kind: row.kind,
  strength: (row.strength as StoredEvidence["strength"]) ?? null,
  sourceType: row.sourceType,
  sourceId: row.sourceId,
  provenance: row.provenance,
  occurredAt: row.occurredAt.toISOString(),
  recognizedAt: row.recognizedAt.toISOString(),
});

const toEntitlement = (row: typeof claireDisclosureEntitlements.$inferSelect): DisclosureEntitlement => ({
  id: String(row.id),
  tenantId: row.tenantId,
  operatorUserId: row.operatorUserId,
  evidenceId: String(row.evidenceId),
  status: row.status as DisclosureEntitlement["status"],
  mintedAt: row.mintedAt.toISOString(),
  reservedAt: row.reservedAt?.toISOString() ?? null,
  reservationToken: row.reservationToken ?? null,
  consumedAt: row.consumedAt?.toISOString() ?? null,
  consumedFragmentId: row.consumedFragmentId ?? null,
  consumedConversationId: row.consumedConversationId ?? null,
});

const toLedger = (row: typeof clairePersonalLedger.$inferSelect): PersonalLedgerEntry => ({
  id: String(row.id),
  tenantId: row.tenantId,
  operatorUserId: row.operatorUserId,
  conversationId: row.conversationId,
  kind: row.kind as PersonalLedgerEntry["kind"],
  topic: row.topic ?? null,
  fragmentId: row.fragmentId ?? null,
  entitlementId: row.entitlementId == null ? null : String(row.entitlementId),
  rungAtTime: row.rungAtTime,
  rapportBandAtTime: row.rapportBandAtTime,
  declineId: row.declineId ?? null,
  failureReason: row.failureReason ?? null,
  hadUnusedEntitlement: row.hadUnusedEntitlement == null ? null : row.hadUnusedEntitlement === 1,
  failurePhase: (row.failurePhase as PersonalLedgerEntry["failurePhase"]) ?? null,
  occurredAt: row.occurredAt.toISOString(),
});

export function createDrizzleProgressionStore(): ProgressionStore {
  return {
    kind: "drizzle" as const,
    async insertEvidence(input) {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      const where = and(
        eq(claireProgressionEvidence.tenantId, input.tenantId),
        eq(claireProgressionEvidence.operatorUserId, input.operatorUserId),
        eq(claireProgressionEvidence.category, input.category),
        eq(claireProgressionEvidence.kind, input.kind),
        eq(claireProgressionEvidence.sourceType, input.sourceType),
        eq(claireProgressionEvidence.sourceId, input.sourceId)
      );
      const [existing] = await db.select().from(claireProgressionEvidence).where(where).limit(1);
      if (existing) return { row: toEvidence(existing), created: false };
      try {
        await db.insert(claireProgressionEvidence).values({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          category: input.category,
          kind: input.kind,
          strength: input.strength,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          provenance: input.provenance,
          occurredAt: new Date(input.occurredAt),
          recognizedAt: new Date(input.recognizedAt),
        });
      } catch (error) {
        // A concurrent writer won the unique key: that is the same idempotent outcome.
        const [raced] = await db.select().from(claireProgressionEvidence).where(where).limit(1);
        if (raced) return { row: toEvidence(raced), created: false };
        throw error;
      }
      const [row] = await db.select().from(claireProgressionEvidence).where(where).limit(1);
      return { row: toEvidence(row), created: true };
    },

    async listEvidence(scope) {
      const db = await getDb();
      if (!db) return [];
      return closed(async () => {
        const rows = await db
          .select()
          .from(claireProgressionEvidence)
          .where(and(eq(claireProgressionEvidence.tenantId, scope.tenantId), eq(claireProgressionEvidence.operatorUserId, scope.operatorUserId)));
        return rows.map(toEvidence);
      }, []);
    },

    async getGrant(scope) {
      const db = await getDb();
      if (!db) return null;
      return closed(async () => {
        const [row] = await db
          .select()
          .from(claireProgressionGrants)
          .where(and(eq(claireProgressionGrants.tenantId, scope.tenantId), eq(claireProgressionGrants.operatorUserId, scope.operatorUserId)))
          .limit(1);
        if (!row) return null;
        return {
          rapportBand: row.rapportBand as ProgressionGrant["rapportBand"],
          rapportPolicyVersion: row.rapportPolicyVersion ?? null,
          personalRung: row.personalRung as ProgressionGrant["personalRung"],
          rungPolicyVersion: row.rungPolicyVersion ?? null,
        } satisfies ProgressionGrant;
      }, null);
    },

    async upsertGrantMonotonic(scope, grant) {
      const db = await getDb();
      if (!db) return grant;
      const existing = await this.getGrant(scope);
      const merged: ProgressionGrant = existing
        ? {
            rapportBand: Math.max(existing.rapportBand, grant.rapportBand) as ProgressionGrant["rapportBand"],
            rapportPolicyVersion: grant.rapportBand > existing.rapportBand ? grant.rapportPolicyVersion : existing.rapportPolicyVersion,
            personalRung: Math.max(existing.personalRung, grant.personalRung) as ProgressionGrant["personalRung"],
            rungPolicyVersion: grant.personalRung > existing.personalRung ? grant.rungPolicyVersion : existing.rungPolicyVersion,
          }
        : grant;
      await closed(async () => {
        await db
          .insert(claireProgressionGrants)
          .values({ tenantId: scope.tenantId, operatorUserId: scope.operatorUserId, ...merged })
          .onDuplicateKeyUpdate({
            // GREATEST at the database: even a racing or stale writer can never lower a grant.
            // The version columns follow the component only when it actually rose.
            set: {
              rapportPolicyVersion: sql`IF(${merged.rapportBand} > rapportBand, ${merged.rapportPolicyVersion}, rapportPolicyVersion)`,
              rungPolicyVersion: sql`IF(${merged.personalRung} > personalRung, ${merged.rungPolicyVersion}, rungPolicyVersion)`,
              rapportBand: sql`GREATEST(rapportBand, ${merged.rapportBand})`,
              personalRung: sql`GREATEST(personalRung, ${merged.personalRung})`,
            },
          });
      }, undefined);
      return merged;
    },

    async insertEntitlementIfAbsent(input) {
      const db = await getDb();
      if (!db) throw new Error("database unavailable");
      const evidenceId = Number(input.evidenceId);
      const where = and(
        eq(claireDisclosureEntitlements.tenantId, input.tenantId),
        eq(claireDisclosureEntitlements.operatorUserId, input.operatorUserId),
        eq(claireDisclosureEntitlements.evidenceId, evidenceId)
      );
      const [existing] = await db.select().from(claireDisclosureEntitlements).where(where).limit(1);
      if (existing) return { row: toEntitlement(existing), created: false };
      try {
        await db.insert(claireDisclosureEntitlements).values({
          tenantId: input.tenantId,
          operatorUserId: input.operatorUserId,
          evidenceId,
          status: "unused",
          mintedAt: new Date(input.mintedAt),
        });
      } catch (error) {
        const [raced] = await db.select().from(claireDisclosureEntitlements).where(where).limit(1);
        if (raced) return { row: toEntitlement(raced), created: false };
        throw error;
      }
      const [row] = await db.select().from(claireDisclosureEntitlements).where(where).limit(1);
      return { row: toEntitlement(row), created: true };
    },

    async listEntitlements(scope) {
      const db = await getDb();
      if (!db) return [];
      return closed(async () => {
        const rows = await db
          .select()
          .from(claireDisclosureEntitlements)
          .where(and(eq(claireDisclosureEntitlements.tenantId, scope.tenantId), eq(claireDisclosureEntitlements.operatorUserId, scope.operatorUserId)));
        return rows.map(toEntitlement);
      }, []);
    },

    async reserveEntitlement({ id, token, now }) {
      const db = await getDb();
      if (!db) return false;
      return closed(async () => {
        const result = await db
          .update(claireDisclosureEntitlements)
          .set({ status: "reserved", reservedAt: new Date(now), reservationToken: token })
          .where(and(eq(claireDisclosureEntitlements.id, Number(id)), eq(claireDisclosureEntitlements.status, "unused")));
        return affected(result) === 1;
      }, false);
    },

    async consumeReservedEntitlement({ id, token, fragmentId, conversationId, now }) {
      const db = await getDb();
      if (!db) return false;
      return closed(async () => {
        const result = await db
          .update(claireDisclosureEntitlements)
          .set({ status: "consumed", consumedAt: new Date(now), consumedFragmentId: fragmentId, consumedConversationId: conversationId })
          .where(
            and(
              eq(claireDisclosureEntitlements.id, Number(id)),
              eq(claireDisclosureEntitlements.status, "reserved"),
              eq(claireDisclosureEntitlements.reservationToken, token)
            )
          );
        return affected(result) === 1;
      }, false);
    },

    async releaseReservation({ id, token }) {
      const db = await getDb();
      if (!db) return false;
      return closed(async () => {
        const conditions = [eq(claireDisclosureEntitlements.id, Number(id)), eq(claireDisclosureEntitlements.status, "reserved")];
        if (token) conditions.push(eq(claireDisclosureEntitlements.reservationToken, token));
        const result = await db
          .update(claireDisclosureEntitlements)
          .set({ status: "unused", reservedAt: null, reservationToken: null })
          .where(and(...conditions));
        return affected(result) === 1;
      }, false);
    },

    async appendLedger(entry) {
      const db = await getDb();
      const occurredAt = entry.occurredAt ?? new Date().toISOString();
      const fallback: PersonalLedgerEntry = { ...entry, id: "unpersisted", occurredAt };
      if (!db) return fallback;
      return closed(async () => {
        await db.insert(clairePersonalLedger).values({
          tenantId: entry.tenantId,
          operatorUserId: entry.operatorUserId,
          conversationId: entry.conversationId,
          kind: entry.kind,
          topic: entry.topic,
          fragmentId: entry.fragmentId,
          entitlementId: entry.entitlementId == null ? null : Number(entry.entitlementId),
          rungAtTime: entry.rungAtTime,
          rapportBandAtTime: entry.rapportBandAtTime,
          declineId: entry.declineId,
          failureReason: entry.failureReason,
          hadUnusedEntitlement: entry.hadUnusedEntitlement == null ? null : entry.hadUnusedEntitlement ? 1 : 0,
          failurePhase: entry.failurePhase,
          occurredAt: new Date(occurredAt),
        });
        return fallback;
      }, fallback);
    },

    async listLedger(scope, options) {
      const db = await getDb();
      if (!db) return [];
      return closed(async () => {
        const conditions = [eq(clairePersonalLedger.tenantId, scope.tenantId), eq(clairePersonalLedger.operatorUserId, scope.operatorUserId)];
        if (options?.conversationId) conditions.push(eq(clairePersonalLedger.conversationId, options.conversationId));
        const rows = await db.select().from(clairePersonalLedger).where(and(...conditions)).orderBy(clairePersonalLedger.id);
        return rows.map(toLedger);
      }, []);
    },

    async listDeclineFallbacks({ tenantId, limit }) {
      const db = await getDb();
      if (!db) return [];
      return closed(async () => {
        const rows = await db
          .select()
          .from(clairePersonalLedger)
          .where(and(eq(clairePersonalLedger.tenantId, tenantId), eq(clairePersonalLedger.kind, "decline_fallback")))
          .orderBy(desc(clairePersonalLedger.id))
          .limit(limit ?? 200);
        return rows.map(toLedger).reverse();
      }, []);
    },
    async listTenantLedger({ tenantId, limit }) {
      const db = await getDb();
      if (!db) return [];
      return closed(async () => {
        const rows = await db
          .select()
          .from(clairePersonalLedger)
          .where(eq(clairePersonalLedger.tenantId, tenantId))
          .orderBy(desc(clairePersonalLedger.id))
          .limit(limit ?? 2000);
        return rows.map(toLedger).reverse();
      }, []);
    },
  };
}

let shared: ProgressionStore | null = null;
/** The production store. Tests pass an explicit store instead. */
export function getProgressionStore(): ProgressionStore {
  if (!shared) shared = createDrizzleProgressionStore();
  return shared;
}
export function setProgressionStoreForTesting(store: ProgressionStore | null): void {
  shared = store;
}
