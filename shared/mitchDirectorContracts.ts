import { z } from "zod";

export const MITCH_DIRECTOR_DIAGNOSES = [
  "implementation_bug",
  "game_feel",
  "ux_discoverability",
  "content_shortage",
  "progression",
  "core_loop",
  "fantasy_mismatch",
  "narrative",
  "pacing",
  "technical_limitation",
  "insufficient_evidence",
] as const;
export type MitchDirectorDiagnosis = (typeof MITCH_DIRECTOR_DIAGNOSES)[number];

export const MITCH_DIRECTOR_DISPOSITIONS = [
  "authorize_probe",
  "do_not_build",
  "blocked_awaiting_human_observation",
  "confounded_probe",
] as const;
export type MitchDirectorDisposition = (typeof MITCH_DIRECTOR_DISPOSITIONS)[number];

export const MITCH_EVIDENCE_KINDS = [
  "coding_agent_intuition",
  "llm_design_opinion",
  "agent_consensus",
  "automated_gameplay_script",
  "founder_playtest",
  "naive_first_time",
  "repeated_naive_pattern",
  "telemetry",
  "quote",
  "observed_behavior",
  "hinted_comparison",
] as const;
export type MitchEvidenceKind = (typeof MITCH_EVIDENCE_KINDS)[number];

export const MITCH_VERB_STATUSES = [
  "unknown",
  "unproven",
  "probing",
  "proven",
  "killed",
] as const;

export const mitchEvidenceSchema = z.object({
  id: z.string().min(1),
  sha: z.string().min(1),
  kind: z.enum(MITCH_EVIDENCE_KINDS),
  subject: z.string().min(1),
  goalSpoiled: z.boolean().default(false),
  raw: z.string().min(1),
  classification: z.string().nullable().default(null),
  confidence: z.enum(["low", "medium", "high", "unknown"]).default("unknown"),
  establishes: z.array(z.string()).default([]),
  doesNotEstablish: z.array(z.string()).default([]),
});
export type MitchEvidence = z.infer<typeof mitchEvidenceSchema>;

export const mitchVerbSchema = z.object({
  verbId: z.string().min(1),
  name: z.string().min(1),
  cadence: z.enum(["second", "session", "campaign", "unknown"]),
  skill: z.enum(["perceptual", "motor", "strategic", "none", "unknown"]),
  intentional: z.boolean().nullable(),
  status: z.enum(MITCH_VERB_STATUSES),
  statusEvidenceIds: z.array(z.string()).default([]),
  killedReason: z.string().nullable().default(null),
});
export type MitchVerb = z.infer<typeof mitchVerbSchema>;

export const mitchContentRoleSchema = z.object({
  roleId: z.string().min(1),
  role: z.string().min(1),
  examples: z.array(z.string()).default([]),
  formAliases: z.array(z.string()).default([]),
  status: z.enum(["unproven", "probing", "proven", "killed"]),
  secondInstanceAllowed: z.boolean().default(false),
});
export type MitchContentRole = z.infer<typeof mitchContentRoleSchema>;

export const mitchKilledIdeaSchema = z.object({
  idea: z.string().min(1),
  formAliases: z.array(z.string()).min(1),
  roleId: z.string().nullable().default(null),
  reason: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  revivalBlocked: z.boolean().default(true),
});
export type MitchKilledIdea = z.infer<typeof mitchKilledIdeaSchema>;

export const mitchHypothesisSchema = z.object({
  hypothesisId: z.string().min(1),
  claim: z.string().min(1),
  diagnosis: z.enum(MITCH_DIRECTOR_DIAGNOSES),
  locus: z.string().min(1),
  status: z.enum(["active", "supported", "strained", "killed", "unknown"]),
  evidenceIds: z.array(z.string()).default([]),
  rivalIds: z.array(z.string()).default([]),
});
export type MitchHypothesis = z.infer<typeof mitchHypothesisSchema>;

export const mitchGameModelSchema = z.object({
  gameId: z.string().min(1),
  modelVersion: z.number().int().positive(),
  buildSha: z.string().nullable(),
  updatedAt: z.string(),
  playerFantasy: z.string().nullable(),
  fantasyStatus: z.enum(["asserted", "supported", "strained", "rejected", "unknown"]),
  promisedFeelings: z.array(z.object({
    feeling: z.string().min(1),
    source: z.string().min(1),
  })).default([]),
  antiFeelings: z.array(z.string()).default([]),
  pillars: z.array(z.string()).max(4).nullable(),
  antiPillars: z.array(z.string()).default([]),
  tone: z.string().nullable(),
  verbs: z.array(mitchVerbSchema).default([]),
  loops: z.array(z.object({
    band: z.enum(["inner", "session", "campaign"]),
    verbIds: z.array(z.string()).default([]),
    entry: z.string().nullable(),
    reentryReason: z.string().nullable(),
    proven: z.boolean(),
    evidenceIds: z.array(z.string()).default([]),
    dependsOnOuterLoop: z.boolean().default(false),
  })).default([]),
  motivations: z.array(z.object({
    kind: z.enum(["autonomy", "competence", "relatedness", "other"]),
    claim: z.string(),
    status: z.enum(["unknown", "supported", "strained", "rejected"]),
    evidenceIds: z.array(z.string()).default([]),
  })).default([]),
  progression: z.object({
    kind: z.enum(["mastery", "world_state", "relationship", "collection", "access", "none", "unknown"]),
    maskingRisk: z.boolean().default(false),
  }),
  mechanics: z.array(z.object({
    sha: z.string().min(1),
    rule: z.string().min(1),
  })).default([]),
  contentRoles: z.array(mitchContentRoleSchema).default([]),
  narrative: z.object({
    playerKnows: z.array(z.string()).default([]),
    worldShows: z.array(z.string()).default([]),
    withheld: z.array(z.string()).default([]),
    intendedInference: z.string().nullable(),
  }),
  aestheticConstraints: z.array(z.string()).default([]),
  technicalConstraints: z.array(z.string()).default([]),
  hypotheses: z.array(mitchHypothesisSchema).default([]),
  killedIdeas: z.array(mitchKilledIdeaSchema).default([]),
  evidence: z.array(mitchEvidenceSchema).default([]),
  creativeDecisions: z.array(z.object({
    question: z.string().min(1),
    options: z.array(z.string()).default([]),
    owner: z.literal("adam"),
    status: z.enum(["open", "resolved"]),
    resolution: z.string().nullable(),
  })).default([]),
});
export type MitchGameModel = z.infer<typeof mitchGameModelSchema>;

