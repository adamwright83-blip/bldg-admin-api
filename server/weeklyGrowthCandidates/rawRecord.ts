import type { WeeklyGrowthMotion, WeeklyGrowthPocketKind } from "../../shared/weeklyGrowthCandidates";

/**
 * One row from a read-only source, before filter, dedupe, rank, and cap.
 * Tests build these directly. Production readers map authoritative rows into them.
 */
export type WeeklyGrowthRawOrigin =
  | "day_director_commitment"
  | "commercial_mission"
  | "ops_task"
  | "campaign_run"
  | "commercial_follow_up"
  | "proactive_obligation"
  | "churn_snapshot"
  | "campaign_template"
  | "strategy_snapshot"
  | "mission_sequencer";

export type WeeklyGrowthGrounding =
  | "growth_tagged"
  | "sales"
  | "campaign_linked"
  | "commercial_acquisition"
  | "commercial_follow_up"
  | "proactive_recovery";

export type WeeklyGrowthOperationalClass =
  | "pickup"
  | "dropoff"
  | "route"
  | "plant"
  | "laundry_processing"
  | "procurement"
  | "housekeeping"
  | "cargo"
  | "maintenance"
  | "admin";

export type WeeklyGrowthAssumptionDraft = {
  text: string;
  source: string;
  recordedAt: string;
  confidence: "low" | "medium" | "high" | null;
  evidenceClass: string | null;
};

export type WeeklyGrowthRawRecord = {
  tenantId: string;
  operatorUserId: string | null;
  actorId: string | null;
  origin: WeeklyGrowthRawOrigin;
  sourceId: string;
  title: string;
  objective: string;
  status: string;
  grounding: WeeklyGrowthGrounding | null;
  operationalClass: WeeklyGrowthOperationalClass | null;
  motionHint: WeeklyGrowthMotion | null;
  obligationKind: "dormant_recovery" | "sales_follow_up" | "data_health" | null;
  campaignId: string | null;
  followUpId: string | null;
  missionId: string | null;
  customerKey: string | null;
  obligationId: string | null;
  commitmentId: string | null;
  opsTaskId: string | null;
  runId: string | null;
  /** Extra stable dedupe keys, already prefixed (`obligation:…`). */
  aliasKeys: string[];
  dueDate: string | null;
  alreadyInFlight: boolean;
  existingScore: number | null;
  historyOrderCount: number | null;
  daysSinceLastOrder: number | null;
  activeOrderCount: number | null;
  estimatedMonthlyImpactCents: number | null;
  averageOrderValueCents: number | null;
  churnGrade: "low" | "medium" | "high" | null;
  recommendedAction: "watch" | "prepare_win_back" | "contact_now" | null;
  prepLeadDays: number;
  prepCondition: string | null;
  pocketKind: WeeklyGrowthPocketKind | null;
  minimumMinutes: number | null;
  assumptions: WeeklyGrowthAssumptionDraft[];
  confidence: "low" | "medium" | "high" | null;
  fixture: boolean;
};

export type WeeklyGrowthMacroSnapshot = {
  id: string;
  metricKey: string;
  objective: string;
};

export type SourceAvailability<T> =
  | { status: "available"; records: T[] }
  | { status: "unavailable"; reason: string };

export type WeeklyGrowthSourceBundle = {
  unfinished: SourceAvailability<WeeklyGrowthRawRecord>;
  commercialFollowUps: SourceAvailability<WeeklyGrowthRawRecord>;
  proactiveObligations: SourceAvailability<WeeklyGrowthRawRecord>;
  recovery: SourceAvailability<WeeklyGrowthRawRecord>;
  campaigns: SourceAvailability<WeeklyGrowthRawRecord>;
  macroGoal: SourceAvailability<WeeklyGrowthMacroSnapshot>;
};

export function emptyRawRecord(overrides: Partial<WeeklyGrowthRawRecord> & Pick<WeeklyGrowthRawRecord, "origin" | "sourceId" | "tenantId">): WeeklyGrowthRawRecord {
  return {
    operatorUserId: null,
    actorId: null,
    title: "",
    objective: "",
    status: "open",
    grounding: null,
    operationalClass: null,
    motionHint: null,
    obligationKind: null,
    campaignId: null,
    followUpId: null,
    missionId: null,
    customerKey: null,
    obligationId: null,
    commitmentId: null,
    opsTaskId: null,
    runId: null,
    aliasKeys: [],
    dueDate: null,
    alreadyInFlight: false,
    existingScore: null,
    historyOrderCount: null,
    daysSinceLastOrder: null,
    activeOrderCount: null,
    estimatedMonthlyImpactCents: null,
    averageOrderValueCents: null,
    churnGrade: null,
    recommendedAction: null,
    prepLeadDays: 0,
    prepCondition: null,
    pocketKind: null,
    minimumMinutes: null,
    assumptions: [],
    confidence: null,
    fixture: false,
    ...overrides,
  };
}
