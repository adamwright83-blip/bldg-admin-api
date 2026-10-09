import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { int, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import type { InsertCleancloudPaidOrder } from "../../../../drizzle/schema";
import { getDb } from "../../../db";
import { customerIdentityHash } from "../../../customerAssets/customerIdentity";
import { appendGoldlineWorldEvent, type AppendGoldlineWorldEvent } from "../../../experience/goldline/world/worldEventStore";
import {
  admitCleanCloudPaidObservationWith,
  requireCleanCloudTenantId,
} from "../cleancloudPaidEvidence";

export const economicHeads = mysqlTable("goldline_cleancloud_economic_heads", {
  economicKey: varchar("economicKey", { length: 64 }).primaryKey(),
  revision: int("revision").notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
});
export const economicOutbox = mysqlTable("goldline_cleancloud_outbox", {
  id: varchar("id", { length: 80 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  payload: json("payload").$type<AppendGoldlineWorldEvent>().notNull(),
  leaseOwner: varchar("leaseOwner", { length: 128 }),
  leaseExpiresAt: timestamp("leaseExpiresAt", { fsp: 3 }),
  attemptCount: int("attemptCount").default(0).notNull(),
  lastError: varchar("lastError", { length: 512 }),
  publishedAt: timestamp("publishedAt", { fsp: 3 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const DEFAULT_OUTBOX_LEASE_MS = 30_000;

export type ClaimedEconomicOutbox = {
  id: string;
  tenantId: string;
  payload: AppendGoldlineWorldEvent;
  leaseOwner: string;
  leaseExpiresAt: Date;
  attemptCount: number;
};

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}

function assertEconomicOutboxIdentity(row: {
  id: string;
  tenantId: string;
  payload: AppendGoldlineWorldEvent;
}) {
  const durableTenantId = requireCleanCloudTenantId(row.tenantId);
  const payloadTenantId = requireCleanCloudTenantId(row.payload.tenantId);
  if (durableTenantId !== payloadTenantId) {
    throw new Error(
      "Economic outbox tenant mismatch for " +
        row.id +
        ": durable=" +
        durableTenantId +
        " payload=" +
        payloadTenantId
    );
  }
  if (!row.payload.idempotencyKey?.trim()) {
    throw new Error("Economic outbox " + row.id + " is missing publication idempotency");
  }
}

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
  const tenantId = requireCleanCloudTenantId(row.tenantId);
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
  const tenantId = requireCleanCloudTenantId(row.tenantId);
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
  const tenantId = requireCleanCloudTenantId(row.tenantId);
  const cleanCloudEvidence =
    snapshot.paid && snapshot.paymentAt
      ? await admitCleanCloudPaidObservationWith(tx, {
          tenantId,
          cleancloudOrderId: String(row.cleancloudOrderId),
          sourceRef: `cleancloud-import:${row.importBatchId}:${row.cleancloudOrderId}`,
          occurredAt: snapshot.paymentAt,
          metadata: {
            importBatchId: row.importBatchId,
            sourceReportType: row.sourceReportType,
          },
        })
      : null;
  const payload: AppendGoldlineWorldEvent = {
    tenantId, physicalEntityId,
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
      sourceReportType: row.sourceReportType, projectionMode: "replace",
      authorityReceiptId: cleanCloudEvidence?.id ?? null },
  };
  // Resolve before entering the import transaction at the caller where possible;
  // an unresolved binding is explicitly null, never a guessed physical ID.
  await tx.insert(economicOutbox).values({ id, tenantId, payload });
  await tx.update(economicHeads).set({ revision, fingerprint })
    .where(eq(economicHeads.economicKey, snapshot.economicKey));
}

/**
 * Lease one unpublished publication intent. The row lock and lease assignment
 * are one transaction, so concurrent processes cannot actively publish the
 * same intent at the same time. An expired lease is reclaimable after a crash.
 */
export async function claimNextEconomicOutbox(input: {
  leaseOwner: string;
  leaseMs?: number;
}): Promise<ClaimedEconomicOutbox | null> {
  const leaseOwner = input.leaseOwner.trim();
  const leaseMs = input.leaseMs ?? DEFAULT_OUTBOX_LEASE_MS;
  if (!leaseOwner) throw new Error("Economic outbox leaseOwner is required");
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
    throw new Error("Economic outbox leaseMs must be a positive integer");
  }

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [row] = await tx
      .select()
      .from(economicOutbox)
      .where(
        and(
          isNull(economicOutbox.publishedAt),
          or(
            isNull(economicOutbox.leaseExpiresAt),
            lte(economicOutbox.leaseExpiresAt, new Date())
          )
        )
      )
      .orderBy(economicOutbox.createdAt, economicOutbox.id)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;

    assertEconomicOutboxIdentity(row);
    const leaseExpiresAt = new Date(Date.now() + leaseMs);
    const attemptCount = Number(row.attemptCount) + 1;
    await tx
      .update(economicOutbox)
      .set({
        leaseOwner,
        leaseExpiresAt,
        attemptCount,
        lastError: null,
      })
      .where(
        and(
          eq(economicOutbox.id, row.id),
          eq(economicOutbox.tenantId, row.tenantId),
          isNull(economicOutbox.publishedAt)
        )
      );

    return {
      id: row.id,
      tenantId: row.tenantId,
      payload: row.payload,
      leaseOwner,
      leaseExpiresAt,
      attemptCount,
    };
  });
}

export async function acknowledgeEconomicOutbox(
  claim: ClaimedEconomicOutbox
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db
    .update(economicOutbox)
    .set({
      publishedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    })
    .where(
      and(
        eq(economicOutbox.id, claim.id),
        eq(economicOutbox.tenantId, claim.tenantId),
        eq(economicOutbox.leaseOwner, claim.leaseOwner),
        isNull(economicOutbox.publishedAt)
      )
    );
  return Number(result[0]?.affectedRows ?? 0) === 1;
}

async function releaseEconomicOutboxClaim(
  claim: ClaimedEconomicOutbox,
  error: unknown
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(economicOutbox)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: messageOf(error),
    })
    .where(
      and(
        eq(economicOutbox.id, claim.id),
        eq(economicOutbox.tenantId, claim.tenantId),
        eq(economicOutbox.leaseOwner, claim.leaseOwner),
        isNull(economicOutbox.publishedAt)
      )
    );
}

