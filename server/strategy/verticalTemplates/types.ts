/**
 * Vertical template contracts.
 *
 * The legacy StrategyEngine play fields remain below as scenario inputs for the
 * already-shipped strategy surface. Persistent-operator core code must consume
 * only the declarative VerticalTemplate contract and resolve executable readers
 * through the server-side VerticalRegistry.
 */

export type VerticalMetricDefinition = {
  /** Stable macro-goal metric key. */
  metricKey: string;
  /** Server-owned reader identity. Shared/client templates never carry callbacks. */
  authoritativeReaderId: string;
};

export type VerticalCampaignSeed = {
  /** Stable existing Campaign Library identity. */
  campaignId: string;
  /** Registered objective family used to map the seed into existing candidate architecture. */
  workFamily: string;
};

export type VerticalOutcomeDefinition = {
  outcomeDefinitionId: string;
  /** Stable identifier for the authoritative domain transition that can prove it. */
  authoritativeTransitionId: string;
};

export type VerticalPresentationDefaults = {
  fictionPackId?: string | null;
};

export type VerticalTemplate = {
  verticalKey: string;
  displayName: string;
  metricCatalog: readonly VerticalMetricDefinition[];
  opportunityKinds: readonly string[];
  campaignSeeds: readonly VerticalCampaignSeed[];
  obligationKinds: readonly string[];
  outcomeDefinitions: readonly VerticalOutcomeDefinition[];
  workFamilies: readonly string[];
  executionIntelligenceDoctrineFamilies: readonly string[];
  expectedSourceCapabilities: readonly string[];
  presentationDefaults: VerticalPresentationDefaults;

  /**
   * Compatibility-only StrategyEngine vocabulary. It is not an authoritative
   * persistent-operator input and must not be read by generic core modules.
   */
  legacyStrategy?: {
    funnelStages: readonly string[];
    playTemplates: readonly PlayTemplate[];
    stallReasons: readonly string[];
  };
};

/**
 * Existing StrategyEngine scenario shape. The numeric values are estimates used
 * by that legacy strategy surface only; they are not authoritative economics,
 * execution policy, or persistent-operator truth.
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
