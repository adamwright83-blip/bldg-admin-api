import {
  paymentAuthorityReceiptMatches,
  readPaymentAuthorityReceipts,
  type AuthorityReceipt,
  type PaymentAuthorityExpectation,
} from "./authorityReceipt";

export type NativePaymentEvidence = {
  id?: number;
  tenantId?: string | null;
  paid?: boolean | number | null;
  stripePaymentIntentId?: string | null;
};

/** Candidate evidence only; this predicate does not assert admitted payment. */
export function hasNativePaymentEvidence(row: NativePaymentEvidence): boolean {
  return (
    (row.paid === true || row.paid === 1) &&
    Boolean(row.stripePaymentIntentId?.trim())
  );
}

function expectation(
  row: NativePaymentEvidence
): PaymentAuthorityExpectation | null {
  const tenantId = row.tenantId?.trim();
  if (!tenantId || !Number.isInteger(row.id) || !hasNativePaymentEvidence(row))
    return null;
  return {
    tenantId,
    subjectType: "order",
    subjectId: String(row.id),
    sourceType: "stripe_payment_intent",
    sourceRef: row.stripePaymentIntentId!.trim(),
  };
}

/** Payment admission, including exact tenant/order/processor evidence binding. */
export function hasNativePaymentAuthority(
  row: NativePaymentEvidence,
  receipt?: AuthorityReceipt | null
): boolean {
  const expected = expectation(row);
  return Boolean(
    expected && receipt && paymentAuthorityReceiptMatches(receipt, expected)
  );
}

/** SELECT-only batches. Missing historical tenant authority remains unverified. */
export async function readNativePaymentAuthorityReceipts(
  rows: readonly NativePaymentEvidence[]
): Promise<Map<number, AuthorityReceipt>> {
  const byTenant = new Map<
    string,
    Array<{ row: NativePaymentEvidence; expected: PaymentAuthorityExpectation }>
  >();
  for (const row of rows) {
    const expected = expectation(row);
    if (!expected) continue;
    const group = byTenant.get(expected.tenantId) ?? [];
    group.push({ row, expected });
    byTenant.set(expected.tenantId, group);
  }
  const verified = new Map<number, AuthorityReceipt>();
  for (const [tenantId, candidates] of byTenant) {
    const receipts = await readPaymentAuthorityReceipts({
      tenantId,
      expectations: candidates.map(candidate => candidate.expected),
    });
    const bySubject = new Map<string, AuthorityReceipt[]>();
    for (const receipt of receipts) {
      const group = bySubject.get(receipt.subjectId) ?? [];
      group.push(receipt);
      bySubject.set(receipt.subjectId, group);
    }
    for (const { row, expected } of candidates) {
      const receipt = bySubject
        .get(expected.subjectId)
        ?.find(candidate =>
          paymentAuthorityReceiptMatches(candidate, expected)
        );
      if (receipt) verified.set(row.id!, receipt);
    }
  }
  return verified;
}
