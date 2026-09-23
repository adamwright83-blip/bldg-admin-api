import { and, eq, gte, inArray, lt } from "drizzle-orm";
import {
  claireConversationSessions,
  commercialOrderAcquisitionAttributions,
  commercialOrderAttributions,
  communicationContextLinks,
  communicationReceipts,
  orderPaymentProjections,
  orders,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlMissingTableError } from "../mysqlErrors";
import {
  isCommunicationLinkSource,
  isCommunicationPartyClass,
  type CommunicationLinkEntityKind,
} from "@shared/communicationsAnalytics";
import { communicationReceiptFromRow } from "../twilioPlatform/communicationReceipts";
import type { CommunicationsObservationWindow } from "@shared/communicationsAnalytics";
import type {
  ClaireSessionLinkRecord,
  CommercialAcquisitionRecord,
  CommercialOrderAttributionRecord,
  CommunicationContextLinkRecord,
  CommunicationsProjectionFacts,
  OrderMoneyRecord,
  OrderPaymentProjectionRecord,
} from "./records";

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function centsFromTotal(total: string | number | null | undefined): number | null {
  if (total == null || total === "") return null;
  const value = typeof total === "number" ? total : Number(total);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

function chunk<T>(values: readonly T[], size = 400): T[][] {
  if (values.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size) as T[]);
  }
  return out;
}

