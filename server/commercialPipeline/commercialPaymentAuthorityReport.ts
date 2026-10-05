import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  commercialOrderAttributions,
  orders,
} from "../../drizzle/schema";
import {
  findAuthorityReceiptForSubject,
  type AuthorityReceipt,
} from "../authority/authorityReceipt";
import { getDb } from "../db";
import {
  legacyCommercialPaidCents,
  verifiedCommercialPaidCents,
  type CommercialPaymentAuthorityOrder,
} from "./commercialPipelineService";

export type CommercialPaymentAuthorityMismatchReason =
  | "missing_order"
  | "missing_processor_evidence"
  | "missing_authority_receipt"
  | "receipt_source_mismatch"
  | "receipt_reference_mismatch"
  | "legacy_and_authority_disagree";

export type CommercialPaymentAuthorityComparison = {
  legacyPaidCents: number;
  verifiedPaidCents: number;
  matches: boolean;
  reason: CommercialPaymentAuthorityMismatchReason | null;
};

export function compareCommercialPaymentAuthority(
  order: CommercialPaymentAuthorityOrder,
  receipt: AuthorityReceipt | null
): CommercialPaymentAuthorityComparison {
  const legacyPaidCents = legacyCommercialPaidCents(order);
  const verifiedPaidCents = verifiedCommercialPaidCents(order, receipt);
  if (legacyPaidCents === verifiedPaidCents) {
    return {
      legacyPaidCents,
      verifiedPaidCents,
      matches: true,
      reason: null,
    };
  }

  const paymentIntentId = order.stripePaymentIntentId?.trim() ?? "";
  let reason: CommercialPaymentAuthorityMismatchReason =
    "legacy_and_authority_disagree";
  if (order.paid && !paymentIntentId) {
    reason = "missing_processor_evidence";
  } else if (order.paid && !receipt) {
    reason = "missing_authority_receipt";
  } else if (
    receipt &&
    receipt.sourceType !== "stripe_payment_intent"
  ) {
    reason = "receipt_source_mismatch";
  } else if (
    receipt &&
    paymentIntentId &&
    receipt.sourceRef !== paymentIntentId
  ) {
    reason = "receipt_reference_mismatch";
  }

  return {
    legacyPaidCents,
    verifiedPaidCents,
    matches: false,
    reason,
  };
}

export type CommercialPaymentAuthorityMismatchReport = {
  readOnly: true;
  tenantId: string;
  generatedAt: string;
  attributionCount: number;
  comparedOrderCount: number;
  missingOrderCount: number;
  matchCount: number;
  mismatchCount: number;
  legacyPaidCents: number;
  verifiedPaidCents: number;
  differenceCents: number;
  mismatchReasonCounts: Record<
    CommercialPaymentAuthorityMismatchReason,
    number
  >;
  mismatches: Array<{
    attributionId: number;
    orderId: number;
    legacyPaidCents: number;
    verifiedPaidCents: number;
    differenceCents: number;
    paidFlag: boolean;
    paymentIntentPresent: boolean;
    authorityReceiptId: string | null;
    reason: CommercialPaymentAuthorityMismatchReason;
  }>;
};

function emptyReasonCounts(): CommercialPaymentAuthorityMismatchReport["mismatchReasonCounts"] {
  return {
    missing_order: 0,
    missing_processor_evidence: 0,
    missing_authority_receipt: 0,
    receipt_source_mismatch: 0,
    receipt_reference_mismatch: 0,
    legacy_and_authority_disagree: 0,
  };
}

/**
 * READ-ONLY diagnostic.
 *
 * This function deliberately does not call reconcileCommercialPipelineRevenue.
 * It performs SELECTs only and compares the existing legacy paid-cents rule
 * against the existing Authority Receipt-backed rule.
 */
