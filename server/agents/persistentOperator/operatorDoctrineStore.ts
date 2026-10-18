import { and, eq } from "drizzle-orm";
import { json, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import {
  DEFAULT_DOCTRINE,
  type DoctrineRules,
} from "../../../shared/claireProactive";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";

const operatorDoctrine = mysqlTable(
  "claire_operator_doctrine",
  {
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    operatorUserId: varchar("operatorUserId", { length: 128 }).notNull(),
    rulesJson: json("rulesJson").notNull(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow().onUpdateNow(),
  },
  table => ({
    pk: uniqueIndex("uq_claire_operator_doctrine").on(
      table.tenantId,
      table.operatorUserId
    ),
  })
);

/**
 * Persistent Operator owns durable operator doctrine. Claire may interpret an
 * utterance into doctrine changes, but persistence remains outside Claire.
 */
export async function loadOperatorDoctrine(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<DoctrineRules> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId) throw new Error("tenantId is required");
  if (!operatorUserId) throw new Error("operator identity is required");

  const db = await getDb();
  if (!db) return DEFAULT_DOCTRINE;

  try {
    const [row] = await db
      .select()
      .from(operatorDoctrine)
      .where(
        and(
          eq(operatorDoctrine.tenantId, tenantId),
          eq(operatorDoctrine.operatorUserId, operatorUserId)
        )
      )
      .limit(1);
    return row?.rulesJson
      ? { ...DEFAULT_DOCTRINE, ...(row.rulesJson as DoctrineRules) }
      : DEFAULT_DOCTRINE;
  } catch (error) {
    if (isMysqlMissingTableError(error)) return DEFAULT_DOCTRINE;
    throw error;
  }
}

export type OperatorSalesHold = { until: string; reason: string | null };

/**
 * The operator's "no sales today" hold, or null. Claire saves doctrine under
 * the open id the operator spoke from (an alias, or the canonical id on a
 * scheduled call), so every open id of the operator is read; the latest hold
 * wins. Day Director actor ids are another identity space and never match.
 */
export async function loadOperatorSalesHold(input: {
  tenantId: string;
  operatorUserIds: readonly string[];
}): Promise<OperatorSalesHold | null> {
  let hold: OperatorSalesHold | null = null;
  for (const operatorUserId of [...new Set(input.operatorUserIds.map(id => id.trim()).filter(Boolean))]) {
    const rules = await loadOperatorDoctrine({ tenantId: input.tenantId, operatorUserId });
    if (rules.skipSalesUntil && (!hold || rules.skipSalesUntil > hold.until))
      hold = { until: rules.skipSalesUntil, reason: rules.skipSalesReason ?? null };
  }
  return hold;
}

export async function saveOperatorDoctrine(input: {
  tenantId: string;
  operatorUserId: string;
  rules: DoctrineRules;
}): Promise<void> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId) throw new Error("tenantId is required");
  if (!operatorUserId) throw new Error("operator identity is required");

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .insert(operatorDoctrine)
    .values({
      tenantId,
      operatorUserId,
      rulesJson: input.rules,
    })
    .onDuplicateKeyUpdate({ set: { rulesJson: input.rules } });
}
