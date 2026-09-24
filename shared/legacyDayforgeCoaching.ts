/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";

export const DAYFORGE_CLAIM_PROVENANCE_TYPES = [
  "provider_sourced",
  "operator_observation",
  "crm_history",
  "deterministic_estimate",
  "general_industry_guidance",
  "model_inference",
  "unknown",
] as const;

export type LegacyDayforgeClaimProvenance =
  (typeof DAYFORGE_CLAIM_PROVENANCE_TYPES)[number];

export const DAYFORGE_COACHING_CLAIM_KEYS = [
  "recommended_role",
  "role_rationale",
  "first_navigation_point",
  "fallback_navigation_point",
  "opening_line",
  "discovery_question",
  "objection_category",
  "decision_maker_name",
  "account_type",
  "address",
  "portfolio_size",
  "unit_count",
  "distance",
  "estimated_annual_value",
  "current_vendor",
  "reporting_line",
  "approved_offer",
  "prior_visit",
] as const;

export type LegacyDayforgeCoachingClaimKey =
  (typeof DAYFORGE_COACHING_CLAIM_KEYS)[number];

export const legacyLegacyDayforgeEvidenceReferenceSchema = z.object({
  id: z.string().trim().min(1).max(191),
  sourceType: z.enum(DAYFORGE_CLAIM_PROVENANCE_TYPES),
  capturedAt: z.string().datetime(),
  sourceUrl: z.string().url().max(2048).nullable(),
  formulaVersion: z.string().trim().min(1).max(64).nullable(),
  formula: z.string().trim().min(1).max(512).nullable(),
  inputs: z.record(
    z.string(),
    z.union([z.string().max(512), z.number(), z.boolean()]),
  )
    .refine(value => Object.keys(value).length <= 20, "At most 20 evidence inputs are allowed")
    .nullable(),
}).strict();

export type LegacyDayforgeEvidenceReference = z.infer<
  typeof legacyLegacyDayforgeEvidenceReferenceSchema
>;

export const legacyLegacyDayforgeCoachingClaimSchema = z.object({
  key: z.enum(DAYFORGE_COACHING_CLAIM_KEYS),
  displayValue: z.string().trim().min(1).max(512),
  provenance: z.enum(DAYFORGE_CLAIM_PROVENANCE_TYPES),
  confidence: z.enum(["high", "medium", "low"]),
  evidenceReferenceId: z.string().trim().min(1).max(191).nullable(),
  capturedAt: z.string().datetime(),
  safeForDirectInstruction: z.boolean(),
  grounded: z.boolean(),
}).strict();

export type LegacyDayforgeCoachingClaim = {
  key: LegacyDayforgeCoachingClaimKey;
  displayValue: string;
  provenance: LegacyDayforgeClaimProvenance;
  confidence: "high" | "medium" | "low";
  evidenceReferenceId: string | null;
  capturedAt: string;
  safeForDirectInstruction: boolean;
  grounded: boolean;
};

export type LegacyDayforgeCoachingOutput = {
  recommendedRole: string;
  roleRationale: string;
  firstNavigationPoint: string;
  fallbackNavigationPoint: string;
  openingLine: string;
  discoveryQuestions: string[];
  likelyObjectionCategories: string[];
  doNotClaim: string[];
  unknowns: string[];
  claims: LegacyDayforgeCoachingClaim[];
  generatedSummary: string;
};

export type LegacyDayforgeEvidenceEnvelope = {
  key: string;
  value: string | number | boolean;
  provenance: LegacyDayforgeClaimProvenance;
  evidenceReferenceId: string | null;
  capturedAt: string;
};

export const legacyLegacyDayforgeCoachingOutputSchema = z.object({
  recommendedRole: z.string().trim().min(1).max(120),
  roleRationale: z.string().trim().min(1).max(500),
  firstNavigationPoint: z.string().trim().min(1).max(240),
  fallbackNavigationPoint: z.string().trim().min(1).max(240),
  openingLine: z.string().trim().min(1).max(500),
  discoveryQuestions: z.array(z.string().trim().min(1).max(300)).min(1).max(3),
  likelyObjectionCategories: z.array(z.string().trim().min(1).max(120)).max(3),
  doNotClaim: z.array(z.string().trim().min(1).max(300)).max(10),
  unknowns: z.array(z.string().trim().min(1).max(300)).max(10),
  claims: z.array(legacyLegacyDayforgeCoachingClaimSchema).max(30),
  generatedSummary: z.string().trim().min(1).max(800),
}).strict();

export const legacyLegacyDayforgeModelCoachingOutputSchema = legacyLegacyDayforgeCoachingOutputSchema
  .omit({ claims: true })
  .extend({
    claims: z.array(z.object({
      key: z.enum(DAYFORGE_COACHING_CLAIM_KEYS),
      displayValue: z.string().trim().min(1).max(512),
      evidenceReferenceId: z.string().trim().min(1).max(191).nullable(),
    }).strict()).max(30),
  })
  .strict();

export function claimMayBePresentedAsVerified(
  claim: LegacyDayforgeCoachingClaim,
): boolean {
  if (!claim.grounded || !claim.evidenceReferenceId) return false;
  return ["provider_sourced", "operator_observation", "crm_history"].includes(
    claim.provenance,
  );
}

export function claimMayDriveDirectInstruction(
  claim: LegacyDayforgeCoachingClaim,
): boolean {
  if (!claim.safeForDirectInstruction) return false;
  return (
    claim.provenance === "general_industry_guidance" ||
    claimMayBePresentedAsVerified(claim)
  );
}
