/** StrategyEngine evidence and reasoning; never execution or ranking authority. */
export type BusinessDriver =
  | "acquisition"
  | "conversion"
  | "retention"
  | "frequency"
  | "pricing"
  | "transaction_value"
  | "contribution"
  | "capacity"
  | "fulfillment"
  | "differentiation"
  | "market_selection"
  | "cash_flow"
  | "investigation";
export type StrategyEvidence = {
  id: string;
  tenantId: string;
  source: string;
  capturedAt: string;
  classification: "verified" | "operator_input" | "estimate" | "hypothesis";
  value: number | string | null;
  unit: string;
  quality: "complete" | "partial" | "stale" | "unavailable";
  description: string;
};
export type MarketTerritory = {
  id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radiusMiles: number | null;
  sourceRef: string;
  capturedAt: string;
};
export type MarketObservation = {
  id: string;
  name: string;
  territoryId: string;
  latitude: number;
  longitude: number;
  source: string;
  sourceUrl: string | null;
  capturedAt: string;
  classification: "sourced_fact";
  demandVerified: false;
};
export type StrategyMarketContext = {
  tenantId: string;
  mode: "physical" | "online" | "unresolved";
  territories: MarketTerritory[];
  observations: MarketObservation[];
  limitations: string[];
};
export type StrategyAction = {
  id: string;
  title: string;
  driver: BusinessDriver;
  motion:
    | "retention"
    | "customer_recovery"
    | "account_acquisition"
    | "investigation";
  hypothesis: string;
  rationale: string;
  completionCondition: string;
  leadingIndicator: string;
  intendedOutcome: string;
  evidenceRefs: string[];
  reviewCondition: string;
  territoryId: string | null;
};
export type StrategyOption = {
  id: string;
  approach: string;
  driver: BusinessDriver;
  evidenceRefs: string[];
  economics: string;
  cost: string;
  effort: string;
  timeToResults: string;
  capacity: string;
  risk: string;
  reversibility: string;
  eligible: boolean;
  reason: string;
  /** Observed numbers this option rests on; absent figures are named as missing. */
  observedBasis?: string;
  /** Arithmetic on observed averages only; never a forecast, ROI, or profit claim. */
  expectedBenefit?: string;
  uncertainty?: string;
  nextMeasurableAction?: string;
};
export type StrategicDiagnosis = {
  /** The operator's stated objective this diagnosis serves, when one exists. */
  objective?: { statement: string; area: string };
  id: string;
  schemaVersion: 1;
  doctrineVersion: string;
  tenantId: string;
  canonicalOperatorId: string;
  verticalKey: string;
  businessDate: string;
  generatedAt: string;
  goal: {
    statement: string;
    metricKey: string;
    target: number;
    current: number | null;
    evidenceRef: string | null;
  };
  currentCondition: string;
  primaryConstraint: BusinessDriver;
  diagnosis: string;
  supportingEvidence: string[];
  competingExplanations: string[];
  options: StrategyOption[];
  selectedOptionId: string;
  selectedApproach: string;
  notPrioritized: string[];
  economicAssumptions: string[];
  customerUnderstanding: string;
  localFit: string;
  industryFit: string;
  actions: StrategyAction[];
  successMeasures: string[];
  revisionTrigger: string;
  uncertainty: string[];
  evidence: StrategyEvidence[];
  market: StrategyMarketContext;
  outcomeRefs: string[];
  quality: {
    structuralErrors: string[];
    judgment: "unreviewed" | "acceptable" | "revise" | "unavailable";
    reasons: string[];
  };
};
export type StrategicProposalItem = {
  id: string;
  businessDate: string;
  title: string;
  objective: string;
  executionType: "mission" | "challenge";
  candidateId: string;
  /** Mission Director source kind; identifies matching missions for Daphne. */
  missionType?: string;
  /** Proposed time of day, from the operator's own feedback to Daphne. */
  timeWindow?: { window: "morning" | "afternoon" | "evening"; time?: string; reason: string; sourceObservationId: string };
  /** Approved Day Line commitments this item replaces (e.g. a rescheduled meeting); cancelled only on approval. */
  supersedesCommitmentIds?: string[];
  planId: string;
  planRevision: number;
  evidenceRefs: string[];
};
export type StrategicPlanningProposal = {
  id: string;
  schemaVersion: 1;
  revision: string;
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  weekStart: string;
  businessDate: string;
  timeZone: string;
  preparedAt: string;
  expiresAt: string;
  diagnosis: StrategicDiagnosis;
  items: StrategicProposalItem[];
  constraints: string[];
  uncertainty: string[];
  opening: string;
  approvalState: "pending" | "approved" | "rejected" | "deferred";
  /** The week's production plan: one throughline, a sequence, and what changed. */
  weeklyPlan?: WeeklyProductionPlan;
};

export type WeeklyProductionPlan = {
  objective: string;
  outcomes: string[];
  evidence: string;
  sequence: Array<{ date: string; itemId: string; title: string; window: string | null; why: string; status: "draft" | "commitment" }>;
  preparation: string[];
  commitments: string[];
  contingency: string;
  adaptations: string[];
  uncertainty: string[];
  changes: Array<{ at: string; summary: string }>;
};
