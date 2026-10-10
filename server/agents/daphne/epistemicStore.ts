import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { daphneEpistemicClaims } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { recordDaphneMetricEvent } from "./metrics";

export const DAPHNE_CLAIM_TYPES = [
  "direct_fact",
  "statistical_regularity",
  "prediction",
  "latent_state_estimate",
  "person_distribution_estimate",
  "if_then_hypothesis",
  "relationship_hypothesis",
  "association_estimate",
  "treatment_effect_estimate",
  "contradiction",
  "supersession",
] as const;

export type DaphneClaimType = (typeof DAPHNE_CLAIM_TYPES)[number];

export const DAPHNE_EPISTEMIC_STATUSES = [
  "unknown",
  "insufficient_evidence",
  "association_only",
  "suggestive",
  "experimentally_supported",
  "context_specific",
  "possible_regime_change",
  "active",
  "contradicted",
  "superseded",
  "rejected",
] as const;

export type DaphneEpistemicStatus =
  (typeof DAPHNE_EPISTEMIC_STATUSES)[number];

export const DAPHNE_CAUSAL_EVIDENCE_STATUSES = [
  "none",
  "observational",
  "propensity_supported",
  "randomized",
] as const;

export type DaphneCausalEvidenceStatus =
  (typeof DAPHNE_CAUSAL_EVIDENCE_STATUSES)[number];

export type DaphneUncertaintyVector = {
  epistemic?: number | null;
  aleatoric?: number | null;
  change?: number | null;
  measurement?: number | null;
  decisionCost?: "low" | "medium" | "high" | null;
};

export type DaphneContextApplicability = {
  contextKeys?: string[];
  distinctContextCount?: number;
  notes?: string[];
};

export type RecordDaphneEpistemicClaimInput = {
  tenantId: string;
  canonicalOperatorId: string;
  agentId?: string | null;
  claimType: DaphneClaimType;
  claimKey: string;
  claim: Record<string, unknown>;
  sourceObservationIds: string[];
  supportingEvidence?: Record<string, unknown>[];
  counterEvidence?: Record<string, unknown>[];
  scope?: Record<string, unknown> | null;
  contextApplicability?: DaphneContextApplicability | null;
  uncertainty?: DaphneUncertaintyVector | null;
  epistemicStatus?: DaphneEpistemicStatus;
  causalEvidenceStatus?: DaphneCausalEvidenceStatus;
  validFrom?: string | Date | null;
  validUntil?: string | Date | null;
  lastReinforcedAt?: string | Date | null;
  modelVersion: string;
  humanPinned?: boolean;
  correctedByObservationId?: string | null;
  supersedesClaimId?: string | null;
  idempotencyKey: string;
};

export type DaphneEpistemicClaimRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  agentId: string | null;
  claimType: DaphneClaimType;
  claimKey: string;
  claim: Record<string, unknown>;
  sourceObservationIds: string[];
  supportingEvidence: Record<string, unknown>[];
  counterEvidence: Record<string, unknown>[];
  scope: Record<string, unknown> | null;
  contextApplicability: DaphneContextApplicability | null;
  uncertainty: DaphneUncertaintyVector | null;
  epistemicStatus: DaphneEpistemicStatus;
  causalEvidenceStatus: DaphneCausalEvidenceStatus;
  validFrom: string | null;
  validUntil: string | null;
  lastReinforcedAt: string | null;
  modelVersion: string;
  humanPinned: boolean;
  correctedByObservationId: string | null;
  supersedesClaimId: string | null;
  idempotencyKey: string;
  createdAt: string;
};

function required(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Daphne epistemic claim requires ${label}`);
  if (normalized.length > max) {
    throw new Error(`Daphne epistemic claim ${label} exceeds ${max} characters`);
  }
  return normalized;
}

function optional(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > max) {
    throw new Error(`Daphne epistemic claim optional value exceeds ${max} characters`);
  }
  return normalized;
}

function optionalDate(value: string | Date | null | undefined, label: string): Date | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Daphne epistemic claim ${label} must be a valid date`);
  }
  return parsed;
}

