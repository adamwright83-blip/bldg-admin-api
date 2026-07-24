import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  commercialCampaignLinks,
  commercialAttributionCorrections,
  commercialCustomerAcquisitionSources,
  commercialCustomers,
  commercialOrderAcquisitionAttributions,
  commercialOrderAttributions,
  orderPaymentProjections,
  orders,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { hashCommercialCampaignLinkToken } from "./commercialCampaignLinkService";

export function normalizedAttributionIdentity(input: { email?: string | null; phone?: string | null }) {
  const email = input.email?.trim().toLowerCase() ?? "";
  const phone = input.phone?.replace(/[^\d+]/g, "") ?? "";
  return createHash("sha256").update(email ? `email:${email}` : `phone:${phone}`).digest("hex");
}

export async function reverseCommercialOrderAttribution(input: {
  tenantId: string; orderId: number; actorId: string; requestId: string; reason: string;
}) {
  const db = await getDb(); if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const rows = await tx.select().from(commercialOrderAcquisitionAttributions).where(and(
      eq(commercialOrderAcquisitionAttributions.tenantId, input.tenantId), eq(commercialOrderAcquisitionAttributions.orderId, input.orderId)
    )).limit(1).for("update");
    const attribution = rows[0];
    if (!attribution) return { reversed: false };
    if (attribution.reviewState === "reversed") return { reversed: true };
    await tx.insert(commercialAttributionCorrections).values({
      id: randomUUID(), tenantId: input.tenantId, acquisitionAttributionId: attribution.id,
      orderId: input.orderId, previousStateJson: attribution,
      correctedStateJson: { ...attribution, reviewState: "reversed" }, reason: input.reason,
      correctedBy: input.actorId, requestId: input.requestId,
    });
    await tx.update(commercialOrderAcquisitionAttributions).set({
      reviewState: "reversed", reviewedBy: input.actorId, reviewedAt: new Date(), reviewReason: input.reason,
    }).where(and(eq(commercialOrderAcquisitionAttributions.tenantId, input.tenantId), eq(commercialOrderAcquisitionAttributions.id, attribution.id)));
    await tx.update(commercialOrderAttributions).set({
      status: "reversed", paidCents: 0, realizedCents: 0, netPaidCents: 0, lastReconciledAt: new Date(),
    }).where(and(eq(commercialOrderAttributions.tenantId, input.tenantId), eq(commercialOrderAttributions.orderId, input.orderId)));
    return { reversed: true };
  });
}

export function normalizedAttributionLocation(input: { buildingSlug?: string | null; address: string }) {
  const value = input.buildingSlug?.trim().toLowerCase() || input.address.toLowerCase().replace(/[^a-z0-9]/g, "");
  return createHash("sha256").update(value).digest("hex");
}

function cents(total: string | null) {
  const value = Number(total ?? 0);
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100)) : 0;
}