export async function loadCommunicationsProjectionFacts(input: {
  tenantId: string;
  observationWindow: CommunicationsObservationWindow;
}): Promise<CommunicationsProjectionFacts> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tenantId = input.tenantId.trim();
  const start = new Date(input.observationWindow.startUtc);
  const end = new Date(input.observationWindow.endExclusiveUtc);

  const receiptRows = await db
    .select()
    .from(communicationReceipts)
    .where(
      and(
        eq(communicationReceipts.tenantId, tenantId),
        gte(communicationReceipts.createdAt, start),
        lt(communicationReceipts.createdAt, end)
      )
    );
  const receipts = receiptRows.map(row => communicationReceiptFromRow(row));

  const callSids = [
    ...new Set(
      receipts
        .flatMap(receipt => [receipt.callSid, receipt.parentCallSid])
        .map(value => value?.trim() ?? "")
        .filter(Boolean)
    ),
  ];
  const messageSids = [
    ...new Set(
      receipts.map(receipt => receipt.messageSid?.trim() ?? "").filter(Boolean)
    ),
  ];
  const resourceSids = [...new Set([...callSids, ...messageSids])];

  const claireSessions: ClaireSessionLinkRecord[] = [];
  for (const ids of chunk(callSids)) {
    const rows = await db
      .select({
        tenantId: claireConversationSessions.tenantId,
        providerCallSid: claireConversationSessions.providerCallSid,
        claireConversationId: claireConversationSessions.claireConversationId,
        missionId: claireConversationSessions.missionId,
        relatedActionIdsJson: claireConversationSessions.relatedActionIdsJson,
        operatorUserId: claireConversationSessions.operatorUserId,
        startedAt: claireConversationSessions.startedAt,
      })
      .from(claireConversationSessions)
      .where(
        and(
          eq(claireConversationSessions.tenantId, tenantId),
          inArray(claireConversationSessions.providerCallSid, ids)
        )
      );
    for (const row of rows) {
      claireSessions.push({
        tenantId: row.tenantId,
        providerCallSid: row.providerCallSid,
        claireConversationId: row.claireConversationId,
        missionId: row.missionId,
        relatedActionIds: asStringArray(row.relatedActionIdsJson),
        operatorUserId: row.operatorUserId,
        startedAt: iso(row.startedAt),
      });
    }
  }

  const contextLinks: CommunicationContextLinkRecord[] = [];
  try {
    for (const ids of chunk(resourceSids)) {
      const rows = await db
        .select()
        .from(communicationContextLinks)
        .where(
          and(
            eq(communicationContextLinks.tenantId, tenantId),
            inArray(communicationContextLinks.providerResourceSid, ids)
          )
        );
      for (const row of rows) {
        if (!isCommunicationLinkSource(row.source)) continue;
        contextLinks.push({
          tenantId: row.tenantId,
          providerResourceSid: row.providerResourceSid,
          resourceKind: row.resourceKind === "message" ? "message" : "call",
          partyClass:
            row.partyClass && isCommunicationPartyClass(row.partyClass)
              ? row.partyClass
              : null,
          goldlineEntityKind:
            (row.goldlineEntityKind as CommunicationLinkEntityKind | null) ??
            null,
          goldlineEntityId: row.goldlineEntityId,
          source: row.source,
          proof: row.proof,
        });
      }
    }
  } catch (error) {
    if (!isMysqlMissingTableError(error)) throw error;
  }

  const missionIds = [
    ...new Set(
      [
        ...claireSessions.map(session => session.missionId),
        ...contextLinks
          .filter(
            link =>
              link.source === "explicit_mission_link" &&
              link.goldlineEntityKind === "mission"
          )
          .map(link => Number(link.goldlineEntityId)),
      ].filter((id): id is number => id != null && Number.isInteger(id) && id > 0)
    ),
  ];
  const explicitOrderIds = [
    ...new Set(
      contextLinks
        .filter(
          link =>
            link.source === "explicit_order_link" &&
            link.goldlineEntityKind === "order"
        )
        .map(link => Number(link.goldlineEntityId))
        .filter((id): id is number => Number.isFinite(id) && id > 0)
    ),
  ];

  const acquisitions: CommercialAcquisitionRecord[] = [];
  if (missionIds.length) {
    for (const ids of chunk(missionIds)) {
      const rows = await db
        .select({
          tenantId: commercialOrderAcquisitionAttributions.tenantId,
          orderId: commercialOrderAcquisitionAttributions.orderId,
          missionId: commercialOrderAcquisitionAttributions.missionId,
          campaignLinkId: commercialOrderAcquisitionAttributions.orderCampaignLinkId,
          firstTouchSourceId: commercialOrderAcquisitionAttributions.firstTouchSourceId,
          reviewState: commercialOrderAcquisitionAttributions.reviewState,
          conversionAt: commercialOrderAcquisitionAttributions.conversionAt,
          createdAt: commercialOrderAcquisitionAttributions.createdAt,
        })
        .from(commercialOrderAcquisitionAttributions)
        .where(
          and(
            eq(commercialOrderAcquisitionAttributions.tenantId, tenantId),
            inArray(commercialOrderAcquisitionAttributions.missionId, ids)
          )
        );
      for (const row of rows) {
        acquisitions.push({
          tenantId: row.tenantId,
          orderId: row.orderId,
          missionId: row.missionId,
          campaignLinkId: row.campaignLinkId,
          firstTouchSourceId: row.firstTouchSourceId,
          reviewState: row.reviewState,
          conversionAt: iso(row.conversionAt),
          createdAt: iso(row.createdAt),
        });
      }
    }
  }
  if (explicitOrderIds.length) {
    const existing = new Set(acquisitions.map(row => row.orderId));
    const missing = explicitOrderIds.filter(id => !existing.has(id));
    for (const ids of chunk(missing)) {
      if (!ids.length) continue;
      const rows = await db
        .select({
          tenantId: commercialOrderAcquisitionAttributions.tenantId,
          orderId: commercialOrderAcquisitionAttributions.orderId,
          missionId: commercialOrderAcquisitionAttributions.missionId,
          campaignLinkId: commercialOrderAcquisitionAttributions.orderCampaignLinkId,
          firstTouchSourceId: commercialOrderAcquisitionAttributions.firstTouchSourceId,
          reviewState: commercialOrderAcquisitionAttributions.reviewState,
          conversionAt: commercialOrderAcquisitionAttributions.conversionAt,
          createdAt: commercialOrderAcquisitionAttributions.createdAt,
        })
        .from(commercialOrderAcquisitionAttributions)
        .where(
          and(
            eq(commercialOrderAcquisitionAttributions.tenantId, tenantId),
            inArray(commercialOrderAcquisitionAttributions.orderId, ids)
          )
        );
      for (const row of rows) {
        acquisitions.push({
          tenantId: row.tenantId,
          orderId: row.orderId,
          missionId: row.missionId,
          campaignLinkId: row.campaignLinkId,
          firstTouchSourceId: row.firstTouchSourceId,
          reviewState: row.reviewState,
          conversionAt: iso(row.conversionAt),
          createdAt: iso(row.createdAt),
        });
      }
    }
  }

  const orderIds = [
    ...new Set([
      ...acquisitions.map(row => row.orderId),
      ...explicitOrderIds,
    ]),
  ];

  const orderAttributions: CommercialOrderAttributionRecord[] = [];
  const paymentProjections: OrderPaymentProjectionRecord[] = [];
  const orderMoney: OrderMoneyRecord[] = [];
  for (const ids of chunk(orderIds)) {
    if (!ids.length) continue;
    const [attributionRows, paymentRows, orderRows] = await Promise.all([
      db
        .select({
          tenantId: commercialOrderAttributions.tenantId,
          orderId: commercialOrderAttributions.orderId,
          missionId: commercialOrderAttributions.missionId,
          status: commercialOrderAttributions.status,
          netPaidCents: commercialOrderAttributions.netPaidCents,
        })
        .from(commercialOrderAttributions)
        .where(
          and(
            eq(commercialOrderAttributions.tenantId, tenantId),
            inArray(commercialOrderAttributions.orderId, ids)
          )
        ),
      db
        .select({
          tenantId: orderPaymentProjections.tenantId,
          orderId: orderPaymentProjections.orderId,
          state: orderPaymentProjections.state,
          netPaidCents: orderPaymentProjections.netPaidCents,
        })
        .from(orderPaymentProjections)
        .where(
          and(
            eq(orderPaymentProjections.tenantId, tenantId),
            inArray(orderPaymentProjections.orderId, ids)
          )
        ),
      db
        .select({
          tenantId: orders.tenantId,
          id: orders.id,
          status: orders.status,
          paid: orders.paid,
          total: orders.total,
          createdAt: orders.createdAt,
          paidAt: orders.paidAt,
        })
        .from(orders)
        .where(and(eq(orders.tenantId, tenantId), inArray(orders.id, ids))),
    ]);
    for (const row of attributionRows) {
      orderAttributions.push({
        tenantId: row.tenantId,
        orderId: row.orderId,
        missionId: row.missionId,
        status: row.status,
        netPaidCents: row.netPaidCents,
      });
    }
    for (const row of paymentRows) {
      paymentProjections.push({
        tenantId: row.tenantId,
        orderId: row.orderId,
        state: row.state,
        netPaidCents: row.netPaidCents,
      });
    }
    for (const row of orderRows) {
      orderMoney.push({
        tenantId: row.tenantId ?? tenantId,
        orderId: row.id,
        status: row.status,
        paid: row.paid,
        totalCents: centsFromTotal(row.total),
        createdAt: iso(row.createdAt),
        paidAt: row.paidAt ? iso(row.paidAt) : null,
      });
    }
  }

  return {
    tenantId,
    receipts,
    claireSessions,
    contextLinks,
    acquisitions,
    orderAttributions,
    paymentProjections,
    orders: orderMoney,
  };
}
