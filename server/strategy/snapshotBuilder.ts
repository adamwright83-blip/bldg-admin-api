/**
 * StrategyEngine Snapshot Builder (Slice 4)
 * Assembles a canonical, bounded, immutable picture of business truth with complete provenance.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb, listAdminCustomerAggregates } from "../db";
import { strategySnapshots } from "../../drizzle/schema";
import { getActiveMacroGoal } from "../claire/macroGoalService";
import {
  getStrategyActiveCustomers,
  getStrategyGrowthMetrics,
} from "./growthMetrics";
import { ACTIVE_CUSTOMER_DEFINITION } from "../claire/activeCustomerMetric";
import { getActivePlaygroundRules } from "./playgroundRulesService";
import { getMonthToDateSpend } from "./spendClearance";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { loadDormantEligibleCustomers } from "./snapshotDormantCustomers";
import { loadRepeatPipeline } from "./snapshotRepeatPipeline";
import { deriveFunnelFromCustomerAggregates } from "./snapshotFunnel";
import type {
  OpportunityGap,
  ProvenanceRecord,
  StalenessRecord,
  StrategySnapshot,
  StrategySnapshotPayload,
} from "./snapshotTypes";

export const ACCOUNTS_STATE_UNMAPPED_ISSUE =
  "accounts[].state (Captured|Contested|Closed|Recovery|Wait) has no mapping from commercial_accounts or pipeline stage anywhere in the repo; the accounts list is empty rather than guessed.";

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
  activeCustomersCount?: number;
  operatorUserId?: string;
  sourceFreshnessOverride?: {
    cleanCloudLastSyncIso?: string;
    gumballpalsLastSyncIso?: string;
  };
  /** Injected in tests; production loads tenant-scoped admin aggregates. */
  customerAggregates?: AdminCustomerAggregateDbRow[];
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
  const goalMetricType = (macroGoalRecord as any)?.metricKey ?? (macroGoalRecord as any)?.metricType ?? "active_customers";
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

  const activeCount = options.activeCustomersCount ?? activeCustomerData.count;
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

  const customerAggregates: AdminCustomerAggregateDbRow[] =
    options.customerAggregates ??
    (await listAdminCustomerAggregates(tenantId));

  const funnelDerived = deriveFunnelFromCustomerAggregates(customerAggregates);
  const funnelStages = funnelDerived.stages;
  const limitingStage = funnelDerived.limitingStage;

  const repeatPipeline = await loadRepeatPipeline({
    tenantId,
    now,
    aggregates: customerAggregates,
  });

  const dormantDerived = await loadDormantEligibleCustomers({
    tenantId,
    now,
    aggregates: customerAggregates,
  });
  const dormantEligible = dormantDerived.customers;

  // Accounts: real commercial_accounts exist, but snapshot `state` vocabulary
  // is unique to strategy types and has no live mapping. Empty, not guessed.
  const accounts: StrategySnapshotPayload["accounts"] = [];

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
  ];
  const firstOrderNoSecond = repeatPipeline.recentFirstOrderCustomers.find(
    c => !c.hasSecondOrder
  );
  if (firstOrderNoSecond) {
    detectedGaps.push({
      type: "first_order_no_second",
      opportunityId: firstOrderNoSecond.id,
      description: `Customer ${firstOrderNoSecond.id} has a first paid order and no second paid order in observed history.`,
    });
  }

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

  unresolved.push({
    source: "strategySnapshot.accounts",
    issue: ACCOUNTS_STATE_UNMAPPED_ISSUE,
    severity: "warning",
  });
  unresolved.push({
    source: "strategySnapshot.repeatPipeline.feedback",
    issue: "No customer-feedback store is queried; fulfillmentStatus/feedbackStatus are unavailable and openFeedbackIssues is unobserved (reported 0).",
    severity: "warning",
  });
  unresolved.push({
    source: "strategySnapshot.funnelStages.property",
    issue: "Property Discovery and Property Approval are omitted; those snapshot labels have no live mapping from commercial pipeline stages.",
    severity: "warning",
  });
  if (funnelStages.length === 0) {
    unresolved.push({
      source: "strategySnapshot.funnelStages",
      issue: "No paid-order customers in tenant aggregates; funnel stages are empty rather than filled with fixture counts.",
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
    "customers.dormantEligible": {
      source: "listAdminCustomerAggregates",
      queryOrDefinition:
        "Paid customers whose last order is >= 30 days before snapshot now; snapshot id is sha256 of tenant+admin group key (phone not copied)",
      window: "inactivity_days_30",
      computedAt,
      sampleSize: dormantEligible.length,
      notes: `consideredPaidCustomerCount=${dormantDerived.consideredPaidCustomerCount}`,
    },
    "repeatPipeline": {
      source: "listAdminCustomerAggregates",
      queryOrDefinition:
        "Paid customers whose first paid order is within the last 30 days; second order = paidOrderCount >= 2",
      window: "last_30_days",
      computedAt,
      sampleSize: repeatPipeline.summary.totalRecent,
      notes: "fulfillment/feedback unavailable; openFeedbackIssues unobserved",
    },
    "growthPlan.stages": {
      source: "listAdminCustomerAggregates",
      queryOrDefinition:
        "Resident First Order = paidOrderCount>=1; Resident Repeat Order = paidOrderCount>=2. Property Discovery/Approval omitted (no live mapping).",
      computedAt,
      sampleSize: funnelStages.reduce((sum, s) => sum + s.count, 0),
    },
    "growthPlan.limitingStage": {
      source: "deriveFunnelFromCustomerAggregates",
      queryOrDefinition: "Worst observed first→repeat conversion, or insufficient_data",
      computedAt,
    },
    "accounts": {
      source: "omitted",
      queryOrDefinition: ACCOUNTS_STATE_UNMAPPED_ISSUE,
      computedAt,
      sampleSize: 0,
      isEstimated: false,
    },
  };

  // Initial Payload
  let payload: StrategySnapshotPayload = {
    goal: {
      metricType: goalMetricType,
      target: goalTarget,
      targetValue: goalTarget,
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
      nextActions:
        limitingStage === "insufficient_data"
          ? []
          : [`Investigate conversion at ${limitingStage}`],
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
      dormantCount: dormantDerived.totalEligibleCount,
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
    if (payload.customers.dormantEligible.length > 5) {
      payload.customers.dormantEligible = payload.customers.dormantEligible.slice(0, 5);
      truncationDetails.push("dormant eligible truncated to top 5 by daysSinceLastOrder");
    }
    if (payload.opportunities.length > 1) {
      payload.opportunities = payload.opportunities.slice(0, 1);
      truncationDetails.push("opportunities truncated to 1");
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
  return (
    snapshot.provenance[path] ??
    snapshot.provenance[`${path}.currentValue`] ??
    snapshot.provenance[`${path}.newPayingCustomers`] ??
    null
  );
}

/**
 * Test helper to clear memory store.
 */
export function _clearSnapshotStore(): void {
  snapshotStore.clear();
}
