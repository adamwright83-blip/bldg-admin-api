import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialFollowUps,
  commercialOpportunities,
  commercialPipelineRecords,
  customerChurnSnapshots,
  customerRecoveryInterventions,
  orderPaymentProjections,
  orders,
} from "../../drizzle/schema";
import {
  deterministicEstimate,
  sourcedFact,
  unknownValue,
} from "../../shared/businessGame";
import { getDb } from "../db";
import {
  customerAssetId,
  customerIdentityHash,
  customerIdentityHashes,
  groupCustomerRecords,
} from "./customerIdentity";
import type {
  CustomerAsset,
  CustomerAssetSummary,
  CustomerAssetTimelineItem,
} from "./customerAssetTypes";

function cents(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) : 0;
}

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

export async function listCustomerAssets(input: {
  tenantId: string;
}): Promise<CustomerAssetSummary[]> {
  const assets = await projectCustomerAssets(input);
  return assets.map(({ timeline: _timeline, ...summary }) => summary);
}

export async function getCustomerAsset(input: {
  tenantId: string;
  assetId: string;
}): Promise<CustomerAsset | null> {
  const assets = await projectCustomerAssets({ tenantId: input.tenantId });
  return assets.find(asset => asset.id === input.assetId) ?? null;
}

export async function projectCustomerAssets(input: {
  tenantId: string;
}): Promise<CustomerAsset[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [orderRows, commercialRows] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`)
      .orderBy(desc(orders.createdAt)),
    db
      .select({
        account: commercialAccounts,
        location: commercialAccountLocations,
        contact: commercialAccountContacts,
        pipeline: commercialPipelineRecords,
        opportunity: commercialOpportunities,
      })
      .from(commercialAccounts)
      .leftJoin(
        commercialAccountLocations,
        and(
          eq(commercialAccountLocations.tenantId, input.tenantId),
          eq(commercialAccountLocations.accountId, commercialAccounts.id),
          eq(commercialAccountLocations.isPrimary, true)
        )
      )
      .leftJoin(
        commercialAccountContacts,
        and(
          eq(commercialAccountContacts.tenantId, input.tenantId),
          eq(commercialAccountContacts.accountId, commercialAccounts.id)
        )
      )
      .leftJoin(
        commercialPipelineRecords,
        and(
          eq(commercialPipelineRecords.tenantId, input.tenantId),
          eq(commercialPipelineRecords.accountId, commercialAccounts.id)
        )
      )
      .leftJoin(
        commercialOpportunities,
        and(
          eq(commercialOpportunities.tenantId, input.tenantId),
          eq(commercialOpportunities.accountId, commercialAccounts.id)
        )
      )
      .where(eq(commercialAccounts.tenantId, input.tenantId)),
  ]);

  const orderIds = orderRows.map(row => row.id);
  const identityHashes = Array.from(
    new Set(
      orderRows.flatMap(row => customerIdentityHashes(input.tenantId, row))
    )
  );
  const pipelineIds = commercialRows.flatMap(row =>
    row.pipeline?.id ? [row.pipeline.id] : []
  );
  const [payments, churnRows, recoveries, followUps] = await Promise.all([
    orderIds.length
      ? db
          .select()
          .from(orderPaymentProjections)
          .where(
            and(
              eq(orderPaymentProjections.tenantId, input.tenantId),
              inArray(orderPaymentProjections.orderId, orderIds)
            )
          )
      : [],
    identityHashes.length
      ? db
          .select()
          .from(customerChurnSnapshots)
          .where(
            and(
              eq(customerChurnSnapshots.tenantId, input.tenantId),
              inArray(customerChurnSnapshots.customerKeyHash, identityHashes)
            )
          )
          .orderBy(desc(customerChurnSnapshots.createdAt))
      : [],
    identityHashes.length
      ? db
          .select()
          .from(customerRecoveryInterventions)
          .where(
            and(
              eq(customerRecoveryInterventions.tenantId, input.tenantId),
              inArray(
                customerRecoveryInterventions.customerKeyHash,
                identityHashes
              )
            )
          )
          .orderBy(desc(customerRecoveryInterventions.updatedAt))
      : [],
    pipelineIds.length
      ? db
          .select()
          .from(commercialFollowUps)
          .where(
            and(
              eq(commercialFollowUps.tenantId, input.tenantId),
              inArray(commercialFollowUps.pipelineId, pipelineIds)
            )
          )
          .orderBy(desc(commercialFollowUps.createdAt))
      : [],
  ]);

  const paymentByOrder = new Map(
    payments.map(payment => [payment.orderId, payment])
  );
  const grouped = new Map(
    groupCustomerRecords(input.tenantId, orderRows, row => row).map(group => [
      group.key,
      group.records,
    ])
  );

  const residential: CustomerAsset[] = Array.from(grouped.values()).map(
    group => {
      const latest = group[0]!;
      const hash = customerIdentityHash(input.tenantId, latest);
      const compatibleHashes = new Set(
        group.flatMap(order => customerIdentityHashes(input.tenantId, order))
      );
      const paidTotal = group.reduce((sum, order) => {
        const payment = paymentByOrder.get(order.id);
        return (
          sum + (payment?.netPaidCents ?? (order.paid ? cents(order.total) : 0))
        );
      }, 0);
      const outstanding = group.reduce((sum, order) => {
        const payment = paymentByOrder.get(order.id);
        const isPaid = payment
          ? ["paid", "partially_refunded"].includes(payment.state)
          : order.paid;
        return (
          sum +
          (isPaid || order.status === "cancelled" ? 0 : cents(order.total))
        );
      }, 0);
      const completed = group.filter(order => order.status === "delivered");
      const churn = churnRows.find(row =>
        compatibleHashes.has(row.customerKeyHash)
      );
      const recovery = recoveries.find(row =>
        compatibleHashes.has(row.customerKeyHash)
      );
      const name =
        `${latest.firstName} ${latest.lastName}`.trim() || "Customer";
      return {
        id: customerAssetId(input.tenantId, latest),
        kind: "residential" as const,
        displayName: name,
        identityKey: hash,
        property: {
          address: latest.address || null,
          unit: latest.unit ?? null,
          buildingSlug: latest.buildingSlug ?? null,
          latitude: null,
          longitude: null,
          geoStatus: "unresolved" as const,
        },
        contact: { phone: latest.phone || null, email: latest.email ?? null },
        service: {
          orderCount: group.length,
          completedCount: completed.length,
          lastServiceAt: iso((completed[0] ?? latest).updatedAt),
          recurring: group.length >= 2,
          serviceTypes: Array.from(
            new Set(group.map(order => order.serviceType))
          ),
        },
        lifetimeValue: sourcedFact(
          paidTotal,
          "orders + order_payment_projections"
        ),
        outstandingReceivables: sourcedFact(
          outstanding,
          "orders + order_payment_projections"
        ),
        averageOrderValue: group.length
          ? deterministicEstimate(
              Math.round(
                group.reduce((sum, order) => sum + cents(order.total), 0) /
                  group.length
              ),
              "orders arithmetic",
              "high"
            )
          : unknownValue("No orders available"),
        health:
          churn?.grade === "high"
            ? ("at_risk" as const)
            : churn?.grade === "medium"
              ? ("watch" as const)
              : churn
                ? ("healthy" as const)
                : ("unknown" as const),
        healthReason:
          churn?.reasonsJson && Array.isArray(churn.reasonsJson)
            ? String(churn.reasonsJson[0] ?? "Churn scan available")
            : "No current churn scan",
        recovery: {
          status: recovery?.status ?? null,
          interventionId: recovery?.id ?? null,
        },
        commercial: null,
        nextAction:
          outstanding > 0
            ? {
                label: "Resolve payment",
                path: `/payment-reconciliation?customer=${encodeURIComponent(latest.phone)}`,
              }
            : null,
        timeline: group
          .flatMap(order => {
            const payment = paymentByOrder.get(order.id);
            const entries: CustomerAssetTimelineItem[] = [
              {
                id: `order:${order.id}`,
                occurredAt: order.createdAt.toISOString(),
                type: "order" as const,
                title: `${order.serviceType === "wash_fold" ? "Laundry" : "Dry cleaning"} order #${order.id} · ${order.status}`,
                sourceReference: `orders:${order.id}`,
                verificationClass: "VERIFIED" as const,
                amountCents: cents(order.total),
              },
            ];
            if (payment?.paidAt)
              entries.push({
                id: `payment:${payment.orderId}`,
                occurredAt: payment.paidAt.toISOString(),
                type: "payment" as const,
                title: `Payment ${payment.state}`,
                sourceReference: `order_payment_projections:${payment.orderId}`,
                verificationClass: "VERIFIED" as const,
                amountCents: payment.netPaidCents,
              });
            return entries;
          })
          .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
        dataQuality: {
          status: churn ? ("trusted" as const) : ("partial" as const),
          warnings: [
            "Residential order addresses do not currently carry verified coordinates",
            ...(churn ? [] : ["No current churn scan for this customer"]),
          ],
          sources: [
            "orders",
            "order_payment_projections",
            ...(churn ? ["customer_churn_snapshots"] : []),
          ],
        },
      };
    }
  );

  const commercialByAccount = new Map<number, typeof commercialRows>();
  for (const row of commercialRows) {
    const group = commercialByAccount.get(row.account.id) ?? [];
    group.push(row);
    commercialByAccount.set(row.account.id, group);
  }
  const commercial: CustomerAsset[] = Array.from(
    commercialByAccount.values()
  ).map(group => {
    const row = group[0]!;
    const location =
      group.find(item => item.location?.isPrimary)?.location ?? row.location;
    const contact =
      group.find(item => item.contact?.email || item.contact?.phone)?.contact ??
      row.contact;
    const pipeline = group.find(item => item.pipeline)?.pipeline ?? null;
    const opportunity =
      group.find(item => item.opportunity)?.opportunity ?? null;
    const accountFollowUps = pipeline
      ? followUps.filter(item => item.pipelineId === pipeline.id)
      : [];
    return {
      id: `commercial:${row.account.id}`,
      kind: "commercial" as const,
      displayName: row.account.name,
      identityKey: row.account.identityKey ?? `account:${row.account.id}`,
      property: {
        address: location?.address ?? null,
        unit: null,
        buildingSlug: null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        geoStatus:
          location?.latitude && location?.longitude
            ? ("resolved" as const)
            : ("unresolved" as const),
      },
      contact: { phone: contact?.phone ?? null, email: contact?.email ?? null },
      service: {
        orderCount: 0,
        completedCount: 0,
        lastServiceAt: null,
        recurring: pipeline?.stage === "won",
        serviceTypes: [row.account.accountType],
      },
      lifetimeValue: sourcedFact(
        pipeline?.realizedRevenueCents ?? 0,
        `commercial_pipeline_records:${pipeline?.id ?? "none"}`
      ),
      outstandingReceivables: unknownValue(
        "Commercial receivables require attributed invoices"
      ),
      averageOrderValue: unknownValue(
        "No attributable order average available"
      ),
      health:
        pipeline?.stage === "lost"
          ? ("at_risk" as const)
          : accountFollowUps.some(
                item => item.status === "open" && item.dueAt < new Date()
              )
            ? ("watch" as const)
            : pipeline
              ? ("healthy" as const)
              : ("unknown" as const),
      healthReason: pipeline
        ? `Commercial stage: ${pipeline.stage}`
        : "No commercial pipeline record",
      recovery: { status: null, interventionId: null },
      commercial: {
        accountId: row.account.id,
        stage: pipeline?.stage ?? null,
        estimatedAnnualValue:
          opportunity?.estimatedAnnualValueCents != null
            ? deterministicEstimate(
                opportunity.estimatedAnnualValueCents,
                `commercial_opportunities:${opportunity.id}`,
                opportunity.estimateConfidence
              )
            : unknownValue("No scored commercial estimate"),
        approvedValue:
          pipeline?.approvedContractValueCents != null
            ? sourcedFact(
                pipeline.approvedContractValueCents,
                `commercial_pipeline_records:${pipeline.id}`
              )
            : unknownValue("No approved agreement value"),
        realizedRevenue: sourcedFact(
          pipeline?.realizedRevenueCents ?? 0,
          `commercial_pipeline_records:${pipeline?.id ?? "none"}`
        ),
      },
      nextAction: accountFollowUps.find(item => item.status === "open")
        ? {
            label: "Open follow-up",
            path: `/commercial-pipeline?pipeline=${pipeline!.id}`,
          }
        : pipeline
          ? {
              label: "Open relationship",
              path: `/commercial-pipeline?pipeline=${pipeline.id}`,
            }
          : null,
      timeline: [
        ...(pipeline
          ? [
              {
                id: `pipeline:${pipeline.id}`,
                occurredAt: pipeline.updatedAt.toISOString(),
                type: "commercial_stage" as const,
                title: `Pipeline stage: ${pipeline.stage}`,
                sourceReference: `commercial_pipeline_records:${pipeline.id}`,
                verificationClass: "VERIFIED" as const,
                amountCents: pipeline.realizedRevenueCents,
              },
            ]
          : []),
        ...accountFollowUps.map(item => ({
          id: `follow-up:${item.id}`,
          occurredAt: item.createdAt.toISOString(),
          type: "follow_up" as const,
          title: `${item.status === "completed" ? "Completed" : "Scheduled"} follow-up`,
          sourceReference: `commercial_follow_ups:${item.id}`,
          verificationClass:
            item.status === "completed"
              ? ("ATTESTED" as const)
              : ("VERIFIED" as const),
          amountCents: null,
        })),
      ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
      dataQuality: {
        status:
          location && pipeline ? ("trusted" as const) : ("partial" as const),
        warnings: [
          ...(!location ? ["No commercial location"] : []),
          ...(!pipeline ? ["No pipeline record"] : []),
          ...(location && (!location.latitude || !location.longitude)
            ? ["Commercial location is not geocoded"]
            : []),
        ],
        sources: [
          "commercial_accounts",
          "commercial_account_locations",
          "commercial_pipeline_records",
          "commercial_opportunities",
        ],
      },
    };
  });
  return [...residential, ...commercial].sort(
    (a, b) =>
      b.lifetimeValue.value! - a.lifetimeValue.value! ||
      a.displayName.localeCompare(b.displayName)
  );
}
