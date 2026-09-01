import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import {
  customerChurnScans,
  customerChurnSnapshots,
  customerContactPermissions,
  customerRecoveryDrafts,
  customerRecoveryEvents,
  customerRecoveryInterventions,
  opsTaskEvents,
  opsTasks,
  orders,
  tenantCustomerRecoveryProfiles,
} from "../../drizzle/schema";
import {
  assertGroundedWinBackMessage,
  buildWinBackDraft,
  scoreCustomerChurn,
  type ChurnEvidence,
  type CustomerChurnScore,
  type CustomerHistoryObservation,
} from "@shared/customerChurn";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError as isDuplicateKeyError } from "../mysqlErrors";
import { writeDayforgeEventWith } from "../dayforgeEvents/dayforgeEventStore";
import { appendGoldlineWorldEvent } from "../goldlineWorld/worldEventStore";
import { findPhysicalEntityIdByAddress } from "../goldlineWorld/entityLookup";
import {
  groupCustomerRecords,
  customerIdentityHashes,
} from "../customerAssets/customerIdentity";

type OrderRow = typeof orders.$inferSelect;
type Transaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

const ACTIVE_INTERVENTION_STATUSES = [
  "draft_pending_review",
  "approved",
  "contacted",
] as const;

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
}

function cents(value: string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : 0;
}

function recoveredRevenueBand(centsValue: number): string {
  if (centsValue < 100_00) return "under_100";
  if (centsValue < 500_00) return "100_to_500";
  if (centsValue < 1_500_00) return "500_to_1500";
  return "1500_plus";
}

