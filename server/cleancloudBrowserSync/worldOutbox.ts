import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { int, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import type { InsertCleancloudPaidOrder } from "../../drizzle/schema";
import { getDb } from "../db";
import { customerIdentityHash } from "../customerAssets/customerIdentity";
import { appendGoldlineWorldEvent, type AppendGoldlineWorldEvent } from "../goldlineWorld/worldEventStore";

export const economicHeads = mysqlTable("goldline_cleancloud_economic_heads", {
  economicKey: varchar("economicKey", { length: 64 }).primaryKey(),
  revision: int("revision").notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
});
export const economicOutbox = mysqlTable("goldline_cleancloud_outbox", {
  id: varchar("id", { length: 80 }).primaryKey(),
  payload: json("payload").$type<AppendGoldlineWorldEvent>().notNull(),
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export type EconomicRevisionFields = {
  economicKey: string;
  paid: boolean;
  amountCents: number;
  paymentAt: string | null;
  buildingSlug: string | null;
  physicalEntityId: string | null;
};

/** Descriptive only. Null means no trustworthy identity — never a shared fake hash. */
export function descriptiveCustomerIdentityHash(
  tenantId: string,
  row: Pick<
    InsertCleancloudPaidOrder,
    | "customerPhone"
    | "customerEmail"
    | "customerName"
    | "address"
    | "cleancloudCustomerId"
  >
): string | null {
  return customerIdentityHash(tenantId, {
    phone: row.customerPhone,
    email: row.customerEmail,
    firstName: row.customerName,
    address: row.address,
    cleancloudCustomerId: row.cleancloudCustomerId,
    allowNameComposite: false,
  });
}

export function economicRevisionFields(
  row: InsertCleancloudPaidOrder,
  physicalEntityId: string | null = null
): EconomicRevisionFields {
  const tenantId = row.tenantId ?? "default";
  const paymentDate = row.paymentDateUtc ?? row.paidDateUtc;
  return {
    economicKey: hash(JSON.stringify([tenantId, "cleancloud", row.cleancloudOrderId])),
    paid: Boolean(row.paid),
    amountCents: row.totalCents ?? 0,
    paymentAt:
      paymentDate && Number.isFinite(paymentDate.getTime())
        ? paymentDate.toISOString()
        : null,
    buildingSlug:
      row.buildingResolutionStatus === "resolved" ? row.buildingSlug ?? null : null,
    physicalEntityId,
  };
}

export function economicRevisionFingerprint(
  row: InsertCleancloudPaidOrder,
  physicalEntityId: string | null = null
): string {
  return hash(JSON.stringify(economicRevisionFields(row, physicalEntityId)));
}

/** A replacement snapshot, never an additive second payment. Report identity
 * is excluded from the economic key: Sales and Revenue describe one order.
 * Customer identity is metadata only and must not gate economic revisions. */
export function economicSnapshot(row: InsertCleancloudPaidOrder) {
  const tenantId = row.tenantId ?? "default";
  const { physicalEntityId: _physicalEntityId, ...revision } =
    economicRevisionFields(row);
  return {
    ...revision,
    customerIdentityHash: descriptiveCustomerIdentityHash(tenantId, row),
  };
}

/** Must be awaited inside the SAME transaction as the economic row write. */
export async function enqueueEconomicSnapshot(tx: Transaction, row: InsertCleancloudPaidOrder, physicalEntityId: string | null = null) {
  const snapshot = economicSnapshot(row);
  const fingerprint = economicRevisionFingerprint(row, physicalEntityId);
  await tx.insert(economicHeads).values({ economicKey: snapshot.economicKey, revision: 0, fingerprint: "" })
    .onDuplicateKeyUpdate({ set: { economicKey: snapshot.economicKey } });
  const [head] = await tx.select().from(economicHeads)
    .where(eq(economicHeads.economicKey, snapshot.economicKey)).for("update");
  if (head.fingerprint === fingerprint) return;
  if (head.revision === 0 && (!snapshot.paid || !snapshot.paymentAt)) return;
  const revision = head.revision + 1;
  const id = `${snapshot.economicKey}:${revision}`;
  const payload: AppendGoldlineWorldEvent = {
    tenantId: row.tenantId ?? "default", physicalEntityId,
    eventType: revision === 1 ? "order_paid" : "order_payment_corrected",
    classification: "outcome", actorType: "system", actorId: null,
    // A correction with no payment date occurs when observed; paymentAt stays
    // null and downstream projections must revoke, not invent, dated revenue.
    occurredAt: snapshot.paymentAt ?? new Date().toISOString(), observedAt: new Date().toISOString(),
    sourceType: "gumball", sourceId: row.cleancloudOrderId,
    sourceEvidenceReference: `cleancloud-import:${row.importBatchId}:${row.cleancloudOrderId}`,
    provenanceClass: "existing_business_record", verificationClass: "VERIFIED", confidence: "high",
    idempotencyKey: `gumball:${id}`, correlationId: `cleancloud-import:${row.importBatchId}`,
    metadata: { ...snapshot, revision, supersedesRevision: revision > 1 ? revision - 1 : null,
      sourceReportType: row.sourceReportType, projectionMode: "replace" },
  };
  // Resolve before entering the import transaction at the caller where possible;
  // an unresolved binding is explicitly null, never a guessed physical ID.
  await tx.insert(economicOutbox).values({ id, payload });
  await tx.update(economicHeads).set({ revision, fingerprint })
    .where(eq(economicHeads.economicKey, snapshot.economicKey));
}

/** Publish and acknowledge separately. A crash between them safely republishes
 * the exact same idempotency key. Multiple drainers are harmless. */
export async function drainEconomicOutbox(limit = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db.select().from(economicOutbox).where(isNull(economicOutbox.publishedAt))
    .orderBy(economicOutbox.createdAt, economicOutbox.id).limit(limit);
  for (const row of rows) {
    await appendGoldlineWorldEvent(row.payload);
    await db.update(economicOutbox).set({ publishedAt: new Date() })
      .where(and(eq(economicOutbox.id, row.id), isNull(economicOutbox.publishedAt)));
  }
  return rows.length;
}

export function startEconomicOutboxDrainer() {
  let running = false;
  const drain = async () => {
    if (running) return;
    running = true;
    try { await drainEconomicOutbox(); }
    catch (error) { console.error("[gumball outbox] publication deferred", error); }
    finally { running = false; }
  };
  void drain();
  const timer = setInterval(() => void drain(), 5000);
  timer.unref();
  return () => clearInterval(timer);
}
