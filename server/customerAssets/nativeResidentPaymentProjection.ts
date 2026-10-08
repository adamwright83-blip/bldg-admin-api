import { readNativeCustomerHistory } from "../orders/orderHistoryReadService";
import {
  hasNativePaymentAuthority,
  nativeCapturedAmountCents,
  readNativePaymentAuthorityReceipts,
} from "../authority/nativePaymentReadService";
import type { getDb } from "../db";
export type NativeResidentPaymentFact = {
  bldgUserId: number;
  paidOrderCount: number;
  lifetimeValueCents: number | null;
};
/** Owning Orders/Payment facts composed into a tenant-bound resident projection. */
export async function readNativeResidentPaymentProjection(
  tenantId: string,
  database?: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<NativeResidentPaymentFact[]> {
  const rows = await readNativeCustomerHistory(tenantId, database);
  const receipts = await readNativePaymentAuthorityReceipts(rows);
  const grouped = new Map<number, NativeResidentPaymentFact>();
  for (const row of rows) {
    if (
      !row.bldgUserId ||
      !hasNativePaymentAuthority(row, receipts.get(row.id))
    )
      continue;
    const fact = grouped.get(row.bldgUserId) ?? {
      bldgUserId: row.bldgUserId,
      paidOrderCount: 0,
      lifetimeValueCents: 0,
    };
    fact.paidOrderCount++;
    const amount = nativeCapturedAmountCents(receipts.get(row.id));
    fact.lifetimeValueCents =
      fact.lifetimeValueCents === null || amount === null
        ? null
        : fact.lifetimeValueCents + amount;
    grouped.set(row.bldgUserId, fact);
  }
  return [...grouped.values()];
}
