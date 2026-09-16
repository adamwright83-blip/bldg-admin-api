import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { opportunityStallReasons, strategyEvidence } from "../../drizzle/schema";
import { getDb } from "../db";
import { lintCausalLanguage, lintVerdictLanguage } from "./verdictLint";
import { getStrategyPlayById, type StrategyPlay } from "./playGenerator";

export type WorldSignal = "brighten" | "dim" | "none";

export interface PlayEvidenceRecord {
  id: string;
  tenantId: string;
  playId: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  funnelCounts: Record<string, number>;
  untrackedFunnelSteps: string[];
  statement: string;
  sampleSize: number;
  thresholdMet: boolean;
  worldSignal: WorldSignal;
  provenance: {
    computedAt: string;
    source: string;
    thresholdRule: string;
  };
}

export interface CustomerAttributionLink {
  tenantId: string;
  customerId: string;
  linkType: "qr_code" | "building" | "referral_source" | "mission_contact";
  linkRef: string;
  attributedPlayId?: string;
  recordedAt?: Date;
}

export type StallReasonType =
  | "timing"
  | "price"
  | "trust"
  | "pickup_convenience"
  | "existing_provider"
  | "access_restriction"
  | "service_issue"
  | "unknown";

export interface StallReasonRecord {
  id: string;
  tenantId: string;
  opportunityId?: string;
  source: string;
  reason: StallReasonType;
  detail?: string;
  recordedAt: string;
}

export interface BoundedExperimentInput {
  tenantId: string;
  hypothesis: string;
  targetAudience: string;
  costLimitCents: number;
  observationWindowDays: number;
  successMeasure: string;
}

// In-memory stores for offline/test environments
const memoryEvidence = new Map<string, PlayEvidenceRecord>();
const memoryAttributions = new Map<string, CustomerAttributionLink>();
const memoryStallReasons: StallReasonRecord[] = [];

function evidenceKey(tenantId: string, playId: string): string {
  return `${tenantId}:${playId}`;
}

/**
 * Computes evidence for a strategic play over an observation window.
 * Enforces:
 * - G5: Minimum-evidence threshold. Below threshold, worldSignal MUST be 'none'.
 * - G5: Plain factual statements, zero verdict language.
 * - G12: Zero causal claims ("linked to", not "caused by").
 * - Untracked funnel steps are explicitly preserved as untracked.
 */