export async function readCommercialPaymentAuthorityMismatchReport(
  tenantIdInput: string
): Promise<CommercialPaymentAuthorityMismatchReport> {
  const tenantId = tenantIdInput.trim();
  if (!tenantId) throw new Error("Payment authority report requires tenantId");

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const attributions = await db
    .select({
      id: commercialOrderAttributions.id,
      orderId: commercialOrderAttributions.orderId,
    })
    .from(commercialOrderAttributions)
    .where(eq(commercialOrderAttributions.tenantId, tenantId));

  if (attributions.length === 0) {
    return {
      readOnly: true,
      tenantId,
      generatedAt: new Date().toISOString(),
      attributionCount: 0,
      comparedOrderCount: 0,
      missingOrderCount: 0,
      matchCount: 0,
      mismatchCount: 0,
      legacyPaidCents: 0,
      verifiedPaidCents: 0,
      differenceCents: 0,
      mismatchReasonCounts: emptyReasonCounts(),
      mismatches: [],
    };
  }

  // "default" is the real Laundry Farm tenant. Historical native orders may
  // still have a null tenantId, so that one tenant explicitly includes those
  // legacy rows. Other tenants never inherit null/default rows.
  const orderTenantPredicate =
    tenantId === "default"
      ? or(eq(orders.tenantId, tenantId), isNull(orders.tenantId))
      : eq(orders.tenantId, tenantId);

  const sourceOrders = await db
    .select({
      id: orders.id,
      paid: orders.paid,
      total: orders.total,
      stripePaymentIntentId: orders.stripePaymentIntentId,
    })
    .from(orders)
    .where(
      and(
        orderTenantPredicate,
        inArray(
          orders.id,
          attributions.map(item => item.orderId)
        )
      )
    );

  const byId = new Map(sourceOrders.map(order => [order.id, order]));
  const mismatchReasonCounts = emptyReasonCounts();
  const mismatches: CommercialPaymentAuthorityMismatchReport["mismatches"] =
    [];

  let comparedOrderCount = 0;
  let missingOrderCount = 0;
  let matchCount = 0;
  let legacyPaidCents = 0;
  let verifiedPaidCents = 0;

  for (const attribution of attributions) {
    const order = byId.get(attribution.orderId);
    if (!order) {
      missingOrderCount += 1;
      mismatchReasonCounts.missing_order += 1;
      mismatches.push({
        attributionId: attribution.id,
        orderId: attribution.orderId,
        legacyPaidCents: 0,
        verifiedPaidCents: 0,
        differenceCents: 0,
        paidFlag: false,
        paymentIntentPresent: false,
        authorityReceiptId: null,
        reason: "missing_order",
      });
      continue;
    }

    comparedOrderCount += 1;
    const receipt = order.paid
      ? await findAuthorityReceiptForSubject({
          tenantId,
          claimType: "payment_verified",
          subjectType: "order",
          subjectId: String(order.id),
        })
      : null;
    const comparison = compareCommercialPaymentAuthority(order, receipt);
    legacyPaidCents += comparison.legacyPaidCents;
    verifiedPaidCents += comparison.verifiedPaidCents;

    if (comparison.matches) {
      matchCount += 1;
      continue;
    }

    const reason =
      comparison.reason ?? "legacy_and_authority_disagree";
    mismatchReasonCounts[reason] += 1;
    mismatches.push({
      attributionId: attribution.id,
      orderId: order.id,
      legacyPaidCents: comparison.legacyPaidCents,
      verifiedPaidCents: comparison.verifiedPaidCents,
      differenceCents:
        comparison.legacyPaidCents - comparison.verifiedPaidCents,
      paidFlag: Boolean(order.paid),
      paymentIntentPresent: Boolean(order.stripePaymentIntentId?.trim()),
      authorityReceiptId: receipt?.id ?? null,
      reason,
    });
  }

  return {
    readOnly: true,
    tenantId,
    generatedAt: new Date().toISOString(),
    attributionCount: attributions.length,
    comparedOrderCount,
    missingOrderCount,
    matchCount,
    mismatchCount: mismatches.length,
    legacyPaidCents,
    verifiedPaidCents,
    differenceCents: legacyPaidCents - verifiedPaidCents,
    mismatchReasonCounts,
    mismatches,
  };
}
