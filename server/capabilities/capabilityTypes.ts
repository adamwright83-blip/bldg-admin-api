import type { DataQuality, ProvenancedValue } from "../../shared/businessGame";

export type CapabilityStatus = "LOCKED" | "APPROACHING" | "READY" | "ACTIVE" | "NO_LONGER_READY";
export type CapabilityKey = "FIRST_HIRE_READY";

export type CapabilityEvaluation = {
  capability: CapabilityKey;
  status: CapabilityStatus;
  evaluatedAt: string;
  confidence: "high" | "medium" | "low";
  evidence: Array<{ metric: string; actual: ProvenancedValue<number>; policyThreshold: string; passes: boolean | null }>;
  blockingConditions: string[];
  supportingMetrics: Record<string, number | null>;
  assumptions: string[];
  nextReevaluationConditions: string[];
  dataQuality: DataQuality;
};