export const mitchPlaytestProtocolSchema = z.object({
  buildSha: z.string().min(1),
  spoilState: z.enum(["unspoiled", "hinted", "spoiled"]),
  facilitatorMaySay: z.array(z.string()).default([]),
  facilitatorMustNotSay: z.array(z.string()).min(1),
  handsToWatch: z.array(z.string()).min(1),
  first60SecondsWatch: z.string().min(1),
  abandonRule: z.string().min(1),
  observationThatAnswersHypothesis: z.string().min(1),
  questionTesterMustNotBeAsked: z.string().min(1),
});
export type MitchPlaytestProtocol = z.infer<typeof mitchPlaytestProtocolSchema>;

export const mitchExperimentPlanSchema = z.object({
  symptom: z.object({
    rawReport: z.string().min(1),
    evidenceIds: z.array(z.string()).default([]),
  }),
  diagnosisId: z.string().min(1),
  hypothesisId: z.string().min(1),
  primaryDiagnosis: z.enum(MITCH_DIRECTOR_DIAGNOSES),
  runnerUpDiagnosis: z.enum(MITCH_DIRECTOR_DIAGNOSES),
  primaryHypothesis: z.string().min(1),
  primaryLocus: z.string().min(1),
  rivalHypothesis: z.string().min(1),
  rivalLocus: z.string().min(1),
  smallestDiscriminatingProbe: z.string().min(1),
  probeDeltaCount: z.union([z.literal(0), z.literal(1)]),
  frozen: z.array(z.string()).default([]),
  confoundCheck: z.array(z.string()).default([]),
  assetRoleCheck: z.string().min(1),
  proposedAssets: z.array(z.string()).default([]),
  nonGoals: z.array(z.string()).min(2),
  falsifier: z.string().min(1),
  observationRequired: z.string().min(1),
  evidenceSourceRequired: z.array(z.enum(MITCH_EVIDENCE_KINDS)).default([]),
  buildShaRequired: z.string().nullable(),
  specialist: z.string().nullable(),
  craftSkills: z.array(z.string()).default([]),
  decisionRights: z.object({
    mitchMayAuthorize: z.boolean(),
    adamRequired: z.boolean(),
    reason: z.string().min(1),
  }),
  expiration: z.string().min(1),
  disposition: z.enum(MITCH_DIRECTOR_DISPOSITIONS),
  playtestProtocol: mitchPlaytestProtocolSchema.nullable().default(null),
});
export type MitchExperimentPlan = z.infer<typeof mitchExperimentPlanSchema>;

export const mitchDirectorObservationSchema = z.object({
  rawReport: z.string().min(1),
  buildSha: z.string().nullable().default(null),
  evidenceKinds: z.array(z.enum(MITCH_EVIDENCE_KINDS)).default([]),
  naivePlayerCount: z.number().int().nonnegative().default(0),
  goalSpoiled: z.boolean().default(false),
  formedIntention: z.boolean().nullable().default(null),
  producedExpectedEffect: z.boolean().nullable().default(null),
  voluntarilyRepeated: z.boolean().nullable().default(null),
  postSuccessFiddling: z.boolean().nullable().default(null),
  triedOtherObjects: z.boolean().nullable().default(null),
  worldChangedReadably: z.boolean().nullable().default(null),
  intendedInferenceLanded: z.boolean().nullable().default(null),
  performanceStable: z.boolean().nullable().default(null),
  technicalEffectProduced: z.boolean().nullable().default(null),
  abandonPoint: z.string().nullable().default(null),
  requestedFeature: z.string().nullable().default(null),
});
export type MitchDirectorObservation = z.infer<typeof mitchDirectorObservationSchema>;

export const mitchDirectorProposalSchema = z.object({
  observation: mitchDirectorObservationSchema,
  plan: mitchExperimentPlanSchema,
});
export type MitchDirectorProposal = z.infer<typeof mitchDirectorProposalSchema>;