function normalizePhone(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

function contentHash(message: string): string {
  return createHash("sha256").update(message).digest("hex");
}

function maskPhone(phone: string): string {
  const digits = normalizePhone(phone);
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : "Unavailable";
}

function displayName(row: OrderRow): string {
  return `${row.firstName} ${row.lastName}`.trim() || "Customer";
}

function completedServiceAt(row: OrderRow): Date {
  return row.paidAt ?? row.updatedAt ?? row.createdAt;
}

function isCompletedHistory(row: OrderRow): boolean {
  return row.paid || row.status === "delivered";
}

function isActiveOrder(row: OrderRow): boolean {
  return !row.paid && !["delivered", "cancelled"].includes(row.status);
}

function serviceLabel(value: OrderRow["serviceType"]): string {
  return value === "wash_fold" ? "wash & fold" : "dry cleaning";
}

function evidenceForScore(
  score: CustomerChurnScore,
  history: CustomerHistoryObservation[]
): ChurnEvidence[] {
  const ids = history.map(item => item.orderId);
  const withWeight = history.filter(item => item.weightLbs !== null);
  return [
    {
      kind: "sourced_fact",
      label: "Completed order history",
      value: `${history.length} completed orders`,
      source: "orders",
      sourceIds: ids,
    },
    {
      kind: "sourced_fact",
      label: "Last completed service",
      value: new Date(score.lastServiceAt).toISOString(),
      source: "orders.paidAt or orders.updatedAt",
      sourceIds: [history.at(-1)!.orderId],
    },
    {
      kind: "calculation",
      label: "Expected cadence",
      value: `${score.expectedCadenceDays} days (median completed-order interval)`,
      source: "orders",
      sourceIds: ids,
    },
    {
      kind: "estimate",
      label: "Monthly revenue impact",
      value: `${score.estimatedMonthlyImpactCents} cents (average order value × inferred monthly cadence)`,
      source: "orders.total and calculated cadence",
      sourceIds: ids,
    },
    withWeight.length >= 4
      ? {
          kind: "calculation",
          label: "Recent poundage change",
          value: `${score.recentVolumeChangePct ?? 0}%`,
          source: "orders.weightLbs",
          sourceIds: withWeight.map(item => item.orderId),
        }
      : {
          kind: "unavailable",
          label: "Recent poundage change",
          value: "Fewer than four completed orders have weight data",
          source: "orders.weightLbs",
          sourceIds: withWeight.map(item => item.orderId),
        },
    {
      kind: "unavailable",
      label: "Unresolved service issue",
      value: "No structured unresolved-issue source is configured",
      source: "not available",
      sourceIds: [],
    },
  ];
}

function snapshotResponse(row: typeof customerChurnSnapshots.$inferSelect) {
  return {
    id: row.id,
    customerKey: row.customerKeyHash,
    scanId: row.scanId,
    customerName: row.customerName,
    customerPhoneMasked: maskPhone(row.customerPhone),
    score: row.score,
    grade: row.grade,
    confidence: row.confidence,
    historyOrderCount: row.historyOrderCount,
    expectedCadenceDays: row.expectedCadenceDays,
    lastServiceAt: row.lastServiceAt.toISOString(),
    daysSinceLastOrder: row.daysSinceLastOrder,
    daysLate: row.daysLate,
    averageOrderValueCents: row.averageOrderValueCents,
    estimatedMonthlyImpactCents: row.estimatedMonthlyImpactCents,
    recentVolumeChangePct: row.recentVolumeChangePct,
    activeOrderCount: row.activeOrderCount,
    recommendedAction: row.recommendedAction,
    lastServiceLabel: row.lastServiceLabel,
    reasons: row.reasonsJson as string[],
    evidence: row.evidenceJson as ChurnEvidence[],
  };
}

export async function getCustomerRecoveryProfile(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(tenantCustomerRecoveryProfiles)
    .where(eq(tenantCustomerRecoveryProfiles.tenantId, tenantId))
    .limit(1);
  return rows[0]
    ? {
        storeName: rows[0].storeName,
        senderName: rows[0].senderName,
        schedulingUrl: rows[0].schedulingUrl,
      }
    : null;
}

export async function saveCustomerRecoveryProfile(input: {
  tenantId: string;
  actorId: string;
  storeName: string;
  senderName: string;
  schedulingUrl: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(tenantCustomerRecoveryProfiles)
    .values({
      tenantId: input.tenantId,
      storeName: input.storeName,
      senderName: input.senderName,
      schedulingUrl: input.schedulingUrl,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onDuplicateKeyUpdate({
      set: {
        storeName: input.storeName,
        senderName: input.senderName,
        schedulingUrl: input.schedulingUrl,
        updatedBy: input.actorId,
      },
    });
  return getCustomerRecoveryProfile(input.tenantId);
}

async function getChurnScanByRequest(input: {
  tenantId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(customerChurnScans)
    .where(
      and(
        eq(customerChurnScans.tenantId, input.tenantId),
        eq(customerChurnScans.requestId, input.requestId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getChurnScanResult(input: {
  tenantId: string;
  scanId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [scans, snapshots] = await Promise.all([
    db
      .select()
      .from(customerChurnScans)
      .where(
        and(
          eq(customerChurnScans.tenantId, input.tenantId),
          eq(customerChurnScans.id, input.scanId)
        )
      )
      .limit(1),
    db
      .select()
      .from(customerChurnSnapshots)
      .where(
        and(
          eq(customerChurnSnapshots.tenantId, input.tenantId),
          eq(customerChurnSnapshots.scanId, input.scanId)
        )
      )
      .orderBy(desc(customerChurnSnapshots.score)),
  ]);
  const scan = scans[0];
  if (!scan) return null;
  return {
    id: scan.id,
    status: scan.status,
    sourceOrderCount: scan.sourceOrderCount,
    customerCount: scan.customerCount,
    atRiskCount: scan.atRiskCount,
    errorMessage: scan.errorMessage,
    computedAt: scan.computedAt?.toISOString() ?? null,
    customers: snapshots.map(snapshotResponse),
  };
}

export async function getLatestChurnScan(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ id: customerChurnScans.id })
    .from(customerChurnScans)
    .where(eq(customerChurnScans.tenantId, tenantId))
    .orderBy(desc(customerChurnScans.createdAt))
    .limit(1);
  return rows[0] ? getChurnScanResult({ tenantId, scanId: rows[0].id }) : null;
}

export async function runCustomerChurnScan(input: {
  tenantId: string;
  actorId: string;
  requestId: string;
  now?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const replay = await getChurnScanByRequest(input);
  if (replay)
    return getChurnScanResult({ tenantId: input.tenantId, scanId: replay.id });

  const scanId = randomUUID();
  try {
    await db.insert(customerChurnScans).values({
      id: scanId,
      tenantId: input.tenantId,
      requestId: input.requestId,
      createdBy: input.actorId,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const concurrent = await getChurnScanByRequest(input);
    if (!concurrent) throw error;
    return getChurnScanResult({
      tenantId: input.tenantId,
      scanId: concurrent.id,
    });
  }

  try {
    const sourceRows = await db
      .select()
      .from(orders)
      .where(sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`)
      .orderBy(orders.createdAt, orders.id);
    const grouped = new Map(
      groupCustomerRecords(input.tenantId, sourceRows, row => row).map(
        group => [group.key, group.records]
      )
    );

    const snapshots: Array<typeof customerChurnSnapshots.$inferInsert> = [];
    for (const [keyHash, group] of Array.from(grouped.entries())) {
      const completed = group
        .filter(isCompletedHistory)
        .sort(
          (a: OrderRow, b: OrderRow) =>
            completedServiceAt(a).getTime() - completedServiceAt(b).getTime()
        );
      if (completed.length < 2) continue;
      const latest = completed.at(-1)!;
      const history: CustomerHistoryObservation[] = completed.map(row => ({
        orderId: row.id,
        serviceAt: completedServiceAt(row),
        valueCents: cents(row.total),
        weightLbs: row.weightLbs === null ? null : Number(row.weightLbs),
        serviceType: row.serviceType,
      }));
      const score = scoreCustomerChurn({
        customerKey: keyHash,
        customerName: displayName(latest),
        history,
        activeOrderCount: group.filter(isActiveOrder).length,
        now: input.now,
      });
      snapshots.push({
        id: randomUUID(),
        tenantId: input.tenantId,
        scanId,
        customerKeyHash: keyHash,
        customerName: displayName(latest),
        customerPhone: latest.phone,
        lastOrderId: latest.id,
        score: score.score,
        grade: score.grade,
        confidence: score.confidence,
        historyOrderCount: score.historyOrderCount,
        expectedCadenceDays: score.expectedCadenceDays,
        lastServiceAt: new Date(score.lastServiceAt),
        daysSinceLastOrder: score.daysSinceLastOrder,
        daysLate: score.daysLate,
        averageOrderValueCents: score.averageOrderValueCents,
        estimatedMonthlyImpactCents: score.estimatedMonthlyImpactCents,
        recentVolumeChangePct: score.recentVolumeChangePct,
        activeOrderCount: score.activeOrderCount,
        recommendedAction: score.recommendedAction,
        lastServiceLabel: serviceLabel(latest.serviceType),
        reasonsJson: score.reasons,
        evidenceJson: evidenceForScore(score, history),
        sourceOrderIdsJson: history.map(item => item.orderId),
      });
    }

    await db.transaction(async tx => {
      if (snapshots.length > 0)
        await tx.insert(customerChurnSnapshots).values(snapshots);
      for (const snapshot of snapshots.filter(
        item => (item.score ?? 0) >= 40
      )) {
        const correlationId = `churn-scan:${scanId}`;
        await writeDayforgeEventWith(tx, {
          tenantId: input.tenantId,
          actor: { type: "system", id: "dayforge-churn-radar" },
          entityType: "customer_churn_snapshot",
          entityId: snapshot.id,
          eventName: "churn_risk_detected",
          before: null,
          after: {
            snapshotId: snapshot.id,
            scanId,
            score: snapshot.score,
            grade: snapshot.grade,
            confidence: snapshot.confidence,
            historyOrderCount: snapshot.historyOrderCount,
            signalCount: Array.isArray(snapshot.reasonsJson)
              ? snapshot.reasonsJson.length
              : 0,
          },
          source: "churn_radar",
          correlationId,
          idempotencyKey: `${correlationId}:snapshot:${snapshot.id}:risk`,
          productEvent: {
            name: "churn_risk_detected",
            properties: {
              riskBand: snapshot.grade,
              confidenceBand: snapshot.confidence,
              signalCount: Array.isArray(snapshot.reasonsJson)
                ? snapshot.reasonsJson.length
                : 0,
            },
          },
        });
      }
      await tx
        .update(customerChurnScans)
        .set({
          status: "completed",
          sourceOrderCount: sourceRows.length,
          customerCount: snapshots.length,
          atRiskCount: snapshots.filter(item => (item.score ?? 0) >= 40).length,
          computedAt: input.now ?? new Date(),
        })
        .where(
          and(
            eq(customerChurnScans.tenantId, input.tenantId),
            eq(customerChurnScans.id, scanId),
            eq(customerChurnScans.status, "running")
          )
        );
    });
  } catch (error) {
    await db
      .update(customerChurnScans)
      .set({
        status: "failed",
        errorMessage:
          error instanceof Error
            ? error.message.slice(0, 1_000)
            : "Scan failed",
        computedAt: new Date(),
      })
      .where(
        and(
          eq(customerChurnScans.tenantId, input.tenantId),
          eq(customerChurnScans.id, scanId)
        )
      );
    throw error;
  }
  return getChurnScanResult({ tenantId: input.tenantId, scanId });
}

async function getDraftByRequest(input: {
  tenantId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(customerRecoveryDrafts)
    .where(
      and(
        eq(customerRecoveryDrafts.tenantId, input.tenantId),
        eq(customerRecoveryDrafts.requestId, input.requestId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

async function getInterventionByRequest(input: {
  tenantId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(customerRecoveryInterventions)
    .where(
      and(
        eq(customerRecoveryInterventions.tenantId, input.tenantId),
        eq(customerRecoveryInterventions.requestId, input.requestId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

function effectivePermission(
  permission: typeof customerContactPermissions.$inferSelect | null
) {
  if (!permission)
    return {
      status: "unknown" as const,
      sourceReference: null,
      capturedAt: null,
      expiresAt: null,
      composerAllowed: false,
    };
  const expired =
    permission.expiresAt !== null &&
    permission.expiresAt.getTime() <= Date.now();
  return {
    status: expired ? ("expired" as const) : permission.status,
    sourceReference: permission.sourceReference,
    capturedAt: permission.capturedAt.toISOString(),
    expiresAt: permission.expiresAt?.toISOString() ?? null,
    composerAllowed: permission.status === "opted_in" && !expired,
  };
}

export async function getRecoveryInterventionDetail(input: {
  tenantId: string;
  interventionId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const interventions = await db
    .select()
    .from(customerRecoveryInterventions)
    .where(
      and(
        eq(customerRecoveryInterventions.tenantId, input.tenantId),
        eq(customerRecoveryInterventions.id, input.interventionId)
      )
    )
    .limit(1);
  const intervention = interventions[0];
  if (!intervention) return null;
  const [snapshots, drafts, permissions] = await Promise.all([
    db
      .select()
      .from(customerChurnSnapshots)
      .where(
        and(
          eq(customerChurnSnapshots.tenantId, input.tenantId),
          eq(customerChurnSnapshots.id, intervention.churnSnapshotId)
        )
      )
      .limit(1),
    db
      .select()
      .from(customerRecoveryDrafts)
      .where(
        and(
          eq(customerRecoveryDrafts.tenantId, input.tenantId),
          eq(customerRecoveryDrafts.interventionId, intervention.id)
        )
      )
      .orderBy(desc(customerRecoveryDrafts.version))
      .limit(1),
    db
      .select()
      .from(customerContactPermissions)
      .where(
        and(
          eq(customerContactPermissions.tenantId, input.tenantId),
          eq(
            customerContactPermissions.customerKeyHash,
            intervention.customerKeyHash
          ),
          eq(customerContactPermissions.channel, "sms"),
          eq(customerContactPermissions.purpose, "win_back_marketing")
        )
      )
      .limit(1),
  ]);
  const snapshot = snapshots[0];
  const draft = drafts[0];
  if (!snapshot || !draft)
    throw new Error("Recovery intervention is missing its persisted snapshot");
  return {
    id: intervention.id,
    status: intervention.status,
    opsTaskId: intervention.opsTaskId,
    assignedTo: intervention.assignedTo,
    approvedBy: intervention.approvedBy,
    approvedAt: intervention.approvedAt?.toISOString() ?? null,
    contactedAt: intervention.contactedAt?.toISOString() ?? null,
    recoveredAt: intervention.recoveredAt?.toISOString() ?? null,
    recoveredOrderId: intervention.recoveredOrderId,
    recoveredRevenueCents: intervention.recoveredRevenueCents,
    customer: snapshotResponse(snapshot),
    permission: effectivePermission(permissions[0] ?? null),
    draft: {
      id: draft.id,
      version: draft.version,
      status: draft.status,
      channel: draft.channel,
      message: draft.message,
      factsUsed: draft.factsUsedJson as string[],
      contentHash: draft.contentHash,
      approvedBy: draft.approvedBy,
      approvedAt: draft.approvedAt?.toISOString() ?? null,
    },
  };
}

export async function listRecoveryInterventions(tenantId: string) {
  await refreshCustomerRecoveryAttribution(tenantId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({ id: customerRecoveryInterventions.id })
    .from(customerRecoveryInterventions)
    .where(eq(customerRecoveryInterventions.tenantId, tenantId))
    .orderBy(desc(customerRecoveryInterventions.updatedAt))
    .limit(100);
  const details = await Promise.all(
    rows.map(row =>
      getRecoveryInterventionDetail({ tenantId, interventionId: row.id })
    )
  );
  return details.filter(
    (detail): detail is NonNullable<typeof detail> => !!detail
  );
}

export async function createCustomerRecoveryIntervention(input: {
  tenantId: string;
  snapshotId: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const replay = await getInterventionByRequest(input);
  if (replay)
    return getRecoveryInterventionDetail({
      tenantId: input.tenantId,
      interventionId: replay.id,
    });

  let interventionId: string | null = null;
  try {
    interventionId = await db.transaction(async tx => {
      const snapshots = await tx
        .select()
        .from(customerChurnSnapshots)
        .where(
          and(
            eq(customerChurnSnapshots.tenantId, input.tenantId),
            eq(customerChurnSnapshots.id, input.snapshotId)
          )
        )
        .for("update")
        .limit(1);
      const snapshot = snapshots[0];
      if (!snapshot) throw new Error("Churn snapshot not found");
      if (snapshot.score < 40 || snapshot.activeOrderCount > 0)
        throw new Error("This customer is not eligible for a win-back mission");

      const relatedOrders = await tx
        .select()
        .from(orders)
        .where(
          sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`
        );
      const customerKeys = new Set([snapshot.customerKeyHash]);
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const order of relatedOrders) {
          const aliases = customerIdentityHashes(input.tenantId, order);
          if (!aliases.some(alias => customerKeys.has(alias))) continue;
          for (const alias of aliases) {
            if (customerKeys.has(alias)) continue;
            customerKeys.add(alias);
            expanded = true;
          }
        }
      }

      const active = await tx
        .select({ id: customerRecoveryInterventions.id })
        .from(customerRecoveryInterventions)
        .where(
          and(
            eq(customerRecoveryInterventions.tenantId, input.tenantId),
            inArray(
              customerRecoveryInterventions.customerKeyHash,
              Array.from(customerKeys)
            ),
            inArray(customerRecoveryInterventions.status, [
              ...ACTIVE_INTERVENTION_STATUSES,
            ])
          )
        )
        .for("update")
        .limit(1);
      if (active[0]) return active[0].id;

      const profiles = await tx
        .select()
        .from(tenantCustomerRecoveryProfiles)
        .where(eq(tenantCustomerRecoveryProfiles.tenantId, input.tenantId))
        .limit(1);
      const profile = profiles[0];
      if (!profile)
        throw new Error(
          "Configure the customer recovery profile before preparing a draft"
        );
      const score: CustomerChurnScore = {
        customerKey: snapshot.customerKeyHash,
        customerName: snapshot.customerName,
        score: snapshot.score,
        grade: snapshot.grade,
        confidence: snapshot.confidence,
        historyOrderCount: snapshot.historyOrderCount,
        expectedCadenceDays: snapshot.expectedCadenceDays,
        lastServiceAt: snapshot.lastServiceAt.toISOString(),
        daysSinceLastOrder: snapshot.daysSinceLastOrder,
        daysLate: snapshot.daysLate,
        averageOrderValueCents: snapshot.averageOrderValueCents,
        estimatedMonthlyImpactCents: snapshot.estimatedMonthlyImpactCents,
        recentVolumeChangePct: snapshot.recentVolumeChangePct,
        activeOrderCount: snapshot.activeOrderCount,
        reasons: snapshot.reasonsJson as string[],
        recommendedAction: snapshot.recommendedAction,
      };
      const generated = buildWinBackDraft({
        score,
        storeName: profile.storeName,
        senderName: profile.senderName,
        lastServiceLabel: snapshot.lastServiceLabel,
        schedulingLink: profile.schedulingUrl,
      });
      const id = randomUUID();
      const taskInsert = await tx.insert(opsTasks).values({
        tenantId: input.tenantId,
        lane: "lane_1",
        level: "1",
        taskType: "stale_customer",
        title: `Win back ${snapshot.customerName}`,
        description: (snapshot.reasonsJson as string[]).join(" · "),
        source: "system_detected",
        createdBy: input.actorId,
        assignedTo: input.actorId,
        status: "open",
        priority: snapshot.grade === "high" ? "high" : "normal",
        revenueAtRiskCents: snapshot.estimatedMonthlyImpactCents,
        revenueRecoveredCents: 0,
        orderId: snapshot.lastOrderId,
        metadataJson: {
          dayforgeRecoveryInterventionId: id,
          churnSnapshotId: snapshot.id,
          score: snapshot.score,
          confidence: snapshot.confidence,
        },
      });
      const opsTaskId = Number(taskInsert[0].insertId);
      await tx.insert(customerRecoveryInterventions).values({
        id,
        tenantId: input.tenantId,
        churnSnapshotId: snapshot.id,
        customerKeyHash: snapshot.customerKeyHash,
        activeCustomerKeyHash: snapshot.customerKeyHash,
        opsTaskId,
        requestId: input.requestId,
        assignedTo: input.actorId,
        createdBy: input.actorId,
      });
      const draftId = randomUUID();
      await tx.insert(customerRecoveryDrafts).values({
        id: draftId,
        tenantId: input.tenantId,
        interventionId: id,
        version: 1,
        message: generated.message,
        factsUsedJson: generated.factsUsed,
        contentHash: contentHash(generated.message),
        requestId: input.requestId,
        createdBy: input.actorId,
      });
      await tx.insert(customerRecoveryEvents).values({
        tenantId: input.tenantId,
        interventionId: id,
        eventName: "recovery_mission_created",
        actorId: input.actorId,
        idempotencyKey: `recovery-created:${input.requestId}`,
        metadataJson: { opsTaskId, churnSnapshotId: snapshot.id, draftId },
      });
      const projectionCorrelationId = `recovery-intervention:${id}:${input.requestId}`;
      await writeDayforgeEventWith(tx, {
        tenantId: input.tenantId,
        actor: { type: "operator", id: input.actorId },
        entityType: "customer_recovery_intervention",
        entityId: id,
        eventName: "win_back_prepared",
        before: null,
        after: {
          interventionId: id,
          churnSnapshotId: snapshot.id,
          status: "draft_pending_review",
          draftVersion: 1,
        },
        source: "churn_radar",
        correlationId: projectionCorrelationId,
        idempotencyKey: `${projectionCorrelationId}:prepared`,
        productEvent: {
          name: "win_back_prepared",
          properties: { channel: "sms_manual", riskBand: snapshot.grade },
        },
      });
      await tx.insert(opsTaskEvents).values({
        tenantId: input.tenantId,
        taskId: opsTaskId,
        eventType: "agent_suggested",
        actorType: "system",
        actorId: "dayforge-churn-radar",
        afterJson: { recoveryInterventionId: id, draftId },
        note: "Churn Radar created a fact-grounded draft. No outreach sent.",
      });
      return id;
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const concurrent = await getInterventionByRequest(input);
    if (concurrent) {
      interventionId = concurrent.id;
    } else {
      const snapshots = await db
        .select({ customerKeyHash: customerChurnSnapshots.customerKeyHash })
        .from(customerChurnSnapshots)
        .where(
          and(
            eq(customerChurnSnapshots.tenantId, input.tenantId),
            eq(customerChurnSnapshots.id, input.snapshotId)
          )
        )
        .limit(1);
      const customerKey = snapshots[0]?.customerKeyHash;
      if (!customerKey) throw error;
      const active = await db
        .select({ id: customerRecoveryInterventions.id })
        .from(customerRecoveryInterventions)
        .where(
          and(
            eq(customerRecoveryInterventions.tenantId, input.tenantId),
            eq(customerRecoveryInterventions.activeCustomerKeyHash, customerKey)
          )
        )
        .limit(1);
      if (!active[0]) throw error;
      interventionId = active[0].id;
    }
  }
  if (!interventionId) throw new Error("Recovery mission was not persisted");
  return getRecoveryInterventionDetail({
    tenantId: input.tenantId,
    interventionId,
  });
}

export async function reviseCustomerRecoveryDraft(input: {
  tenantId: string;
  interventionId: string;
  actorId: string;
  requestId: string;
  message: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  assertGroundedWinBackMessage(input.message);
  const replay = await getDraftByRequest(input);
  if (replay)
    return getRecoveryInterventionDetail({
      tenantId: input.tenantId,
      interventionId: replay.interventionId,
    });
  try {
    await db.transaction(async tx => {
      const interventions = await tx
        .select()
        .from(customerRecoveryInterventions)
        .where(
          and(
            eq(customerRecoveryInterventions.tenantId, input.tenantId),
            eq(customerRecoveryInterventions.id, input.interventionId)
          )
        )
        .for("update")
        .limit(1);
      const intervention = interventions[0];
      if (!intervention) throw new Error("Recovery mission not found");
      if (!["draft_pending_review", "approved"].includes(intervention.status))
        throw new Error(`Draft cannot be revised from ${intervention.status}`);
      const drafts = await tx
        .select()
        .from(customerRecoveryDrafts)
        .where(
          and(
            eq(customerRecoveryDrafts.tenantId, input.tenantId),
            eq(customerRecoveryDrafts.interventionId, input.interventionId)
          )
        )
        .orderBy(desc(customerRecoveryDrafts.version))
        .for("update")
        .limit(1);
      const previous = drafts[0];
      if (!previous) throw new Error("Recovery draft not found");
      await tx
        .update(customerRecoveryDrafts)
        .set({ status: "superseded" })
        .where(
          and(
            eq(customerRecoveryDrafts.tenantId, input.tenantId),
            eq(customerRecoveryDrafts.interventionId, input.interventionId),
            ne(customerRecoveryDrafts.status, "void")
          )
        );
      const nextId = randomUUID();
      await tx.insert(customerRecoveryDrafts).values({
        id: nextId,
        tenantId: input.tenantId,
        interventionId: input.interventionId,
        version: previous.version + 1,
        message: input.message,
        factsUsedJson: previous.factsUsedJson,
        contentHash: contentHash(input.message),
        requestId: input.requestId,
        createdBy: input.actorId,
      });
      await tx
        .update(customerRecoveryInterventions)
        .set({
          status: "draft_pending_review",
          approvedBy: null,
          approvedAt: null,
        })
        .where(
          and(
            eq(customerRecoveryInterventions.tenantId, input.tenantId),
            eq(customerRecoveryInterventions.id, input.interventionId)
          )
        );
      await tx.insert(customerRecoveryEvents).values({
        tenantId: input.tenantId,
        interventionId: input.interventionId,
        eventName: "draft_revised",
        actorId: input.actorId,
        idempotencyKey: `recovery-draft-revised:${input.requestId}`,
        metadataJson: {
          fromVersion: previous.version,
          toVersion: previous.version + 1,
          contentHash: contentHash(input.message),
        },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const concurrent = await getDraftByRequest(input);
    if (!concurrent) throw error;
  }
  return getRecoveryInterventionDetail(input);
}

export async function approveCustomerRecoveryDraft(input: {
  tenantId: string;
  interventionId: string;
  draftId: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const replay = await tx
        .select({ id: customerRecoveryEvents.id })
        .from(customerRecoveryEvents)
        .where(
          and(
            eq(customerRecoveryEvents.tenantId, input.tenantId),
            eq(
              customerRecoveryEvents.idempotencyKey,
              `recovery-draft-approved:${input.requestId}`
            )
          )
        )
        .limit(1);
      if (replay[0]) return;
      const interventions = await tx
        .select()
        .from(customerRecoveryInterventions)
        .where(
          and(
            eq(customerRecoveryInterventions.tenantId, input.tenantId),
            eq(customerRecoveryInterventions.id, input.interventionId)
          )
        )
        .for("update")
        .limit(1);
      const intervention = interventions[0];
      if (!intervention) throw new Error("Recovery mission not found");
      if (
        intervention.status !== "draft_pending_review" &&
        intervention.status !== "approved"
      )
        throw new Error(`Draft cannot be approved from ${intervention.status}`);
      const drafts = await tx
        .select()
        .from(customerRecoveryDrafts)
        .where(
          and(
            eq(customerRecoveryDrafts.tenantId, input.tenantId),
            eq(customerRecoveryDrafts.interventionId, input.interventionId)
          )
        )
        .orderBy(desc(customerRecoveryDrafts.version))
        .for("update");
      const target = drafts.find(draft => draft.id === input.draftId);
      if (!target) throw new Error("Recovery draft not found");
      const latestVersion = Math.max(...drafts.map(draft => draft.version));
      if (intervention.status === "approved") {
        if (target.version !== latestVersion || target.status !== "approved")
          throw new Error("A different recovery draft is already approved");
        return;
      }
      if (target.version !== latestVersion || target.status !== "draft")
        throw new Error("Only the latest draft can be approved");
      const draftUpdate = await tx
        .update(customerRecoveryDrafts)
        .set({
          status: "approved",
          approvedBy: input.actorId,
          approvedAt: new Date(),
        })
        .where(
          and(
            eq(customerRecoveryDrafts.tenantId, input.tenantId),
            eq(customerRecoveryDrafts.id, input.draftId),
            eq(customerRecoveryDrafts.status, "draft")
          )
        );
      if (affectedRows(draftUpdate) !== 1)
        throw new Error("Draft approval lost a concurrency race");
      await tx
        .update(customerRecoveryInterventions)
        .set({
          status: "approved",
          approvedBy: input.actorId,
          approvedAt: new Date(),
        })
        .where(
          and(
            eq(customerRecoveryInterventions.tenantId, input.tenantId),
            eq(customerRecoveryInterventions.id, input.interventionId)
          )
        );
      await tx.insert(customerRecoveryEvents).values({
        tenantId: input.tenantId,
        interventionId: input.interventionId,
        eventName: "draft_approved",
        actorId: input.actorId,
        idempotencyKey: `recovery-draft-approved:${input.requestId}`,
        metadataJson: {
          draftId: target.id,
          version: target.version,
          contentHash: target.contentHash,
          outreachSent: false,
        },
      });
      const projectionCorrelationId = `recovery-intervention:${input.interventionId}:${input.requestId}`;
      await writeDayforgeEventWith(tx, {
        tenantId: input.tenantId,
        actor: { type: "operator", id: input.actorId },
        entityType: "customer_recovery_intervention",
        entityId: input.interventionId,
        eventName: "win_back_approved",
        before: {
          interventionId: input.interventionId,
          status: intervention.status,
          draftVersion: target.version,
        },
        after: {
          interventionId: input.interventionId,
          status: "approved",
          draftVersion: target.version,
        },
        source: "churn_radar",
        correlationId: projectionCorrelationId,
        idempotencyKey: `${projectionCorrelationId}:approved`,
        productEvent: {
          name: "win_back_approved",
          properties: {
            channel: "sms_manual",
            approvalSource: "tenant_operator",
          },
        },
      });
      await tx.insert(opsTaskEvents).values({
        tenantId: input.tenantId,
        taskId: intervention.opsTaskId,
        eventType: "human_approved",
        actorType: "human",
        actorId: input.actorId,
        afterJson: { draftId: target.id, version: target.version },
        note: "Message content approved. No outreach sent.",
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const detail = await getRecoveryInterventionDetail(input);
  if (!detail || detail.status !== "approved")
    throw new Error("Draft approval was not persisted");
  return detail;
}

export async function setCustomerRecoveryPermission(input: {
  tenantId: string;
  interventionId: string;
  actorId: string;
  requestId: string;
  status: "opted_in" | "opted_out";
  sourceReference: string;
  capturedAt: Date;
  expiresAt: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const detail = await getRecoveryInterventionDetail(input);
  if (!detail) throw new Error("Recovery mission not found");
  const interventions = await db
    .select({ customerKeyHash: customerRecoveryInterventions.customerKeyHash })
    .from(customerRecoveryInterventions)
    .where(
      and(
        eq(customerRecoveryInterventions.tenantId, input.tenantId),
        eq(customerRecoveryInterventions.id, input.interventionId)
      )
    )
    .limit(1);
  const customerKey = interventions[0]?.customerKeyHash;
  if (!customerKey) throw new Error("Recovery customer identity is missing");
  try {
    await db.transaction(async tx => {
      const replay = await tx
        .select({ id: customerRecoveryEvents.id })
        .from(customerRecoveryEvents)
        .where(
          and(
            eq(customerRecoveryEvents.tenantId, input.tenantId),
            eq(
              customerRecoveryEvents.idempotencyKey,
              `recovery-permission:${input.requestId}`
            )
          )
        )
        .limit(1);
      if (replay[0]) return;
      await tx
        .insert(customerContactPermissions)
        .values({
          tenantId: input.tenantId,
          customerKeyHash: customerKey,
          status: input.status,
          sourceReference: input.sourceReference,
          capturedAt: input.capturedAt,
          expiresAt: input.expiresAt,
          recordedBy: input.actorId,
        })
        .onDuplicateKeyUpdate({
          set: {
            status: input.status,
            sourceReference: input.sourceReference,
            capturedAt: input.capturedAt,
            expiresAt: input.expiresAt,
            recordedBy: input.actorId,
          },
        });
      await tx.insert(customerRecoveryEvents).values({
        tenantId: input.tenantId,
        interventionId: input.interventionId,
        eventName: "contact_permission_recorded",
        actorId: input.actorId,
        idempotencyKey: `recovery-permission:${input.requestId}`,
        metadataJson: {
          status: input.status,
          sourceReference: input.sourceReference,
          capturedAt: input.capturedAt.toISOString(),
          expiresAt: input.expiresAt?.toISOString() ?? null,
        },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  return getRecoveryInterventionDetail(input);
}

async function readManualContactReadyWith(
  tx: Transaction,
  input: {
    tenantId: string;
    interventionId: string;
    draftId: string;
    contentHash: string;
  },
  lockedIntervention?: typeof customerRecoveryInterventions.$inferSelect
) {
  let intervention = lockedIntervention;
  if (!intervention) {
    const interventions = await tx
      .select()
      .from(customerRecoveryInterventions)
      .where(
        and(
          eq(customerRecoveryInterventions.tenantId, input.tenantId),
          eq(customerRecoveryInterventions.id, input.interventionId)
        )
      )
      .for("update")
      .limit(1);
    intervention = interventions[0];
  }
  if (!intervention) throw new Error("Recovery mission not found");
  if (intervention.status !== "approved")
    throw new Error("Approve the current draft before opening contact tools");

  const drafts = await tx
    .select()
    .from(customerRecoveryDrafts)
    .where(
      and(
        eq(customerRecoveryDrafts.tenantId, input.tenantId),
        eq(customerRecoveryDrafts.interventionId, input.interventionId)
      )
    )
    .orderBy(desc(customerRecoveryDrafts.version))
    .for("update")
    .limit(1);
  const draft = drafts[0];
  if (
    !draft ||
    draft.id !== input.draftId ||
    draft.status !== "approved" ||
    draft.contentHash !== input.contentHash
  )
    throw new Error("The approved draft has changed; review it again");

  const permissions = await tx
    .select()
    .from(customerContactPermissions)
    .where(
      and(
        eq(customerContactPermissions.tenantId, input.tenantId),
        eq(
          customerContactPermissions.customerKeyHash,
          intervention.customerKeyHash
        ),
        eq(customerContactPermissions.channel, "sms"),
        eq(customerContactPermissions.purpose, "win_back_marketing")
      )
    )
    .for("update")
    .limit(1);
  if (!effectivePermission(permissions[0] ?? null).composerAllowed)
    throw new Error(
      "Recorded, current SMS win-back consent is required before contact"
    );

  const snapshots = await tx
    .select({ phone: customerChurnSnapshots.customerPhone })
    .from(customerChurnSnapshots)
    .where(
      and(
        eq(customerChurnSnapshots.tenantId, input.tenantId),
        eq(customerChurnSnapshots.id, intervention.churnSnapshotId)
      )
    )
    .limit(1);
  const phone = snapshots[0]?.phone ?? "";
  if (normalizePhone(phone).length !== 10)
    throw new Error(
      "A validated 10-digit US customer phone number is required for manual SMS"
    );
  return { intervention, draft, phone };
}

export async function prepareCustomerRecoveryManualContact(input: {
  tenantId: string;
  interventionId: string;
  draftId: string;
  contentHash: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const ready = await db.transaction(async tx => {
    const current = await readManualContactReadyWith(tx, input);
    const replay = await tx
      .select({ id: customerRecoveryEvents.id })
      .from(customerRecoveryEvents)
      .where(
        and(
          eq(customerRecoveryEvents.tenantId, input.tenantId),
          eq(
            customerRecoveryEvents.idempotencyKey,
            `recovery-composer:${input.requestId}`
          )
        )
      )
      .for("update")
      .limit(1);
    if (!replay[0]) {
      await tx.insert(customerRecoveryEvents).values({
        tenantId: input.tenantId,
        interventionId: input.interventionId,
        eventName: "manual_sms_composer_opened",
        actorId: input.actorId,
        idempotencyKey: `recovery-composer:${input.requestId}`,
        metadataJson: {
          draftId: current.draft.id,
          version: current.draft.version,
          contentHash: current.draft.contentHash,
          outreachSent: false,
        },
      });
    }
    return current;
  });
  const phone = ready.phone;
  const digits = normalizePhone(phone);
  return {
    smsUrl: `sms:+1${digits}?body=${encodeURIComponent(ready.draft.message)}`,
    message: ready.draft.message,
    phoneMasked: maskPhone(phone),
    sent: false as const,
    deliveryVerified: false as const,
  };
}

/**
 * The building a dormant customer's outreach belongs to.
 *
 * Resolved from the address on that customer's own most recent order, so the
 * Chronicle mark lands on a real place or on none at all. A customer whose
 * address has never been bound to a building simply produces an unattached
 * event rather than a guess.
 */
async function physicalEntityForIntervention(input: {
  tenantId: string;
  interventionId: string;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ phone: customerChurnSnapshots.customerPhone })
    .from(customerRecoveryInterventions)
    .innerJoin(
      customerChurnSnapshots,
      and(
        eq(customerChurnSnapshots.tenantId, input.tenantId),
        eq(customerChurnSnapshots.id, customerRecoveryInterventions.churnSnapshotId)
      )
    )
    .where(
      and(
        eq(customerRecoveryInterventions.tenantId, input.tenantId),
        eq(customerRecoveryInterventions.id, input.interventionId)
      )
    )
    .limit(1);
  const phone = rows[0]?.phone;
  if (!phone) return null;
  const latest = await db
    .select({ address: orders.address })
    .from(orders)
    .where(
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`,
        eq(orders.phone, phone)
      )
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(1);
  return findPhysicalEntityIdByAddress({
    tenantId: input.tenantId,
    address: latest[0]?.address,
  });
}

/**
 * The buildings a set of recovery interventions belong to, resolved in one
 * pass. Interventions whose customer address has never been bound to a physical
 * entity are simply absent from the map rather than mapped to a guess.
 */
export async function physicalEntityIdsForInterventions(
  tenantId: string,
  interventionIds: string[]
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  if (!interventionIds.length) return resolved;
  const db = await getDb();
  if (!db) return resolved;
  const rows = await db
    .select({
      interventionId: customerRecoveryInterventions.id,
      address: orders.address,
      createdAt: orders.createdAt,
    })
    .from(customerRecoveryInterventions)
    .innerJoin(
      customerChurnSnapshots,
      and(
        eq(customerChurnSnapshots.tenantId, tenantId),
        eq(customerChurnSnapshots.id, customerRecoveryInterventions.churnSnapshotId)
      )
    )
    .innerJoin(
      orders,
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        eq(orders.phone, customerChurnSnapshots.customerPhone)
      )
    )
    .where(
      and(
        eq(customerRecoveryInterventions.tenantId, tenantId),
        inArray(customerRecoveryInterventions.id, interventionIds)
      )
    )
    .orderBy(asc(orders.createdAt));

  // The latest order wins, so a customer who moved is placed where they are now.
  const latestAddress = new Map<string, string>();
  for (const row of rows) {
    if (row.address) latestAddress.set(row.interventionId, row.address);
  }
  for (const [interventionId, address] of Array.from(latestAddress)) {
    const entityId = await findPhysicalEntityIdByAddress({ tenantId, address });
    if (entityId) resolved.set(interventionId, entityId);
  }
  return resolved;
}

export async function markCustomerRecoveryContacted(input: {
  tenantId: string;
  interventionId: string;
  draftId: string;
  contentHash: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db
    .select({ id: customerRecoveryEvents.id })
    .from(customerRecoveryEvents)
    .where(
      and(
        eq(customerRecoveryEvents.tenantId, input.tenantId),
        eq(
          customerRecoveryEvents.idempotencyKey,
          `recovery-contacted:${input.requestId}`
        )
      )
    )
    .limit(1);
  if (existing[0]) return getRecoveryInterventionDetail(input);
  await db.transaction(async tx => {
    const interventions = await tx
      .select()
      .from(customerRecoveryInterventions)
      .where(
        and(
          eq(customerRecoveryInterventions.tenantId, input.tenantId),
          eq(customerRecoveryInterventions.id, input.interventionId)
        )
      )
      .for("update")
      .limit(1);
    const lockedIntervention = interventions[0];
    if (!lockedIntervention) throw new Error("Recovery mission not found");
    const replay = await tx
      .select({ id: customerRecoveryEvents.id })
      .from(customerRecoveryEvents)
      .where(
        and(
          eq(customerRecoveryEvents.tenantId, input.tenantId),
          eq(
            customerRecoveryEvents.idempotencyKey,
            `recovery-contacted:${input.requestId}`
          )
        )
      )
      .for("update")
      .limit(1);
    if (replay[0]) return;
    const { intervention } = await readManualContactReadyWith(
      tx,
      input,
      lockedIntervention
    );
    const contactedAt = new Date();
    const transition = await tx
      .update(customerRecoveryInterventions)
      .set({ status: "contacted", contactedAt })
      .where(
        and(
          eq(customerRecoveryInterventions.tenantId, input.tenantId),
          eq(customerRecoveryInterventions.id, input.interventionId),
          eq(customerRecoveryInterventions.status, "approved")
        )
      );
    if (affectedRows(transition) !== 1)
      throw new Error(
        "Recovery mission contact state changed; reload and retry"
      );
    await tx
      .update(opsTasks)
      .set({ status: "in_progress" })
      .where(
        and(
          eq(opsTasks.tenantId, input.tenantId),
          eq(opsTasks.id, intervention.opsTaskId)
        )
      );
    await tx.insert(customerRecoveryEvents).values({
      tenantId: input.tenantId,
      interventionId: input.interventionId,
      eventName: "manual_contact_reported",
      actorId: input.actorId,
      idempotencyKey: `recovery-contacted:${input.requestId}`,
      metadataJson: {
        draftId: input.draftId,
        contentHash: input.contentHash,
        operatorReported: true,
        providerDeliveryVerified: false,
        contactedAt: contactedAt.toISOString(),
      },
    });
    await tx.insert(opsTaskEvents).values({
      tenantId: input.tenantId,
      taskId: intervention.opsTaskId,
      eventType: "accepted",
      actorType: "human",
      actorId: input.actorId,
      afterJson: { contactedAt: contactedAt.toISOString() },
      note: "Operator reported manual outreach; provider delivery is not verified.",
    });
  });
  await appendGoldlineWorldEvent({
    tenantId: input.tenantId,
    physicalEntityId: await physicalEntityForIntervention({ tenantId: input.tenantId, interventionId: input.interventionId }),
    eventType: "recovery_outreach_completed", classification: "action", actorType: "operator", actorId: input.actorId,
    occurredAt: new Date().toISOString(), observedAt: null, sourceType: "customer_recovery_interventions", sourceId: input.interventionId, sourceEvidenceReference: `customer_recovery_interventions:${input.interventionId}`,
    provenanceClass: "operator_reported", verificationClass: "ATTESTED", confidence: "high", idempotencyKey: `recovery-outreach:${input.tenantId}:${input.requestId}`, correlationId: `recovery-intervention:${input.interventionId}`,
    metadata: { draftId: input.draftId, actionOnly: true, doesNotMeanRecovered: true },
  });
  return getRecoveryInterventionDetail(input);
}

async function markRecoveredWith(
  tx: Transaction,
  input: {
    tenantId: string;
    intervention: typeof customerRecoveryInterventions.$inferSelect;
    order: OrderRow;
  }
) {
  const recoveredRevenueCents = cents(input.order.total);
  const recoveredAt = input.order.paidAt ?? input.order.createdAt;
  const result = await tx
    .update(customerRecoveryInterventions)
    .set({
      status: "recovered",
      activeCustomerKeyHash: null,
      recoveredAt,
      recoveredOrderId: input.order.id,
      recoveredRevenueCents,
    })
    .where(
      and(
        eq(customerRecoveryInterventions.tenantId, input.tenantId),
        eq(customerRecoveryInterventions.id, input.intervention.id),
        eq(customerRecoveryInterventions.status, "contacted")
      )
    );
  if (affectedRows(result) !== 1) return false;
  await tx
    .update(opsTasks)
    .set({
      status: "completed",
      revenueRecoveredCents: recoveredRevenueCents,
      completedAt: recoveredAt,
      completedBy: "dayforge-attribution",
      outcome: `Recovered by paid order ${input.order.id}`,
    })
    .where(
      and(
        eq(opsTasks.tenantId, input.tenantId),
        eq(opsTasks.id, input.intervention.opsTaskId)
      )
    );
  await tx.insert(customerRecoveryEvents).values({
    tenantId: input.tenantId,
    interventionId: input.intervention.id,
    eventName: "revenue_recovered",
    actorId: "dayforge-attribution",
    idempotencyKey: `recovery-order:${input.intervention.id}:${input.order.id}`,
    metadataJson: {
      orderId: input.order.id,
      recoveredRevenueCents,
      paidAt: input.order.paidAt?.toISOString() ?? null,
    },
  });
  const projectionCorrelationId = `recovery-intervention:${input.intervention.id}:order:${input.order.id}`;
  await writeDayforgeEventWith(tx, {
    tenantId: input.tenantId,
    actor: { type: "system", id: "dayforge-attribution" },
    entityType: "customer_recovery_intervention",
    entityId: input.intervention.id,
    eventName: "customer_returned",
    before: { status: input.intervention.status, recoveredOrderId: null },
    after: { status: "recovered", recoveredOrderId: input.order.id },
    source: "churn_radar_attribution",
    correlationId: projectionCorrelationId,
    idempotencyKey: `${projectionCorrelationId}:customer_returned`,
    productEvent: {
      name: "customer_returned",
      properties: { attributionConfidence: "paid_order_after_contact" },
    },
  });
  await writeDayforgeEventWith(tx, {
    tenantId: input.tenantId,
    actor: { type: "system", id: "dayforge-attribution" },
    entityType: "customer_recovery_intervention",
    entityId: input.intervention.id,
    eventName: "recovered_revenue_realized",
    before: { recoveredRevenueCents: input.intervention.recoveredRevenueCents },
    after: { recoveredRevenueCents, recoveredOrderId: input.order.id },
    source: "churn_radar_attribution",
    correlationId: projectionCorrelationId,
    idempotencyKey: `${projectionCorrelationId}:recovered_revenue_realized`,
    productEvent: {
      name: "recovered_revenue_realized",
      properties: {
        revenueBand: recoveredRevenueBand(recoveredRevenueCents),
        attributionConfidence: "paid_order_after_contact",
      },
    },
  });
  await tx.insert(opsTaskEvents).values({
    tenantId: input.tenantId,
    taskId: input.intervention.opsTaskId,
    eventType: "revenue_recovered",
    actorType: "system",
    actorId: "dayforge-attribution",
    afterJson: { orderId: input.order.id, recoveredRevenueCents },
    note: "A subsequent paid order was attributed to this recovery mission.",
  });
  return true;
}

export async function refreshCustomerRecoveryAttribution(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const contacted = await db
    .select()
    .from(customerRecoveryInterventions)
    .where(
      and(
        eq(customerRecoveryInterventions.tenantId, tenantId),
        eq(customerRecoveryInterventions.status, "contacted")
      )
    );
  if (contacted.length === 0) return 0;
  const earliest = new Date(
    Math.min(
      ...contacted.map(item => item.contactedAt?.getTime() ?? Date.now())
    )
  );
  const paidOrders = await db
    .select()
    .from(orders)
    .where(
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        eq(orders.paid, true),
        gt(orders.createdAt, earliest)
      )
    )
    .orderBy(orders.createdAt, orders.id);
  let recovered = 0;
  for (const intervention of contacted) {
    const match = paidOrders.find(
      order =>
        customerIdentityHashes(tenantId, order).includes(
          intervention.customerKeyHash
        ) &&
        order.createdAt.getTime() > (intervention.contactedAt?.getTime() ?? 0)
    );
    if (!match) continue;
    try {
      const transitioned = await db.transaction(tx =>
        markRecoveredWith(tx, { tenantId, intervention, order: match })
      );
      if (transitioned) {
        recovered += 1;
        await appendGoldlineWorldEvent({
          tenantId,
          physicalEntityId: await findPhysicalEntityIdByAddress({ tenantId, address: match.address }),
          eventType: "customer_recovered", classification: "outcome", actorType: "customer", actorId: null,
          occurredAt: (match.paidAt ?? match.createdAt).toISOString(), observedAt: null, sourceType: "orders", sourceId: String(match.id), sourceEvidenceReference: `orders:${match.id}`,
          provenanceClass: "existing_business_record", verificationClass: "VERIFIED", confidence: "high", idempotencyKey: `customer-recovered:${tenantId}:${intervention.id}:${match.id}`, correlationId: `recovery-intervention:${intervention.id}`,
          metadata: { interventionId: intervention.id, orderId: match.id, recoveredRevenueCents: cents(match.total), authoritativePaidOrder: true },
        });
      }
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
  return recovered;
}