export async function computePlayEvidence(input: {
  tenantId: string;
  playId: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  funnelCounts: Record<string, number>;
  untrackedFunnelSteps?: string[];
  exposureUnits?: number; // e.g. visits completed, tags deployed, contacts made
  linkedCustomers?: number;
}): Promise<PlayEvidenceRecord> {
  const play = getStrategyPlayById(input.playId);
  const minThresholdDays = play?.minimumEvidenceThreshold?.minDays ?? 14;
  const minExposureUnits = play?.minimumEvidenceThreshold?.minVolume ?? 6;

  const exposureUnits = input.exposureUnits ?? input.funnelCounts["visits"] ?? input.funnelCounts["deployed"] ?? 0;
  const linkedCustomers = input.linkedCustomers ?? input.funnelCounts["newCustomers"] ?? 0;
  const repeatOrders = input.funnelCounts["repeatOrders"] ?? 0;

  // 1. Evaluate minimum-evidence threshold (Guardrail G5)
  const windowSatisfied = input.windowDays >= minThresholdDays;
  const exposureSatisfied = exposureUnits >= minExposureUnits;
  const thresholdMet = windowSatisfied && exposureSatisfied;

  // 2. Derive world signal (reversible)
  let worldSignal: WorldSignal = "none";
  if (thresholdMet) {
    if (linkedCustomers > 0) {
      worldSignal = "brighten";
    } else {
      worldSignal = "dim";
    }
  } else {
    // Under G5: below threshold, NO world signal fires
    worldSignal = "none";
  }

  // 3. Construct plain factual statement
  const parts: string[] = [];
  parts.push(`${input.windowDays} days`);
  if (exposureUnits > 0) {
    parts.push(`${exposureUnits} actions deployed`);
  }
  parts.push(`${linkedCustomers} linked paying customer${linkedCustomers === 1 ? "" : "s"}`);
  if (repeatOrders > 0) {
    parts.push(`${repeatOrders} repeat order${repeatOrders === 1 ? "" : "s"}`);
  }
  const statement = parts.join(", ") + ".";

  // Verify statement passes G5 verdict lint and G12 causation lint
  const vLint = lintVerdictLanguage(statement);
  if (!vLint.valid) {
    throw new Error(`Evidence statement failed G5 verdict lint: ${vLint.violations.join("; ")}`);
  }
  const cLint = lintCausalLanguage(statement);
  if (!cLint.valid) {
    throw new Error(`Evidence statement failed G12 causal lint: ${cLint.violations.join("; ")}`);
  }

  const id = `ev_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  const record: PlayEvidenceRecord = {
    id,
    tenantId: input.tenantId,
    playId: input.playId,
    windowDays: input.windowDays,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    funnelCounts: input.funnelCounts,
    untrackedFunnelSteps: input.untrackedFunnelSteps ?? [],
    statement,
    sampleSize: exposureUnits,
    thresholdMet,
    worldSignal,
    provenance: {
      computedAt: now,
      source: "evidenceEngine:computePlayEvidence",
      thresholdRule: `minDays: ${minThresholdDays}, minExposure: ${minExposureUnits}`,
    },
  };

  // Persist to memory
  memoryEvidence.set(evidenceKey(input.tenantId, input.playId), record);

  // Persist to DB if available
  const db = await getDb();
  if (db) {
    try {
      await db.insert(strategyEvidence).values({
        id,
        tenantId: input.tenantId,
        playId: input.playId,
        windowDays: input.windowDays,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        funnelCountsJson: input.funnelCounts,
        untrackedFunnelStepsJson: record.untrackedFunnelSteps,
        statement,
        sampleSize: exposureUnits,
        thresholdMet,
        worldSignal,
        provenanceJson: record.provenance,
      });
    } catch {
      // optional
    }
  }

  return record;
}

/**
 * Explicit customer attribution.
 * Links a customer to a strategic play ONLY through an explicit link.
 * Unlinked customers are recorded as unattributed.
 */
export async function attributeCustomer(input: {
  tenantId: string;
  customerId: string;
  linkType?: "qr_code" | "building" | "referral_source" | "mission_contact";
  linkRef?: string;
  attributedPlayId?: string;
}): Promise<{
  attributed: boolean;
  playId: string | null;
  linkType: string | null;
  status: "linked" | "unattributed";
}> {
  if (!input.linkType || !input.linkRef) {
    return {
      attributed: false,
      playId: null,
      linkType: null,
      status: "unattributed",
    };
  }

  const attribution: CustomerAttributionLink = {
    tenantId: input.tenantId,
    customerId: input.customerId,
    linkType: input.linkType,
    linkRef: input.linkRef,
    attributedPlayId: input.attributedPlayId,
    recordedAt: new Date(),
  };

  memoryAttributions.set(`${input.tenantId}:${input.customerId}`, attribution);

  return {
    attributed: true,
    playId: input.attributedPlayId ?? null,
    linkType: input.linkType,
    status: "linked",
  };
}

/**
 * Capture structured stall reasons linked to opportunity and source.
 */
export async function recordOpportunityStallReason(input: {
  tenantId: string;
  opportunityId?: string;
  source: string;
  reason: StallReasonType;
  detail?: string;
}): Promise<StallReasonRecord> {
  const id = `stall_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  const record: StallReasonRecord = {
    id,
    tenantId: input.tenantId,
    opportunityId: input.opportunityId,
    source: input.source,
    reason: input.reason,
    detail: input.detail,
    recordedAt: now,
  };

  memoryStallReasons.push(record);

  const db = await getDb();
  if (db) {
    try {
      await db.insert(opportunityStallReasons).values({
        id,
        tenantId: input.tenantId,
        opportunityId: input.opportunityId,
        source: input.source,
        reason: input.reason,
        detail: input.detail,
        recordedAt: new Date(now),
      });
    } catch {
      // optional
    }
  }

  return record;
}

