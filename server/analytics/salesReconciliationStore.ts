import { and, eq } from "drizzle-orm";
import {
  mysqlTable,
  mysqlEnum,
  varchar,
  primaryKey,
  int,
  json,
} from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import type { ServiceLine } from "./businessLineage";

export const salesEconomicDecisions = mysqlTable(
  "sales_economic_decisions",
  {
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    keptEventKey: varchar("keptEventKey", { length: 128 }).notNull(),
    otherEventKey: varchar("otherEventKey", { length: 128 }).notNull(),
    decision: mysqlEnum("decision", ["same_sale", "distinct_sales"]).notNull(),
    evidenceReference: varchar("evidenceReference", { length: 255 }).notNull(),
  },
  table => [
    primaryKey({
      columns: [table.tenantId, table.keptEventKey, table.otherEventKey],
    }),
  ]
);
export const salesServiceAttribution = mysqlTable(
  "sales_service_attribution",
  {
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    eventKey: varchar("eventKey", { length: 128 }).notNull(),
    serviceLine: mysqlEnum("serviceLine", [
      "laundry_butler",
      "laundry_farm_core",
      "unresolved",
    ]).notNull(),
    evidenceReference: varchar("evidenceReference", { length: 255 }).notNull(),
  },
  table => [primaryKey({ columns: [table.tenantId, table.eventKey] })]
);

export const salesSourceRevisions = mysqlTable(
  "sales_source_revisions",
  {
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    orderId: varchar("orderId", { length: 128 }).notNull(),
    reportType: mysqlEnum("reportType", [
      "orders_sales",
      "orders_revenue",
    ]).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    importBatchId: int("importBatchId").notNull(),
    amounts: json("amounts").notNull(),
    dates: json("dates").notNull(),
  },
  table => [
    primaryKey({
      columns: [
        table.tenantId,
        table.orderId,
        table.reportType,
        table.fingerprint,
      ],
    }),
  ]
);

export type SalesReconciliationEvidence = {
  decisions: Array<{
    keptEventKey: string;
    otherEventKey: string;
    decision: "same_sale" | "distinct_sales";
    evidenceReference: string;
  }>;
  attributions: Array<{
    eventKey: string;
    serviceLine: ServiceLine;
    evidenceReference: string;
  }>;
};

export async function loadSalesReconciliationEvidence(
  tenantId: string
): Promise<SalesReconciliationEvidence> {
  const db = await getDb();
  if (!db) throw new Error("Sales reconciliation database unavailable");
  const [decisions, attributions] = await Promise.all([
    db
      .select()
      .from(salesEconomicDecisions)
      .where(eq(salesEconomicDecisions.tenantId, tenantId)),
    db
      .select()
      .from(salesServiceAttribution)
      .where(eq(salesServiceAttribution.tenantId, tenantId)),
  ]);
  return { decisions, attributions };
}

/** Internal write seam. Promotion requires an authoritative non-PII evidence reference. */
export async function recordEconomicDecision(input: {
  tenantId: string;
  keptEventKey: string;
  otherEventKey: string;
  decision: "same_sale" | "distinct_sales";
  evidenceReference: string;
}) {
  if (
    !input.evidenceReference.trim() ||
    input.keptEventKey === input.otherEventKey
  )
    throw new Error("Distinct event keys and authoritative evidence required");
  const db = await getDb();
  if (!db) throw new Error("Sales reconciliation database unavailable");
  await db
    .insert(salesEconomicDecisions)
    .values(input)
    .onDuplicateKeyUpdate({
      set: {
        decision: input.decision,
        evidenceReference: input.evidenceReference,
      },
    });
}

export async function recordServiceAttribution(input: {
  tenantId: string;
  eventKey: string;
  serviceLine: ServiceLine;
  evidenceReference: string;
}) {
  if (!input.evidenceReference.trim())
    throw new Error("Positive service-line evidence required");
  const db = await getDb();
  if (!db) throw new Error("Sales reconciliation database unavailable");
  await db
    .insert(salesServiceAttribution)
    .values(input)
    .onDuplicateKeyUpdate({
      set: {
        serviceLine: input.serviceLine,
        evidenceReference: input.evidenceReference,
      },
    });
}
