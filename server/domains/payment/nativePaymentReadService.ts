import {
  paymentAuthorityReceiptMatches,
  readPaymentAuthorityReceipts,
  type AuthorityReceipt,
  type PaymentAuthorityExpectation,
} from "../../authority/authorityReceipt";

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
  if (
    !tenantId ||
    !Number.isInteger(row.id) ||
    !row.stripePaymentIntentId?.trim()
  )
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
    hasNativePaymentEvidence(row) &&
      expected &&
      receipt &&
      paymentAuthorityReceiptMatches(receipt, expected)
  );
}

/** SELECT-only payment occurrence receipts, independent of current paid/refund flags.
 * Missing historical tenant authority remains unverified. */
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

export type NativePaymentFact = {
  orderId: number;
  tenantId: string;
  paymentIntentId: string;
  authorityReceiptId: string;
  occurredAt: string | null;
  capturedAmountCents: number | null;
};

/**
 * Canonical native Payment read projection.
 * A fact exists only when exact tenant/order/processor evidence matches an
 * admitted Payment receipt. Receipt existence proves occurrence; dollars remain
 * unknown unless immutable provider capture evidence is present.
 */
export async function readNativePaymentFacts(
  rows: readonly NativePaymentEvidence[]
): Promise<Map<number, NativePaymentFact>> {
  const receipts = await readNativePaymentAuthorityReceipts(rows);
  const facts = new Map<number, NativePaymentFact>();
  for (const row of rows) {
    if (!Number.isInteger(row.id)) continue;
    const receipt = receipts.get(row.id!);
    // readNativePaymentAuthorityReceipts already exact-matches tenant/order/source/ref.
    // Historical payment occurrence remains true even if current paid/refund state later changes.
    if (!receipt) continue;
    const tenantId = row.tenantId?.trim();
    const paymentIntentId = row.stripePaymentIntentId?.trim();
    if (!tenantId || !paymentIntentId) continue;
    facts.set(row.id!, {
      orderId: row.id!,
      tenantId,
      paymentIntentId,
      authorityReceiptId: receipt.id,
      occurredAt: receipt.occurredAt,
      capturedAmountCents: nativeCapturedAmountCents(receipt),
    });
  }
  return facts;
}

/** Immutable provider-captured USD amount. Receipt existence alone proves no dollars. */
export function nativeCapturedAmountCents(
  receipt?: AuthorityReceipt | null
): number | null {
  const metadata = receipt?.metadata;
  const amount = metadata?.capturedAmountCents;
  return metadata?.captureEvidence === "stripe_amount_received_v1" &&
    metadata?.capturedCurrency === "usd" &&
    typeof amount === "number" &&
    Number.isSafeInteger(amount) &&
    amount >= 0
    ? amount
    : null;
}