/**
 * Propose a bounded experiment as a candidate play offer.
 * Requires hypothesis, audience, cost limit, observation window, and success measure.
 * Stays in 'candidate' status—never automatically runs until operator chooses.
 */
export async function proposeBoundedExperiment(
  input: BoundedExperimentInput
): Promise<StrategyPlay> {
  if (!input.hypothesis || !input.targetAudience || !input.successMeasure) {
    throw new Error("Bounded experiment requires hypothesis, target audience, and success measure.");
  }
  if (input.costLimitCents < 0 || input.observationWindowDays <= 0) {
    throw new Error("Bounded experiment requires valid cost limit and observation window days.");
  }

  const playId = `exp_${randomUUID().slice(0, 8)}`;
  const experimentPlay: StrategyPlay = {
    id: `exp_${randomUUID().slice(0, 12)}`,
    tenantId: input.tenantId,
    businessName: `Experiment: ${input.hypothesis.slice(0, 40)}`,
    worldName: "The Uncharted Way",
    hypothesis: input.hypothesis,
    primaryMetric: "new_paying_customers",
    geography: "Flexible",
    stopsCount: 1,
    isClustered: false,
    estimatedInitiationCost: 50,
    estimatedSpendCents: input.costLimitCents,
    spendCategory: "paid_growth",
    confidence: "low",
    scoreBreakdown: {
      policyVersion: "2026.09.1",
      opportunityAdvancement: 10,
      urgencyAndSpeed: 10,
      repeatPotential: 10,
      capacityFeasibility: 10,
      initiationEffortPenalty: -10,
      geographicClusteringBonus: 0,
      unknownEconomicsScore: 0,
      avoidancePenalty: 0,
      totalScore: 50,
    },
    totalScore: 50,
    status: "candidate", // NEVER auto-runs
    needsApprovalToRun: input.costLimitCents > 0,
    minimumEvidenceThreshold: {
      minDays: input.observationWindowDays,
      days: input.observationWindowDays,
      minVolume: 10,
      minimumExposureUnits: 10,
      volumeUnit: "responses",
    } as any,
    verticalKey: "laundry_fluff_fold",
    templateKey: "experiment",
    provenance: `experiment:audience=${input.targetAudience};success=${input.successMeasure}` as any,
    createdAt: new Date().toISOString(),
  };

  return experimentPlay;
}

/**
 * Retrieve latest evidence for a play.
 */
export async function getPlayEvidence(tenantId: string, playId: string): Promise<PlayEvidenceRecord | null> {
  const db = await getDb();
  if (db) {
    try {
      const [row] = await db
        .select()
        .from(strategyEvidence)
        .where(and(eq(strategyEvidence.tenantId, tenantId), eq(strategyEvidence.playId, playId)))
        .limit(1);
      if (row) {
        return {
          id: row.id,
          tenantId: row.tenantId,
          playId: row.playId,
          windowDays: row.windowDays,
          windowStart: row.windowStart,
          windowEnd: row.windowEnd,
          funnelCounts: row.funnelCountsJson as Record<string, number>,
          untrackedFunnelSteps: row.untrackedFunnelStepsJson as string[],
          statement: row.statement,
          sampleSize: row.sampleSize,
          thresholdMet: Boolean(row.thresholdMet),
          worldSignal: row.worldSignal as WorldSignal,
          provenance: row.provenanceJson as PlayEvidenceRecord["provenance"],
        };
      }
    } catch {
      // Fallback
    }
  }

  return memoryEvidence.get(evidenceKey(tenantId, playId)) ?? null;
}

/**
 * Retrieve stall reasons for an opportunity or tenant.
 */
export function getStallReasons(tenantId: string, opportunityId?: string): StallReasonRecord[] {
  return memoryStallReasons.filter(r => r.tenantId === tenantId && (!opportunityId || r.opportunityId === opportunityId));
}

export function _clearEvidenceStores(): void {
  memoryEvidence.clear();
  memoryAttributions.clear();
  memoryStallReasons.length = 0;
}
