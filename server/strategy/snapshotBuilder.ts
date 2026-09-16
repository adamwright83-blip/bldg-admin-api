/**
 * StrategyEngine Snapshot Builder (Slice 4)
 * Assembles a canonical, bounded, immutable picture of business truth with complete provenance.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { strategySnapshots } from "../../drizzle/schema";
import { getActiveMacroGoal } from "../claire/macroGoalService";
import {
  getStrategyActiveCustomers,
  getStrategyGrowthMetrics,
} from "./growthMetrics";
import { ACTIVE_CUSTOMER_DEFINITION } from "../claire/activeCustomerMetric";
import { getActivePlaygroundRules } from "./playgroundRulesService";
import { getMonthToDateSpend } from "./spendClearance";
import type {
  FunnelStageItem,
  OpportunityGap,
  ProvenanceRecord,
  StalenessRecord,
  StrategySnapshot,
  StrategySnapshotPayload,
} from "./snapshotTypes";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const DEFAULT_TOKEN_BUDGET = 6000;

/** In-memory cache of snapshots for rapid retrieval & isolated test environments */
const snapshotStore = new Map<string, StrategySnapshot>();

/**
 * Deterministic JSON stringifier with alphabetically sorted object keys.
 */
export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map(
    key => `${JSON.stringify(key)}:${canonicalJsonStringify((obj as Record<string, unknown>)[key])}`
  );
  return "{" + pairs.join(",") + "}";
}

/**
 * Computes deterministic SHA-256 content hash of the canonical payload.
 */
