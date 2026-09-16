/**
 * StrategyEngine Snapshot Types (Slice 4)
 * Defines the canonical bounded data structure representing the business for strategic reasoning.
 */

import type { GoalMetricType } from "../claire/macroGoalService";
import type { StrategyGrowthMetricsResult } from "./growthMetrics";

export type ProvenanceRecord = {
  source: string;
  queryOrDefinition: string;
  window?: string;
  computedAt: string;
  sampleSize?: number;
  isEstimated?: boolean;
  notes?: string;
};

export type StalenessRecord = {
  source: string;
  lastUpdatedAt: string;
  isStale: boolean;
  warning?: string;
};

export type FunnelStageItem = {
  name: string;
  count: number;
  observedConversionRate?: number;
  scenarioConversionRate?: number;
  isScenario: boolean;
  sampleSize?: number;
};

export type OpportunityGap = {
  type:
    | "info_request_no_followup"
    | "access_no_first_order"
    | "interest_no_booking"
    | "first_order_no_second"
    | "unresolved_service_issue"
    | "no_next_action";
  opportunityId?: string;
  description: string;
};

export type StrategySnapshotPayload = {
  goal: {
    metricType: GoalMetricType;
    target: number;
    targetDate: string | null;
    currentValue: number;
    gap: number;
    newPayingCustomers: number;
    netActiveChange: number;
    secondaryTargets?: Record<string, number>;
  };
  growthPlan: {
    unitsRemaining: number;
    unitsNeededPerWeek: number;
    limitingStage: string;
    stages: FunnelStageItem[];
    nextActions: string[];
  };
  growthMetrics: StrategyGrowthMetricsResult;
  repeatPipeline: {
    recentFirstOrderCustomers: Array<{
      id: string;
      displayName?: string;
      firstOrderAt: string;
      fulfillmentStatus: string;
      feedbackStatus: string;
      hasSecondOrder: boolean;
      cohortAgeDays: number;
      isDueToReorder: boolean;
      reorderBasis?: string;
    }>;
    summary: {
      totalRecent: number;
      secondOrdersPlaced: number;
      openFeedbackIssues: number;
    };
  };
  playgroundRules: {
    monthlySpendCeilingCents: number;
    currency: string;
    approvalCategories: string[];
    monthToDateSpentCents: number;
    remainingBudgetCents: number;
  };
  customers: {
    activeCount: number;
    weeklyTrend: Array<{ weekStart: string; weekEnd: string; activeCount: number }>;
    dormantEligible: Array<{
      id: string;
      firstName: string;
      buildingName?: string;
      lastOrderAt: string;
      daysSinceLastOrder: number;
    }>;
    dormantCount: number;
  };
  accounts: Array<{
    id: string;
    name: string;
    address?: string;
    state: "Captured" | "Contested" | "Closed" | "Recovery" | "Wait";
    territoryId?: string;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    stage: string;
    lastMeaningfulInteraction?: string | null;
    nextAction?: string | null;
    nextActionDue?: string | null;
    source?: string | null;
    permissionState?: "granted" | "pending" | "opted_out" | "refused";
  }>;
  detectedGaps: OpportunityGap[];
  activation: Array<{
    propertyId: string;
    propertyName: string;
    approvalStatus: "approved" | "pending" | "none";
    residentCommunicationAllowed: boolean;
    qrKitsDeployed: boolean;
    firstOrderCount: number;
    blockedReason?: string | null;
  }>;
  capacity: {
    weeklyCapacityPounds: number;
    reservedPounds: number;
    availablePounds: number;
    utilizationPercent: number;
  };
  campaigns: Array<{
    campaignId: string;
    title: string;
    status: string;
    objective?: string;
  }>;
  commitments: {
    today: Array<{
      id: string;
      title: string;
      kind: string;
      status: string;
      scheduledAt?: string | null;
    }>;
    history14Days: {
      kept: number;
      missed: number;
      total: number;
    };
  };
  recentOutcomes: Array<{
    id: string;
    occurredAt: string;
    type: string;
    summary: string;
  }>;
  constraints: Array<{
    type: string;
    description: string;
  }>;
  unresolved: Array<{
    source: string;
    issue: string;
    severity: "warning" | "error";
  }>;
  activePath: {
    playId: string | null;
    playName: string | null;
    worldName: string | null;
    evidenceSummary: string | null;
  };
  recovery: {
    visibleItem: null | {
      id: string;
      title: string;
      missedAt: string;
      reason?: string;
    };
    queuedCount: number;
  };
};

export type StrategySnapshot = {
  id: string;
  tenantId: string;
  schemaVersion: number;
  contentHash: string;
  estimatedTokens: number;
  isTruncated: boolean;
  truncationDetails?: string[];
  payload: StrategySnapshotPayload;
  provenance: Record<string, ProvenanceRecord>;
  staleness: Record<string, StalenessRecord>;
  generatedAt: string;
  createdAt: string;
};
