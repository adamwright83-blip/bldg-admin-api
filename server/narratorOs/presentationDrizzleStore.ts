import { and, eq } from "drizzle-orm";
import { narratorOsPresentationReceipt } from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type {
  NarratorPresentationStore,
  PlayerPresentationReceipt,
  PresentationReceiptStatus,
} from "./presentationStore";
import type { OperatorScope } from "./store";

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function fromRow(
  row: typeof narratorOsPresentationReceipt.$inferSelect
): PlayerPresentationReceipt {
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    occurrenceLedgerEntryId: row.occurrenceLedgerEntryId,
    beatId: row.beatId,
    presentationId: row.presentationId,
    status: row.status as PresentationReceiptStatus,
    preparedAt: iso(row.preparedAt) ?? new Date(0).toISOString(),
    renderedAt: iso(row.renderedAt),
    idempotencyKey: row.idempotencyKey,
  };
}

async function findRow(
  scope: OperatorScope,
  occurrenceLedgerEntryId: string
): Promise<PlayerPresentationReceipt | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(narratorOsPresentationReceipt)
    .where(
      and(
        eq(narratorOsPresentationReceipt.tenantId, scope.tenantId),
        eq(narratorOsPresentationReceipt.operatorUserId, scope.operatorUserId),
        eq(
          narratorOsPresentationReceipt.occurrenceLedgerEntryId,
          occurrenceLedgerEntryId
        )
      )
    )
    .limit(1);
  return rows[0] ? fromRow(rows[0]) : null;
}

export function createDrizzleNarratorPresentationStore(): NarratorPresentationStore {
  return {
    async loadForOperator(scope) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const rows = await db
        .select()
        .from(narratorOsPresentationReceipt)
        .where(
          and(
            eq(narratorOsPresentationReceipt.tenantId, scope.tenantId),
            eq(
              narratorOsPresentationReceipt.operatorUserId,
              scope.operatorUserId
            )
          )
        );
      return rows.map(fromRow);
    },
    findByOccurrence: findRow,
    async insertPrepared(receipt) {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      try {
        await db.insert(narratorOsPresentationReceipt).values({
          id: receipt.id,
          tenantId: receipt.tenantId,
          operatorUserId: receipt.operatorUserId,
          occurrenceLedgerEntryId: receipt.occurrenceLedgerEntryId,
          beatId: receipt.beatId,
          presentationId: receipt.presentationId,
          status: receipt.status,
          preparedAt: new Date(receipt.preparedAt),
          renderedAt: receipt.renderedAt ? new Date(receipt.renderedAt) : null,
          idempotencyKey: receipt.idempotencyKey,
        });
        return receipt;
      } catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        const existing = await findRow(
          {
            tenantId: receipt.tenantId,
            operatorUserId: receipt.operatorUserId,
          },
          receipt.occurrenceLedgerEntryId
        );
        if (!existing) throw error;
        return existing;
      }
    },
    async markRendered(input) {
      const current = await findRow(input.scope, input.occurrenceLedgerEntryId);
      if (!current) return null;
      if (current.status === "rendered_to_surface") return current;
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db
        .update(narratorOsPresentationReceipt)
        .set({
          status: "rendered_to_surface",
          renderedAt: new Date(input.renderedAt),
        })
        .where(eq(narratorOsPresentationReceipt.id, current.id));
      return {
        ...current,
        status: "rendered_to_surface",
        renderedAt: input.renderedAt,
      };
    },
  };
}