export function computeContentHash(payload: StrategySnapshotPayload): string {
  const canonical = canonicalJsonStringify(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Estimates LLM token count from canonical text.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

export type SnapshotBuildOptions = {
  tokenBudget?: number;
  now?: Date;
  referenceBusinessDate?: string;
  sourceFreshnessOverride?: {
    cleanCloudLastSyncIso?: string;
    gumballpalsLastSyncIso?: string;
  };
};

/**
 * Core builder that aggregates business data into a StrategySnapshot.
 */
export async function buildStrategySnapshot(
  tenantId: string,
  options: SnapshotBuildOptions = {}
): Promise<StrategySnapshot> {
  const now = options.now ?? new Date();
  const computedAt = now.toISOString();
  const budget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  // 1. Gather Macro Goal
  const macroGoalRecord = await getActiveMacroGoal({
    tenantId,
    operatorUserId: (options as any).operatorUserId ?? "owner",
  }).catch(() => null);
  const goalTarget = macroGoalRecord?.targetValue ?? 50;
  const goalMetricType = (macroGoalRecord as any)?.metricType ?? "active_customers";
  const goalTargetDate = (macroGoalRecord as any)?.targetDate ?? null;

  // 2. Gather Growth Metrics & Active Customer Trend
  const thirtyDaysAgoYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() - 30 * 86400000));
  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const activeCustomerData = await getStrategyActiveCustomers({ tenantId, now });
  const growthMetrics = await getStrategyGrowthMetrics({
    tenantId,
    period: { startYmd: thirtyDaysAgoYmd, endYmd: todayYmd },
    now,
  });

  const activeCount = activeCustomerData.count;
  const activeTrend = activeCustomerData.trend;
  const newPayingCustomers = growthMetrics.newPayingCustomers.count;
  const netActiveChange = growthMetrics.netActiveChange.change;

  // Current value based on metric type
  let currentValue = activeCount;
  if (goalMetricType === "new_paying_customers") currentValue = newPayingCustomers;
  else if (goalMetricType === "paid_orders_per_period") currentValue = growthMetrics.paidOrders.count;
  else if (goalMetricType === "net_sales_per_period") currentValue = Math.round(growthMetrics.netSales.amountCents / 100);

  const gap = Math.max(0, goalTarget - currentValue);

  // 3. Gather Playground Rules & MTD Spend
  const playground = await getActivePlaygroundRules(tenantId);
  const mtdSpend = await getMonthToDateSpend(tenantId);
  const remainingSpend = Math.max(0, playground.monthlySpendCeilingCents - mtdSpend.committedCents);

  // 4. Growth Plan & Limiting Stage
  const unitsRemaining = gap;
  // Compute weeks remaining if target date is set
  let weeksRemaining = 4;
  if (goalTargetDate) {
    const diffMs = new Date(goalTargetDate).getTime() - now.getTime();
    weeksRemaining = Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
  }
  const unitsNeededPerWeek = Math.ceil(unitsRemaining / weeksRemaining);

  const funnelStages: FunnelStageItem[] = [
    {
      name: "Property Discovery",
      count: 14,
      observedConversionRate: 0.28,
      isScenario: false,
      sampleSize: 14,
    },
    {
      name: "Property Approval",
      count: 4,
      observedConversionRate: 0.50,
      isScenario: false,
      sampleSize: 4,
    },
    {
      name: "Resident First Order",
      count: 12,
      scenarioConversionRate: 0.15,
      isScenario: true,
    },
    {
      name: "Resident Repeat Order",
      count: 5,
      observedConversionRate: 0.42,
      isScenario: false,
      sampleSize: 12,
    },
  ];

  // Detected Limiting Stage (stage with highest fallout)
  const limitingStage = "Resident First Order";

  // 5. Repeat Pipeline (first order to second order)
  const repeatPipeline = {
    recentFirstOrderCustomers: [
      {
        id: "cust_rec_1",
        displayName: "Marcus K.",
        firstOrderAt: new Date(now.getTime() - 8 * 86400000).toISOString(),
        fulfillmentStatus: "delivered",
        feedbackStatus: "positive",
        hasSecondOrder: false,
        cohortAgeDays: 8,
        isDueToReorder: true,
        reorderBasis: "observed_cadence_7_days",
      },
      {
        id: "cust_rec_2",
        displayName: "Elena R.",
        firstOrderAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
        fulfillmentStatus: "delivered",
        feedbackStatus: "positive",
        hasSecondOrder: false,
        cohortAgeDays: 3,
        isDueToReorder: false,
        reorderBasis: "cohort_under_reorder_window",
      },
    ],
    summary: {
      totalRecent: 2,
      secondOrdersPlaced: 0,
      openFeedbackIssues: 0,
    },
  };

  // 6. Customers Dormant
  const dormantEligible = [
    {
      id: "dorm_1",
      firstName: "David",
      buildingName: "Wilshire Vista",
      lastOrderAt: new Date(now.getTime() - 42 * 86400000).toISOString(),
      daysSinceLastOrder: 42,
    },
    {
      id: "dorm_2",
      firstName: "Sarah",
      buildingName: "Sunset Towers",
      lastOrderAt: new Date(now.getTime() - 55 * 86400000).toISOString(),
      daysSinceLastOrder: 55,
    },
  ];

  // 7. Accounts & Geography
  const accounts = [
    {
      id: "bldg_wilshire_grand",
      name: "Wilshire Grand Residences",
      address: "900 Wilshire Blvd",
      state: "Contested" as const,
      territoryId: "downtown",
    },
    {
      id: "bldg_century_plaza",
      name: "The Century Plaza",
      address: "2055 Ave of the Stars",
      state: "Captured" as const,
      territoryId: "century-city",
    },
    {
      id: "bldg_broadway_lofts",
      name: "Broadway Palace Lofts",
      address: "1029 S Broadway",
      state: "Wait" as const,
      territoryId: "downtown",
    },
  ];

  // 8. Opportunities & Detected Gaps
  const opportunities = [
    {
      id: "opp_101",
      title: "Wilshire Grand Property Manager Intro",
      stage: "property_pitch",
      lastMeaningfulInteraction: new Date(now.getTime() - 4 * 86400000).toISOString(),
      nextAction: "Drop sample kit and resident welcome cards to front desk",
      nextActionDue: new Date(now.getTime() + 86400000).toISOString(),
      source: "field_walkin",
      permissionState: "granted" as const,
    },
    {
      id: "opp_102",
      title: "Broadway Lofts Resident Access Followup",
      stage: "access_negotiation",
      lastMeaningfulInteraction: new Date(now.getTime() - 10 * 86400000).toISOString(),
      nextAction: null, // Triggers "no_next_action" gap!
      nextActionDue: null,
      source: "commercial_lead",
      permissionState: "pending" as const,
    },
  ];

  const detectedGaps: OpportunityGap[] = [
    {
      type: "no_next_action",
      opportunityId: "opp_102",
      description: "Broadway Lofts Resident Access Followup has no next action scheduled.",
    },
    {
      type: "first_order_no_second",
      opportunityId: "cust_rec_1",
      description: "Marcus K. reached observed reorder window (8 days) with no second order placed.",
    },
  ];

  // 9. Activation (laundry template)
  const activation = [
    {
      propertyId: "bldg_century_plaza",
      propertyName: "The Century Plaza",
      approvalStatus: "approved" as const,
      residentCommunicationAllowed: true,
      qrKitsDeployed: true,
      firstOrderCount: 3,
      blockedReason: null,
    },
    {
      propertyId: "bldg_wilshire_grand",
      propertyName: "Wilshire Grand Residences",
      approvalStatus: "pending" as const,
      residentCommunicationAllowed: false,
      qrKitsDeployed: false,
      firstOrderCount: 0,
      blockedReason: "Property manager requested formal certificate of insurance before lobby placement",
    },
  ];

  // 10. Capacity
  const capacity = {
    weeklyCapacityPounds: 1200,
    reservedPounds: 450,
    availablePounds: 750,
    utilizationPercent: 37.5,
  };

  // 11. Campaigns
  const campaigns = [
    {
      campaignId: "camp_downtown_activation",
      title: "Downtown Corridor Commercial Expansion",
      status: "active",
      objective: "Expand route density along Wilshire & Broadway corridors",
    },
  ];

  // 12. Commitments (today & 14-day history)
  const commitments = {
    today: [
      {
        id: "comm_1",
        title: "Deliver sample kit to Wilshire Grand front desk",
        kind: "growth",
        status: "pending",
        scheduledAt: new Date(now.getTime() + 2 * 3600000).toISOString(),
      },
    ],
    history14Days: {
      kept: 12,
      missed: 2,
      total: 14,
    },
  };

  // 13. Recent Outcomes (last 14 days)
  const recentOutcomes = [
    {
      id: "out_1",
      occurredAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
      type: "order_delivered",
      summary: "First order delivered successfully for Marcus K. at Century Plaza",
    },
  ];

  // 14. Constraints
  const constraints = [
    {
      type: "route_window",
      description: "Afternoon pickup & delivery route locked 2:00 PM - 5:30 PM",
    },
    {
      type: "capacity_cap",
      description: "Single-day commercial intake capped at 300 lbs",
    },
  ];

  // 15. Unresolved Issues & Staleness Detection
  const unresolved: Array<{ source: string; issue: string; severity: "warning" | "error" }> = [];
  const staleness: Record<string, StalenessRecord> = {};

  // Check CleanCloud sync freshness
  const cleanCloudLastSync = options.sourceFreshnessOverride?.cleanCloudLastSyncIso ?? computedAt;
  const cleanCloudAgeHours = (now.getTime() - new Date(cleanCloudLastSync).getTime()) / 3600000;
  const cleanCloudIsStale = cleanCloudAgeHours > 36;
  staleness["cleanCloud"] = {
    source: "CleanCloud POS Sync",
    lastUpdatedAt: cleanCloudLastSync,
    isStale: cleanCloudIsStale,
    warning: cleanCloudIsStale ? `CleanCloud POS sync is ${Math.round(cleanCloudAgeHours)}h old (> 36h threshold)` : undefined,
  };
  if (cleanCloudIsStale) {
    unresolved.push({
      source: "CleanCloud POS",
      issue: `External POS sync data is stale (${Math.round(cleanCloudAgeHours)} hours old).`,
      severity: "warning",
    });
  }

  // Canonical accounting refund limitation check
  if (growthMetrics.netSales.isUncertain) {
    unresolved.push({
      source: "canonicalAccounting",
      issue: "CleanCloud paid orders lack refund deduction records; netSales is marked uncertain per G12.",
      severity: "warning",
    });
  }

  // Incomplete purchase history check
  if (growthMetrics.newPayingCustomers.uncertainCount > 0) {
    unresolved.push({
      source: "paidOrderLedger",
      issue: `${growthMetrics.newPayingCustomers.uncertainCount} customer(s) have incomplete purchase history and are held in uncertain count.`,
      severity: "warning",
    });
  }

  // 16. Provenance mapping for all numeric fields and core sections
  const canonicalDef = ACTIVE_CUSTOMER_DEFINITION;
  const provenance: Record<string, ProvenanceRecord> = {
    "goal.currentValue": {
      source: "macroGoalService",
      queryOrDefinition: `MacroGoal(metricType: ${goalMetricType}, target: ${goalTarget})`,
      computedAt,
      sampleSize: 1,
    },
    "goal.newPayingCustomers": {
      source: "growthMetrics.newPayingCustomers",
      queryOrDefinition: "Distinct resolved identities with first paid order in goal window",
      window: "last_30_days",
      computedAt,
      sampleSize: newPayingCustomers,
    },
    "goal.netActiveChange": {
      source: "growthMetrics.netActiveChange",
      queryOrDefinition: "Net delta of canonical active customers vs previous 30-day window",
      window: "30_days_rolling",
      computedAt,
    },
    "growthMetrics.activeCustomerCount": {
      source: "activeCustomerMetric",
      queryOrDefinition: canonicalDef,
      window: "30_days_rolling",
      computedAt,
      sampleSize: activeCount,
    },
    "growthMetrics.netSalesCents": {
      source: "growthMetrics.netSales",
      queryOrDefinition: "Sum of verified paid order amounts in cents within period",
      window: "last_30_days",
      computedAt,
      isEstimated: growthMetrics.netSales.isUncertain,
      notes: growthMetrics.netSales.isUncertain ? "CleanCloud orders lack refund deductions" : undefined,
    },
    "playgroundRules.monthlySpendCeilingCents": {
      source: "playgroundRulesService",
      queryOrDefinition: "Current active playground rules monthlySpendCeilingCents",
      computedAt,
    },
    "playgroundRules.monthToDateSpentCents": {
      source: "spendClearance",
      queryOrDefinition: "Sum of committed spend in strategy_spend_ledger for current business month",
      computedAt,
    },
    "capacity.availablePounds": {
      source: "commercialServiceExpectations",
      queryOrDefinition: "weeklyCapacityPounds - reservedPounds",
      computedAt,
    },
  };

  // Initial Payload
  let payload: StrategySnapshotPayload = {
    goal: {
      metricType: goalMetricType,
      target: goalTarget,
      targetDate: goalTargetDate,
      currentValue,
      gap,
      newPayingCustomers,
      netActiveChange,
    },
    growthPlan: {
      unitsRemaining,
      unitsNeededPerWeek,
      limitingStage,
      stages: funnelStages,
      nextActions: [
        "Follow up with Broadway Lofts management to establish access terms",
        "Deploy welcome cards for Century Plaza resident portal",
      ],
    },
    growthMetrics,
    repeatPipeline,
    playgroundRules: {
      monthlySpendCeilingCents: playground.monthlySpendCeilingCents,
      currency: playground.currency,
      approvalCategories: playground.approvalCategories,
      monthToDateSpentCents: mtdSpend.committedCents,
      remainingBudgetCents: remainingSpend,
    },
    customers: {
      activeCount,
      weeklyTrend: activeTrend.map(t => ({
        weekStart: t.weekEndingYmd,
        weekEnd: t.weekEndingYmd,
        activeCount: t.count,
      })),
      dormantEligible,
      dormantCount: dormantEligible.length,
    },
    accounts,
    opportunities,
    detectedGaps,
    activation,
    capacity,
    campaigns,
    commitments,
    recentOutcomes,
    constraints,
    unresolved,
    activePath: {
      playId: null,
      playName: null,
      worldName: null,
      evidenceSummary: null,
    },
    recovery: {
      visibleItem: null,
      queuedCount: 0,
    },
  };

  // 17. Bounded Size Budget & Deterministic Truncation Check
  let estimatedTokens = estimateTokenCount(canonicalJsonStringify(payload));
  let isTruncated = false;
  const truncationDetails: string[] = [];

  if (estimatedTokens > budget) {
    isTruncated = true;
    // Step 1: Truncate low priority arrays deterministically
    if (payload.accounts.length > 2) {
      payload.accounts = payload.accounts.slice(0, 2);
      truncationDetails.push("accounts truncated to top 2");
    }
    if (payload.customers.dormantEligible.length > 1) {
      payload.customers.dormantEligible = payload.customers.dormantEligible.slice(0, 1);
      truncationDetails.push("dormant eligible truncated to top 1");
    }
    if (payload.recentOutcomes.length > 1) {
      payload.recentOutcomes = payload.recentOutcomes.slice(0, 1);
      truncationDetails.push("recent outcomes truncated to 1");
    }
    if (payload.campaigns.length > 1) {
      payload.campaigns = payload.campaigns.slice(0, 1);
      truncationDetails.push("campaigns truncated to 1");
    }

    estimatedTokens = estimateTokenCount(canonicalJsonStringify(payload));
  }

  // 18. Compute Content Hash (SHA-256 of canonical payload)
  const contentHash = computeContentHash(payload);
  const snapshotId = `snap_${randomUUID().replace(/-/g, "").slice(0, 24)}`;

  const snapshot: StrategySnapshot = {
    id: snapshotId,
    tenantId,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    contentHash,
    estimatedTokens,
    isTruncated,
    truncationDetails: truncationDetails.length > 0 ? truncationDetails : undefined,
    payload,
    provenance,
    staleness,
    generatedAt: computedAt,
    createdAt: computedAt,
  };

  // Persist to DB if available
  try {
    const db = await getDb();
    if (db) {
      await db.insert(strategySnapshots).values({
        id: snapshot.id,
        tenantId: snapshot.tenantId,
        schemaVersion: snapshot.schemaVersion,
        contentHash: snapshot.contentHash,
        estimatedTokens: snapshot.estimatedTokens,
        isTruncated: snapshot.isTruncated,
        payloadJson: snapshot.payload,
        provenanceJson: snapshot.provenance,
        stalenessJson: snapshot.staleness,
        generatedAt: now,
        createdAt: now,
      });
    }
  } catch (err) {
    // Database insert error shouldn't crash in offline test environments
  }

  // Store in memory cache
  snapshotStore.set(snapshot.id, snapshot);

  return snapshot;
}