/**
 * Publication is at-least-once delivery with exactly-once durable effect:
 * - claim/lease prevents concurrent active publication of one outbox row;
 * - a crash before publish leaves an expiring lease and the row is retried;
 * - a crash after publish but before acknowledgement republishes the exact
 *   tenant-scoped idempotency key, which goldline_world_events uniquely fences;
 * - acknowledgement is lease-owner fenced, so a stale worker cannot complete a
 *   row reclaimed by another process.
 */
export async function drainEconomicOutbox(
  limit = 100,
  input: { leaseOwner?: string; leaseMs?: number } = {}
) {
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new Error("Economic outbox drain limit must be a non-negative integer");
  }
  const leaseOwner =
    input.leaseOwner?.trim() || "economic-outbox:" + randomUUID();
  let published = 0;
  while (published < limit) {
    const claim = await claimNextEconomicOutbox({
      leaseOwner,
      leaseMs: input.leaseMs,
    });
    if (!claim) break;
    try {
      assertEconomicOutboxIdentity(claim);
      await appendGoldlineWorldEvent(claim.payload);
      if (!(await acknowledgeEconomicOutbox(claim))) {
        throw new Error(
          "Economic outbox lease lost before acknowledgement: " + claim.id
        );
      }
      published += 1;
    } catch (error) {
      await releaseEconomicOutboxClaim(claim, error);
      throw error;
    }
  }
  return published;
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