function distinctNonEmpty(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

export function daphneEpistemicClaimId(input: {
  tenantId: string;
  canonicalOperatorId: string;
  idempotencyKey: string;
}): string {
  const material = [
    required(input.tenantId, "tenantId", 64),
    required(input.canonicalOperatorId, "canonicalOperatorId", 191),
    required(input.idempotencyKey, "idempotencyKey", 191),
  ].join("\u0000");
  return `dclaim_${createHash("sha256").update(material).digest("hex").slice(0, 46)}`;
}

export function validateDaphneEpistemicClaim(
  input: RecordDaphneEpistemicClaimInput
): void {
  const sources = distinctNonEmpty(input.sourceObservationIds);
  if (!sources.length) {
    throw new Error("Daphne epistemic claims require source observations");
  }

  const causal = input.causalEvidenceStatus ?? "none";
  if (
    input.claimType === "treatment_effect_estimate" &&
    causal !== "propensity_supported" &&
    causal !== "randomized"
  ) {
    throw new Error(
      "Daphne treatment-effect estimates require propensity-supported or randomized evidence"
    );
  }

  if (input.claimType === "person_distribution_estimate") {
    const contexts = distinctNonEmpty(input.contextApplicability?.contextKeys ?? []);
    const count = Math.max(
      contexts.length,
      input.contextApplicability?.distinctContextCount ?? 0
    );
    if (count < 2) {
      throw new Error(
        "Daphne person-distribution estimates require evidence across at least two contexts"
      );
    }
  }

  if (input.claimType === "supersession" && !input.supersedesClaimId?.trim()) {
    throw new Error("Daphne supersession claims require supersedesClaimId");
  }

  if (input.claimType === "contradiction" && sources.length < 2) {
    throw new Error("Daphne contradiction claims require at least two source observations");
  }

  const from = optionalDate(input.validFrom, "validFrom");
  const until = optionalDate(input.validUntil, "validUntil");
  if (from && until && until.getTime() < from.getTime()) {
    throw new Error("Daphne epistemic claim validUntil cannot precede validFrom");
  }
}

export function normalizeDaphneEpistemicClaim(
  input: RecordDaphneEpistemicClaimInput
) {
  validateDaphneEpistemicClaim(input);
  const tenantId = required(input.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(
    input.canonicalOperatorId,
    "canonicalOperatorId",
    191
  );
  const idempotencyKey = required(input.idempotencyKey, "idempotencyKey", 191);
  const claimKey = required(input.claimKey, "claimKey", 191);
  const modelVersion = required(input.modelVersion, "modelVersion", 64);
  const sourceObservationIds = distinctNonEmpty(input.sourceObservationIds);

  return {
    id: daphneEpistemicClaimId({ tenantId, canonicalOperatorId, idempotencyKey }),
    tenantId,
    canonicalOperatorId,
    agentId: optional(input.agentId, 128),
    claimType: input.claimType,
    claimKey,
    claimJson: input.claim,
    sourceObservationIdsJson: sourceObservationIds,
    supportingEvidenceJson: input.supportingEvidence ?? [],
    counterEvidenceJson: input.counterEvidence ?? [],
    scopeJson: input.scope ?? null,
    contextApplicabilityJson: input.contextApplicability ?? null,
    uncertaintyJson: input.uncertainty ?? null,
    epistemicStatus: input.epistemicStatus ?? "active",
    causalEvidenceStatus: input.causalEvidenceStatus ?? "none",
    validFrom: optionalDate(input.validFrom, "validFrom"),
    validUntil: optionalDate(input.validUntil, "validUntil"),
    lastReinforcedAt: optionalDate(input.lastReinforcedAt, "lastReinforcedAt"),
    modelVersion,
    humanPinned: input.humanPinned ?? false,
    correctedByObservationId: optional(input.correctedByObservationId, 64),
    supersedesClaimId: optional(input.supersedesClaimId, 64),
    idempotencyKey,
  } as const;
}

function arrayOfObjects(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toRecord(
  row: typeof daphneEpistemicClaims.$inferSelect
): DaphneEpistemicClaimRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    agentId: row.agentId,
    claimType: row.claimType,
    claimKey: row.claimKey,
    claim: (row.claimJson as Record<string, unknown>) ?? {},
    sourceObservationIds: stringArray(row.sourceObservationIdsJson),
    supportingEvidence: arrayOfObjects(row.supportingEvidenceJson),
    counterEvidence: arrayOfObjects(row.counterEvidenceJson),
    scope: (row.scopeJson as Record<string, unknown> | null) ?? null,
    contextApplicability:
      (row.contextApplicabilityJson as DaphneContextApplicability | null) ?? null,
    uncertainty: (row.uncertaintyJson as DaphneUncertaintyVector | null) ?? null,
    epistemicStatus: row.epistemicStatus,
    causalEvidenceStatus: row.causalEvidenceStatus,
    validFrom: row.validFrom?.toISOString() ?? null,
    validUntil: row.validUntil?.toISOString() ?? null,
    lastReinforcedAt: row.lastReinforcedAt?.toISOString() ?? null,
    modelVersion: row.modelVersion,
    humanPinned: row.humanPinned,
    correctedByObservationId: row.correctedByObservationId,
    supersedesClaimId: row.supersedesClaimId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Idempotent append-only claim creation. Revision is expressed as another
 * typed claim (contradiction/supersession/correction evidence), not destructive
 * replacement of the historical derivation.
 */
export async function recordDaphneEpistemicClaim(
  input: RecordDaphneEpistemicClaimInput,
  persistence?: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "insert" | "select">
): Promise<DaphneEpistemicClaimRecord> {
  const normalized = normalizeDaphneEpistemicClaim(input);
  const db = persistence ?? await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .insert(daphneEpistemicClaims)
    .values(normalized)
    .onDuplicateKeyUpdate({ set: { id: normalized.id } });

  const [row] = await db
    .select()
    .from(daphneEpistemicClaims)
    .where(
      and(
        eq(daphneEpistemicClaims.tenantId, normalized.tenantId),
        eq(
          daphneEpistemicClaims.canonicalOperatorId,
          normalized.canonicalOperatorId
        ),
        eq(daphneEpistemicClaims.idempotencyKey, normalized.idempotencyKey)
      )
    )
    .limit(1);

  if (!row) throw new Error("Daphne epistemic claim did not persist");
  if(!persistence) await recordDaphneMetricEvent({
    tenantId: normalized.tenantId,
    canonicalOperatorId: normalized.canonicalOperatorId,
    agentId: normalized.agentId,
    eventName: "claim_created",
    properties: { claimType: normalized.claimType, epistemicStatus: normalized.epistemicStatus, causalEvidenceStatus: normalized.causalEvidenceStatus },
    sourceReference: row.id,
    idempotencyKey: `claim:${row.id}`,
  }).catch(() => undefined);
  return toRecord(row);
}

export async function listDaphneEpistemicClaims(input: {
  tenantId: string;
  canonicalOperatorId: string;
  claimType?: DaphneClaimType;
  agentId?: string;
  claimKey?: string;
  excludeConsolidationReceipts?: boolean;
  limit?: number;
}): Promise<DaphneEpistemicClaimRecord[]> {
  const tenantId = required(input.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(
    input.canonicalOperatorId,
    "canonicalOperatorId",
    191
  );
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const predicates = [
    eq(daphneEpistemicClaims.tenantId, tenantId),
    eq(daphneEpistemicClaims.canonicalOperatorId, canonicalOperatorId),
  ];
  if (input.claimType) {
    predicates.push(eq(daphneEpistemicClaims.claimType, input.claimType));
  }
  if (input.agentId?.trim()) {
    predicates.push(eq(daphneEpistemicClaims.agentId, input.agentId.trim()));
  }
  if (input.claimKey?.trim()) {
    predicates.push(eq(daphneEpistemicClaims.claimKey, input.claimKey.trim()));
  }
  if (input.excludeConsolidationReceipts) {
    predicates.push(sql`coalesce(json_unquote(json_extract(${daphneEpistemicClaims.scopeJson}, '$.purpose')), '') <> 'consolidation_receipt'`);
  }

  const rows = await db
    .select()
    .from(daphneEpistemicClaims)
    .where(and(...predicates))
    .orderBy(desc(daphneEpistemicClaims.createdAt))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 500)));

  return rows.map(toRecord);
}