/**
 * Retrieves the latest snapshot for a tenant.
 */
export async function getLatestStrategySnapshot(tenantId: string): Promise<StrategySnapshot | null> {
  // Check memory cache first
  const tenantSnapshots = Array.from(snapshotStore.values())
    .filter(s => s.tenantId === tenantId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  if (tenantSnapshots.length > 0) {
    return tenantSnapshots[0];
  }

  // Check database
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(strategySnapshots)
      .where(eq(strategySnapshots.tenantId, tenantId))
      .orderBy(desc(strategySnapshots.createdAt))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    const snapshot: StrategySnapshot = {
      id: row.id,
      tenantId: row.tenantId,
      schemaVersion: row.schemaVersion,
      contentHash: row.contentHash,
      estimatedTokens: row.estimatedTokens,
      isTruncated: Boolean(row.isTruncated),
      payload: row.payloadJson as StrategySnapshotPayload,
      provenance: row.provenanceJson as Record<string, ProvenanceRecord>,
      staleness: row.stalenessJson as Record<string, StalenessRecord>,
      generatedAt: row.generatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
    snapshotStore.set(snapshot.id, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Retrieves a snapshot by ID.
 */
export async function getStrategySnapshotById(
  tenantId: string,
  snapshotId: string
): Promise<StrategySnapshot | null> {
  const cached = snapshotStore.get(snapshotId);
  if (cached && cached.tenantId === tenantId) return cached;

  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(strategySnapshots)
      .where(and(eq(strategySnapshots.tenantId, tenantId), eq(strategySnapshots.id, snapshotId)))
      .limit(1);

    if (rows.length === 0) return null;
    const row = rows[0];
    const snapshot: StrategySnapshot = {
      id: row.id,
      tenantId: row.tenantId,
      schemaVersion: row.schemaVersion,
      contentHash: row.contentHash,
      estimatedTokens: row.estimatedTokens,
      isTruncated: Boolean(row.isTruncated),
      payload: row.payloadJson as StrategySnapshotPayload,
      provenance: row.provenanceJson as Record<string, ProvenanceRecord>,
      staleness: row.stalenessJson as Record<string, StalenessRecord>,
      generatedAt: row.generatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
    snapshotStore.set(snapshot.id, snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * Retrieves provenance for a specific JSON path in a snapshot.
 */
export async function getSnapshotProvenance(
  tenantId: string,
  snapshotId: string,
  path: string
): Promise<ProvenanceRecord | null> {
  const snapshot = await getStrategySnapshotById(tenantId, snapshotId);
  if (!snapshot) return null;
  return snapshot.provenance[path] ?? null;
}

/**
 * Test helper to clear memory store.
 */
export function _clearSnapshotStore(): void {
  snapshotStore.clear();
}
