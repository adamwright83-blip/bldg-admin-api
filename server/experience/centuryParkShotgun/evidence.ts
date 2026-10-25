import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { personalOutreachReplies } from "../../../drizzle/schema";
import { readNativeCustomerHistory } from "../../domains/orders/orderHistoryReadService";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import {
  identityKeysFor,
  normalizeIdentityPhone,
} from "../../analytics/customerIdentityResolution";
import { shotgunStore } from "./store";
import { matchesShotApproval } from "./projection";
import type { ShotRow } from "./schema";
import {
  SHOTGUN_RESULT_RULE,
  type ShotgunObservation,
} from "../../../shared/centuryParkShotgun";

export const evidenceReaders = {
  async replies(tenantId: string) {
    const db = await getDb();
    if (!db) throw new Error("Reply evidence is unavailable.");
    return db
      .select()
      .from(personalOutreachReplies)
      .where(
        and(
          eq(personalOutreachReplies.tenantId, tenantId),
          eq(personalOutreachReplies.direction, "inbound")
        )
      );
  },
  orders: readNativeCustomerHistory,
  payments: loadPaidOrderLedger,
};

/** Reads durable business evidence. No caller can submit replies, payments, receipt ids or fulfillment assertions here. */
export async function loadCenturyParkShotgunTimeline(
  tenantId: string,
  deps = { store: shotgunStore, readers: evidenceReaders },
  now = new Date()
) {
  if (!tenantId.trim()) throw new Error("An established tenant is required.");
  const shots = await deps.store.list(tenantId);
  if (!shots.length)
    return {
      shots: [],
      coverage: {
        replies: "not_requested",
        orders: "not_requested",
        payments: "not_requested",
      },
      resultRule: SHOTGUN_RESULT_RULE,
    };
  const start = new Date(Math.min(...shots.map(s => s.approvedAt.getTime())));
  const [replies, orders, payments] = await Promise.allSettled([
    deps.readers.replies(tenantId),
    deps.readers.orders(tenantId),
    deps.readers.payments({
      tenantId,
      startUtc: start,
      endExclusiveUtc: now,
      timeZone: "America/Los_Angeles",
      maxSourceRows: 10000,
    }),
  ]);
  function sameCustomer(
    shot: ShotRow,
    identity: Parameters<typeof identityKeysFor>[0]
  ) {
    return (
      identityKeysFor(identity).includes(shot.customerId) ||
      Boolean(
        normalizeIdentityPhone(identity.phone) &&
          normalizeIdentityPhone(identity.phone) ===
            normalizeIdentityPhone(shot.recipientPhone)
      )
    );
  }
  const timelines = await Promise.all(
    shots.map(async shot => {
      const outbox = await deps.store.outbox(shot);
      const approvalMatches = outbox ? matchesShotApproval(shot, outbox) : null;
      const next = shots
        .filter(
          s =>
            s.customerId === shot.customerId && s.approvedAt > shot.approvedAt
        )
        .sort((a, b) => a.approvedAt.getTime() - b.approvedAt.getTime())[0];
      const inWindow = (at: Date) =>
        Number.isFinite(at.getTime()) &&
        at >= shot.approvedAt &&
        at < (next?.approvedAt ?? now);
      const observations: ShotgunObservation[] = [];
      if (
        replies.status === "fulfilled" &&
        outbox?.dispatchedAt &&
        outbox.externalMessageId &&
        !outbox.externalMessageId.startsWith("simulated:")
      ) {
        for (const reply of replies.value) {
          if (
            reply.tenantId !== tenantId ||
            reply.operatorId !== shot.operatorId ||
            reply.customerId !== shot.customerId ||
            !["provider_webhook", "device_observed"].includes(reply.source) ||
            !reply.providerMessageId ||
            reply.providerMessageId.startsWith("simulated:") ||
            reply.reportedAt < outbox.dispatchedAt ||
            reply.reportedAt > now ||
            (reply.messageId
              ? reply.messageId !== outbox.id
              : !inWindow(reply.reportedAt))
          )
            continue;
          observations.push({
            kind: "verified_reply",
            sourceRef: reply.id,
            occurredAt: reply.reportedAt.toISOString(),
            relation:
              reply.messageId && approvalMatches
                ? "exact_message"
                : "customer_timeline",
            reply: {
              source: reply.source,
              classification: reply.classification,
              text: reply.replyText,
            },
          });
        }
      }
      if (orders.status === "fulfilled")
        for (const order of orders.value) {
          if (
            order.tenantId === tenantId &&
            sameCustomer(shot, order) &&
            inWindow(order.createdAt)
          )
            observations.push({
              kind: "order_recorded",
              sourceRef: `native_order:${order.id}`,
              orderStatus: order.status,
              occurredAt: order.createdAt.toISOString(),
              relation: "customer_timeline",
            });
        }
      if (payments.status === "fulfilled")
        for (const payment of payments.value.events) {
          if (
            sameCustomer(shot, payment.identity) &&
            inWindow(payment.occurredAt) &&
            payment.authorityReceiptId &&
            payment.cents > 0
          ) {
            observations.push({
              kind: "payment_observed",
              sourceRef: payment.eventKey,
              occurredAt: payment.occurredAt.toISOString(),
              relation: "customer_timeline",
              authorityReceiptId: payment.authorityReceiptId,
              payment: {
                source: payment.source,
                observedCents: payment.cents,
                orderNumber: payment.orderNumber ?? null,
              },
            });
          }
        }
      return {
        ...shot,
        execution: outbox?.status ?? shot.state,
        currentMessage: outbox
          ? {
              body: outbox.currentMessageBody,
              recipientPhone: outbox.recipientPhone,
              scheduledFor: outbox.scheduledFor,
              revision: outbox.revisionCount,
            }
          : null,
        approvalMatches,
        // Original operator approval is immutable. A schedule or a payment cannot fulfill the offer.
        offerFulfilled: false as const,
        observations: observations.sort((a, b) =>
          a.occurredAt.localeCompare(b.occurredAt)
        ),
      };
    })
  );
  return {
    shots: timelines,
    resultRule: SHOTGUN_RESULT_RULE,
    coverage: {
      replies: replies.status === "fulfilled" ? "readable" : "unavailable",
      orders: orders.status === "fulfilled" ? "readable" : "unavailable",
      payments:
        payments.status === "fulfilled"
          ? payments.value.completeness
          : "unavailable",
    },
  };
}