export async function attributeOrderFromCampaign(input: {
  tenantId: string; orderId: number; campaignToken?: string | null; requestId: string; actorId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const orderRows = await tx.select().from(orders).where(and(eq(orders.id, input.orderId), eq(orders.tenantId, input.tenantId))).limit(1).for("update");
    const order = orderRows[0];
    if (!order) throw new Error("Order not found");
    const existing = await tx.select().from(commercialOrderAcquisitionAttributions).where(and(
      eq(commercialOrderAcquisitionAttributions.tenantId, input.tenantId), eq(commercialOrderAcquisitionAttributions.orderId, input.orderId)
    )).limit(1);
    if (existing[0]) return existing[0];
    const customerIdentityKey = normalizedAttributionIdentity(order);
    const serviceLocationKey = normalizedAttributionLocation(order);
    const sourceRows = await tx.select().from(commercialCustomerAcquisitionSources).where(and(
      eq(commercialCustomerAcquisitionSources.tenantId, input.tenantId),
      eq(commercialCustomerAcquisitionSources.customerIdentityKey, customerIdentityKey),
      eq(commercialCustomerAcquisitionSources.serviceLocationKey, serviceLocationKey)
    )).limit(1).for("update");
    let source = sourceRows[0];
    let link = input.campaignToken ? (await tx.select().from(commercialCampaignLinks).where(and(
      eq(commercialCampaignLinks.tenantId, input.tenantId),
      eq(commercialCampaignLinks.tokenHash, hashCommercialCampaignLinkToken(input.campaignToken))
    )).limit(1))[0] : null;
    if (input.campaignToken && (!link || link.status !== "active" || link.revokedAt || (link.expiresAt && link.expiresAt <= new Date()))) return null;
    if (!input.campaignToken && source?.campaignLinkId) {
      link = (await tx.select().from(commercialCampaignLinks).where(and(
        eq(commercialCampaignLinks.tenantId, input.tenantId), eq(commercialCampaignLinks.id, source.campaignLinkId)
      )).limit(1))[0] ?? null;
    }
    if (!link) return null;
    if (!source && input.campaignToken) {
      const sourceId = randomUUID();
      await tx.insert(commercialCustomerAcquisitionSources).values({
        id: sourceId, tenantId: input.tenantId, customerIdentityKey, serviceLocationKey,
        campaignLinkId: link.id, accountId: link.accountId, missionId: link.missionId, pipelineId: link.pipelineId,
        referringContactId: link.referringContactId, sourceType: "explicit_campaign",
        firstTouchAt: order.createdAt, status: "active",
        requestId: input.requestId, createdBy: input.actorId,
      });
      source = (await tx.select().from(commercialCustomerAcquisitionSources).where(eq(commercialCustomerAcquisitionSources.id, sourceId)).limit(1))[0];
    }
    if (!source) throw new Error("First-touch acquisition source was not persisted");
    const conflict = Boolean(input.campaignToken && (source.accountId !== link.accountId || source.campaignLinkId !== link.id));
    const customers = await tx.select().from(commercialCustomers).where(and(
      eq(commercialCustomers.tenantId, input.tenantId), eq(commercialCustomers.accountId, link.accountId)
    )).limit(1);
    const customer = customers[0] ?? null;
    const attributionId = randomUUID();
    await tx.insert(commercialOrderAcquisitionAttributions).values({
      id: attributionId, tenantId: input.tenantId, orderId: order.id,
      firstTouchSourceId: source.id, orderCampaignLinkId: link.id, accountId: link.accountId,
      missionId: link.missionId, pipelineId: link.pipelineId, commercialCustomerId: customer?.id ?? null,
      referringContactId: link.referringContactId, customerIdentityKey, serviceLocationKey,
      sourceType: input.campaignToken ? "explicit_campaign" : "inherited_first_touch", confidence: "high",
      attributionReason: conflict ? "Explicit order campaign differs from preserved first-touch source; review both histories." : input.campaignToken ? "Valid signed campaign token supplied for this order." : "Customer identity and normalized service location match the preserved first-touch source with no contradictory order campaign.",
      firstTouchAt: source.firstTouchAt, conversionAt: order.createdAt,
      reviewState: conflict ? "review_required" : customer ? "attributed" : "pending",
      requestId: input.requestId, createdBy: input.actorId,
    });
    if (customer && !conflict) {
      const prior = await tx.select({ id: commercialOrderAttributions.id }).from(commercialOrderAttributions).where(and(
        eq(commercialOrderAttributions.tenantId, input.tenantId), eq(commercialOrderAttributions.commercialCustomerId, customer.id)
      )).limit(1);
      const projection = (await tx.select().from(orderPaymentProjections).where(and(
        eq(orderPaymentProjections.tenantId, input.tenantId), eq(orderPaymentProjections.orderId, order.id)
      )).limit(1))[0];
      const cancelled = order.status === "cancelled";
      const knownNet = projection?.netPaidCents ?? null;
      const paidCents = cancelled ? 0 : knownNet ?? (order.paid ? cents(order.total) : 0);
      const financialReview = projection?.state === "partially_refunded" && knownNet === null;
      await tx.insert(commercialOrderAttributions).values({
        tenantId: input.tenantId, commercialCustomerId: customer.id, missionId: link.missionId,
        orderId: order.id, acquisitionAttributionId: attributionId,
        attributionType: prior[0] ? "recurring" : "first_order",
        status: financialReview ? "financial_review" : cancelled || projection?.state === "refunded" ? "reversed" : "active",
        currency: projection?.currency ?? "usd", capturedCents: projection?.capturedCents ?? null,
        refundedCents: projection?.refundedCents ?? null, netPaidCents: knownNet,
        paidCents, realizedCents: paidCents, paidAt: order.paidAt,
        requestId: input.requestId, createdBy: input.actorId,
        financialReviewReason: financialReview ? "Canonical net amount is unavailable for a known partial refund." : null,
        lastReconciledAt: new Date(),
      }).onDuplicateKeyUpdate({ set: {
        paidCents, realizedCents: paidCents, paidAt: order.paidAt,
        status: financialReview ? "financial_review" : cancelled || projection?.state === "refunded" ? "reversed" : "active",
      }});
    }
    return (await tx.select().from(commercialOrderAcquisitionAttributions).where(eq(commercialOrderAcquisitionAttributions.id, attributionId)).limit(1))[0];
  });
}
