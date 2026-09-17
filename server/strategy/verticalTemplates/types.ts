/**
 * Vertical Template Types (Guardrail G13)
 * Isolates trade-specific assumptions (stages, plays, activation) from core StrategyEngine.
 */

export type PlayTemplate = {
  templateKey: string;
  businessName: string;
  worldName: string;
  hypothesis: string;
  primaryMetric: string;
  geography: string;
  baseStops: number;
  isClustered: boolean;
  estimatedInitiationCost: number;
  defaultEstimatedSpendCents: number;
  spendCategory: string;
  confidence: "high" | "medium" | "low";
  minimumEvidenceThreshold: {
    minDays: number;
    minVolume: number;
    volumeUnit: string;
  };
};

export type VerticalTemplate = {
  verticalKey: string;
  displayName: string;
  funnelStages: string[];
  playTemplates: PlayTemplate[];
  stallReasons: string[];
};
