/**
 * Promise ledger: things Claire told the operator she would have ready, prepared by the server so the
 * next call can read them (table claire_prepared_items). A promise with no row here is not spoken.
 */
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { clairePreparedItems } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isMysqlDuplicateKeyError } from "../../mysqlErrors";

export const PREPARED_PROPERTY_VISIT_CHOICE = "property_visit_choice";
export type PreparedItemKind = typeof PREPARED_PROPERTY_VISIT_CHOICE;

export type PropertyVisitChoicePayload = {
  targets: Array<{ name: string; address: string | null }>;
  remainingCount: number;
  totalCount: number;
};

export type PreparedItemRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  kind: PreparedItemKind;
  forBusinessDate: string;
  promiseText: string;
  payload: PropertyVisitChoicePayload;
  status: "prepared" | "consumed" | "expired";
  sourceConversationKey: string;
  consumedConversationKey: string | null;
  consumedAt: string | null;
  createdAt: string;
};

export type PreparedItemScope = { tenantId: string; canonicalOperatorId: string };

export interface PreparedItemStore {
  /** One item per (operator, kind, date). A second preparation for the same day refreshes the same row. */
  upsert(input: PreparedItemScope & {
    kind: PreparedItemKind;
    forBusinessDate: string;
    promiseText: string;
    payload: PropertyVisitChoicePayload;
    sourceConversationKey: string;
  }): Promise<PreparedItemRecord>;
  /** Prepared (not yet consumed) items due on or before `businessDate`, oldest first. Fresh read. */
  listDue(scope: PreparedItemScope, businessDate: string): Promise<PreparedItemRecord[]>;
  listRecent(scope: PreparedItemScope, limit: number): Promise<PreparedItemRecord[]>;
  markConsumed(scope: PreparedItemScope, ids: readonly string[], conversationKey: string): Promise<void>;
}

const itemId = (scope: PreparedItemScope, kind: string, date: string) =>
  `cprep_${createHash("sha256").update([scope.tenantId, scope.canonicalOperatorId, kind, date].join("\u0000")).digest("hex").slice(0, 48)}`;

type Row = typeof clairePreparedItems.$inferSelect;
function toRecord(row: Row): PreparedItemRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    kind: row.kind as PreparedItemKind,
    forBusinessDate: row.forBusinessDate,
    promiseText: row.promiseText,
    payload: row.payloadJson as PropertyVisitChoicePayload,
    status: (row.status as PreparedItemRecord["status"]) ?? "prepared",
    sourceConversationKey: row.sourceConversationKey,
    consumedConversationKey: row.consumedConversationKey ?? null,
    consumedAt: row.consumedAt ? row.consumedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function drizzlePreparedItemStore(): PreparedItemStore {
  const db = async () => {
    const handle = await getDb();
    if (!handle) throw new Error("Database unavailable");
    return handle;
  };
  const scopeWhere = (scope: PreparedItemScope) =>
    and(eq(clairePreparedItems.tenantId, scope.tenantId), eq(clairePreparedItems.canonicalOperatorId, scope.canonicalOperatorId));
  return {
    async upsert(input) {
      const handle = await db();
      const id = itemId(input, input.kind, input.forBusinessDate);
      const values = {
        id,
        tenantId: input.tenantId,
        canonicalOperatorId: input.canonicalOperatorId,
        kind: input.kind,
        forBusinessDate: input.forBusinessDate,
        promiseText: input.promiseText.slice(0, 1000),
        payloadJson: input.payload,
        status: "prepared" as const,
        sourceConversationKey: input.sourceConversationKey,
      };
      try {
        await handle.insert(clairePreparedItems).values(values);
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        // Refresh only while unconsumed: a consumed item is history.
        await handle
          .update(clairePreparedItems)
          .set({ payloadJson: input.payload, promiseText: values.promiseText })
          .where(and(eq(clairePreparedItems.id, id), eq(clairePreparedItems.status, "prepared")));
      }
      const [row] = await handle.select().from(clairePreparedItems).where(eq(clairePreparedItems.id, id)).limit(1);
      if (!row) throw new Error("Prepared item did not persist");
      return toRecord(row);
    },
    async listDue(scope, businessDate) {
      const rows = await (await db())
        .select()
        .from(clairePreparedItems)
        .where(and(scopeWhere(scope), eq(clairePreparedItems.status, "prepared")))
        .orderBy(asc(clairePreparedItems.forBusinessDate));
      return rows.map(toRecord).filter(item => item.forBusinessDate <= businessDate);
    },
    async listRecent(scope, limit) {
      const rows = await (await db())
        .select()
        .from(clairePreparedItems)
        .where(scopeWhere(scope))
        .orderBy(asc(clairePreparedItems.createdAt));
      return rows.map(toRecord).slice(-limit);
    },
    async markConsumed(scope, ids, conversationKey) {
      if (!ids.length) return;
      await (await db())
        .update(clairePreparedItems)
        .set({ status: "consumed", consumedAt: new Date(), consumedConversationKey: conversationKey })
        .where(and(scopeWhere(scope), inArray(clairePreparedItems.id, [...ids]), eq(clairePreparedItems.status, "prepared")));
    },
  };
}

export function inMemoryPreparedItemStore(): PreparedItemStore & { rows: PreparedItemRecord[] } {
  const rows: PreparedItemRecord[] = [];
  const inScope = (scope: PreparedItemScope) =>
    rows.filter(row => row.tenantId === scope.tenantId && row.canonicalOperatorId === scope.canonicalOperatorId);
  return {
    rows,
    async upsert(input) {
      const id = itemId(input, input.kind, input.forBusinessDate);
      const existing = rows.find(row => row.id === id);
      if (existing) {
        if (existing.status === "prepared") {
          existing.payload = input.payload;
          existing.promiseText = input.promiseText;
        }
        return { ...existing };
      }
      const record: PreparedItemRecord = {
        id,
        tenantId: input.tenantId,
        canonicalOperatorId: input.canonicalOperatorId,
        kind: input.kind,
        forBusinessDate: input.forBusinessDate,
        promiseText: input.promiseText,
        payload: input.payload,
        status: "prepared",
        sourceConversationKey: input.sourceConversationKey,
        consumedConversationKey: null,
        consumedAt: null,
        createdAt: new Date().toISOString(),
      };
      rows.push(record);
      return { ...record };
    },
    async listDue(scope, businessDate) {
      return inScope(scope)
        .filter(row => row.status === "prepared" && row.forBusinessDate <= businessDate)
        .sort((a, b) => a.forBusinessDate.localeCompare(b.forBusinessDate))
        .map(row => ({ ...row }));
    },
    async listRecent(scope, limit) {
      return inScope(scope).slice(-limit).map(row => ({ ...row }));
    },
    async markConsumed(scope, ids, conversationKey) {
      for (const row of inScope(scope)) {
        if (ids.includes(row.id) && row.status === "prepared") {
          row.status = "consumed";
          row.consumedConversationKey = conversationKey;
          row.consumedAt = new Date().toISOString();
        }
      }
    },
  };
}
