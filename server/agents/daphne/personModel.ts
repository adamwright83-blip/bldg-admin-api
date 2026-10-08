import { recordDaphneEpistemicClaim } from "./epistemicStore";

export type DaphneBehaviorSample = {
  observationId: string;
  dimension: string;
  value: number;
  contextKey: string;
  occurredAt: string;
};

export type DaphnePersonDistribution = {
  dimension: string;
  mean: number;
  variance: number;
  observedMin: number;
  observedMax: number;
  sampleCount: number;
  distinctContextCount: number;
  contextKeys: string[];
  lastObservedAt: string;
  sourceObservationIds: string[];
  epistemicStatus: "suggestive" | "active";
};

export type DaphneIfThenSample = {
  observationId: string;
  conditionValue: string;
  outcome: boolean;
  occurredAt: string;
};

export type DaphneIfThenSignature = {
  conditionKey: string;
  conditionValue: string;
  outcomeKey: string;
  conditionRate: number;
  otherRate: number | null;
  difference: number | null;
  conditionN: number;
  otherN: number;
  sourceObservationIds: string[];
  epistemicStatus: "association_only";
};

const FORBIDDEN_DIMENSION_PATTERNS = [
  /\badhd\b/i,
  /\bbipolar\b/i,
  /\bdepress(?:ion|ed)?\b/i,
  /\banxiety disorder\b/i,
  /\bpersonality disorder\b/i,
];

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Daphne Person model requires ${label}`);
  return normalized;
}

function bounded(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("Daphne behavior samples must be normalized to [0,1]");
  }
  return value;
}

export function assertDaphnePersonDimension(dimension: string): void {
  const value = required(dimension, "dimension");
  if (FORBIDDEN_DIMENSION_PATTERNS.some(pattern => pattern.test(value))) {
    throw new Error(
      "Daphne Person dimensions cannot encode unsupported clinical diagnoses"
    );
  }
}

export function deriveDaphnePersonDistribution(input: {
  samples: DaphneBehaviorSample[];
  minSamples?: number;
}): DaphnePersonDistribution {
  if (!input.samples.length) {
    throw new Error("Daphne Person distribution requires observations");
  }
  const dimension = required(input.samples[0].dimension, "dimension");
  assertDaphnePersonDimension(dimension);
  if (input.samples.some(item => item.dimension.trim() !== dimension)) {
    throw new Error("Daphne Person distribution cannot mix dimensions");
  }

  const minSamples = Math.max(2, Math.min(input.minSamples ?? 4, 100));
  if (input.samples.length < minSamples) {
    throw new Error(
      `Daphne Person distribution requires at least ${minSamples} observations`
    );
  }

  const contexts = Array.from(
    new Set(input.samples.map(item => required(item.contextKey, "contextKey")))
  );
  if (contexts.length < 2) {
    throw new Error(
      "Daphne Person distribution requires evidence across at least two contexts"
    );
  }

  const values = input.samples.map(item => bounded(item.value));
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const ordered = input.samples
    .slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  return {
    dimension,
    mean: Number(mean.toFixed(4)),
    variance: Number(variance.toFixed(4)),
    observedMin: Math.min(...values),
    observedMax: Math.max(...values),
    sampleCount: values.length,
    distinctContextCount: contexts.length,
    contextKeys: contexts.sort(),
    lastObservedAt: ordered[0].occurredAt,
    sourceObservationIds: Array.from(
      new Set(input.samples.map(item => item.observationId))
    ),
    epistemicStatus:
      values.length >= minSamples * 2 && contexts.length >= 3 ? "active" : "suggestive",
  };
}

export function deriveDaphneIfThenSignature(input: {
  conditionKey: string;
  conditionValue: string;
  outcomeKey: string;
  samples: DaphneIfThenSample[];
}): DaphneIfThenSignature {
  const conditionKey = required(input.conditionKey, "conditionKey");
  const conditionValue = required(input.conditionValue, "conditionValue");
  const outcomeKey = required(input.outcomeKey, "outcomeKey");
  if (!input.samples.length) {
    throw new Error("Daphne if/then signature requires observations");
  }

  const condition = input.samples.filter(
    item => item.conditionValue === conditionValue
  );
  const other = input.samples.filter(
    item => item.conditionValue !== conditionValue
  );
  if (!condition.length) {
    throw new Error("Daphne if/then signature requires condition evidence");
  }

  const rate = (items: DaphneIfThenSample[]) =>
    items.filter(item => item.outcome).length / items.length;
  const conditionRate = rate(condition);
  const otherRate = other.length ? rate(other) : null;

  return {
    conditionKey,
    conditionValue,
    outcomeKey,
    conditionRate: Number(conditionRate.toFixed(4)),
    otherRate: otherRate == null ? null : Number(otherRate.toFixed(4)),
    difference:
      otherRate == null
        ? null
        : Number((conditionRate - otherRate).toFixed(4)),
    conditionN: condition.length,
    otherN: other.length,
    sourceObservationIds: Array.from(
      new Set(input.samples.map(item => item.observationId))
    ),
    epistemicStatus: "association_only",
  };
}

export async function persistDaphnePersonDistribution(input: {
  tenantId: string;
  canonicalOperatorId: string;
  distribution: DaphnePersonDistribution;
  modelVersion: string;
}): Promise<void> {
  await recordDaphneEpistemicClaim({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    claimType: "person_distribution_estimate",
    claimKey: `person:${input.distribution.dimension}`,
    claim: input.distribution,
    sourceObservationIds: input.distribution.sourceObservationIds,
    contextApplicability: {
      contextKeys: input.distribution.contextKeys,
      distinctContextCount: input.distribution.distinctContextCount,
    },
    uncertainty: {
      epistemic: Number((1 / input.distribution.sampleCount).toFixed(4)),
      aleatoric: input.distribution.variance,
    },
    epistemicStatus: input.distribution.epistemicStatus,
    causalEvidenceStatus: "none",
    lastReinforcedAt: input.distribution.lastObservedAt,
    modelVersion: input.modelVersion,
    idempotencyKey:
      `person:${input.distribution.dimension}:${input.distribution.lastObservedAt}`,
  });
}

export async function persistDaphneIfThenSignature(input: {
  tenantId: string;
  canonicalOperatorId: string;
  signature: DaphneIfThenSignature;
  modelVersion: string;
}): Promise<void> {
  await recordDaphneEpistemicClaim({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    claimType: "if_then_hypothesis",
    claimKey:
      `if:${input.signature.conditionKey}=${input.signature.conditionValue}:then:${input.signature.outcomeKey}`,
    claim: input.signature,
    sourceObservationIds: input.signature.sourceObservationIds,
    contextApplicability: {
      contextKeys: [input.signature.conditionValue],
      distinctContextCount: input.signature.otherN > 0 ? 2 : 1,
    },
    uncertainty: {
      epistemic: Number(
        (1 / Math.max(1, input.signature.conditionN + input.signature.otherN)).toFixed(4)
      ),
    },
    epistemicStatus: "association_only",
    causalEvidenceStatus: "observational",
    modelVersion: input.modelVersion,
    idempotencyKey:
      `if-then:${input.signature.conditionKey}:${input.signature.conditionValue}:${input.signature.sourceObservationIds.join(",")}`,
  });
}
