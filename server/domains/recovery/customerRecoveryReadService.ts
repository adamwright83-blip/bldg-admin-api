import { and, eq, gte } from "drizzle-orm";
import { communicationReceipts, customerRecoveryInterventions } from "../../../drizzle/schema";
import { getDb } from "../../db";

export type RecoveryInterventionRecord = {
  customerKeyHash: string;
  status: string;
  contactedAt: Date | null;
};

export type CommunicationReceiptRecord = {
  toNumber: string | null;
  direction: string | null;
  status: string | null;
  createdAt: Date;
};

type RecoveryReadDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export async function readCustomerRecoveryInterventions(
  tenantId: string,
  database?: RecoveryReadDb
): Promise<RecoveryInterventionRecord[] | null> {
  if (!tenantId.trim()) {
    throw new Error("Customer recovery read requires established tenant authority");
  }
  const db = database ?? (await getDb());
  if (!db) return null;
  return db
    .select({
      customerKeyHash: customerRecoveryInterventions.customerKeyHash,
      status: customerRecoveryInterventions.status,
      contactedAt: customerRecoveryInterventions.contactedAt,
    })
    .from(customerRecoveryInterventions)
    .where(eq(customerRecoveryInterventions.tenantId, tenantId))
    .catch(() => null);
}

export async function readRecentOutboundCommunications(
  tenantId: string,
  since: Date,
  database?: RecoveryReadDb
): Promise<CommunicationReceiptRecord[] | null> {
  if (!tenantId.trim()) {
    throw new Error("Communications read requires established tenant authority");
  }
  const db = database ?? (await getDb());
  if (!db) return null;
  return db
    .select({
      toNumber: communicationReceipts.toNumber,
      direction: communicationReceipts.direction,
      status: communicationReceipts.status,
      createdAt: communicationReceipts.createdAt,
    })
    .from(communicationReceipts)
    .where(
      and(
        eq(communicationReceipts.tenantId, tenantId),
        gte(communicationReceipts.createdAt, since)
      )
    )
    .catch(() => null);
}
