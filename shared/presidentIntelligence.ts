import { z } from "zod";

export const epistemicKind = z.enum([
  "FACT",
  "INFERENCE",
  "UNKNOWN",
  "ASSUMPTION",
  "HYPOTHESIS",
  "FORECAST",
  "DECISION",
]);
export const companyEvidenceSchema = z
  .object({
    id: z.string().min(1).max(64),
    source: z.string().min(1),
    capturedAt: z.string().datetime(),
    sourceAt: z.string().datetime().nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    kind: epistemicKind,
    statement: z.string().min(1).max(16000),
    confidence: z.number().min(0).max(1),
    availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
    origin: z.enum(["REAL", "TEST_FIXTURE"]),
    expiresAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (
      e.availability === "UNAVAILABLE" &&
      (e.kind !== "UNKNOWN" || e.confidence !== 0)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Unavailable evidence must remain UNKNOWN with zero confidence",
      });
  });
export type CompanyEvidence = z.infer<typeof companyEvidenceSchema>;

export const thesisItemSchema = z
  .object({
    topic: z.enum([
      "CUSTOMER",
      "PROBLEM",
      "CATEGORY",
      "DIFFERENTIATION",
      "BUSINESS_MODEL",
      "WEDGE",
      "MOAT",
      "DISTRIBUTION",
      "PRICING",
      "PRODUCT",
      "RISK",
      "CONSTRAINT",
    ]),
    claim: z.string().min(1),
    kind: epistemicKind,
    evidenceIds: z.array(z.string()).min(1),
    confidence: z.number().min(0).max(1),
    reviewedAt: z.string().datetime(),
    falsification: z.string().min(1),
    status: z.enum(["CURRENT", "CHALLENGED", "SUPERSEDED"]),
  })
  .strict();
export const strategicObjectiveSchema = z
  .object({
    admission: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("GAP_RESOLUTION"),
          candidateId: z.string().min(1),
        })
        .strict(),
      z
        .object({
          type: z.literal("EVIDENCE_COLLECTION"),
          question: z.string().min(1),
        })
        .strict(),
      z
        .object({
          type: z.literal("STRATEGIC_EXPERIMENT"),
          hypothesis: z.string().min(1),
          test: z.string().min(1),
        })
        .strict(),
    ]),
    outcome: z.string().min(1),
    indicator: z.string().min(1),
    baseline: z.number().nullable(),
    target: z.number().nullable(),
    source: z.string().min(1),
    horizon: z.string().nullable(),
    owner: z.string().min(1),
    status: z.enum(["PROPOSED", "ACTIVE", "BLOCKED", "ACHIEVED", "STOPPED"]),
    dependencies: z.array(z.string()),
    reason: z.string().min(1),
    evidenceIds: z.array(z.string()).min(1),
  })
  .strict();
export const metricSchema = z
  .object({
    name: z.string().min(1),
    parent: z.string().nullable(),
    causalHypothesis: z.string().min(1),
    source: z.string().min(1),
    asOf: z.string().datetime().nullable(),
    confidence: z.number().min(0).max(1),
    availability: z.enum(["AVAILABLE", "UNKNOWN"]),
    value: z.number().nullable(),
    unit: z.string().min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (
      m.availability === "UNKNOWN" &&
      (m.value !== null || m.confidence !== 0)
    )
      ctx.addIssue({
        code: "custom",
        message: "Unknown metrics have no value or confidence",
      });
    if (m.availability === "AVAILABLE" && (m.value === null || m.asOf === null))
      ctx.addIssue({
        code: "custom",
        message: "Available metric requires dated measurement",
      });
  });

export const executiveRecommendationSchema = z
  .object({
    summary: z.string().min(1),
    evidenceIds: z.array(z.string()).min(1),
    facts: z.array(
      z
        .object({
          statement: z.string().min(1),
          evidenceIds: z.array(z.string()).min(1),
        })
        .strict()
    ),
    inferences: z.array(z.string()),
    unknowns: z.array(z.string()),
    preferredOption: z.string().min(1),
    bestAlternative: z.string().min(1),
    opportunityCost: z.string().min(1),
    falsification: z.string().min(1),
    nextAction: z.string().min(1),
    founderDecision: z.string().nullable(),
    skills: z.array(z.string()).min(1).max(6),
    thesisUpdates: z
      .array(
        thesisItemSchema.extend({
          kind: z.enum([
            "INFERENCE",
            "UNKNOWN",
            "ASSUMPTION",
            "HYPOTHESIS",
            "FORECAST",
          ]),
        })
      )
      .max(12),
    objectives: z.array(strategicObjectiveSchema).max(5),
  })
  .strict();
export type ExecutiveRecommendation = z.infer<
  typeof executiveRecommendationSchema
>;

export const intelligenceRecordKinds = [
  "THESIS",
  "OBJECTIVE",
  "METRIC",
  "STRATEGY",
  "PROGRESS",
  "DECISION",
  "OPPORTUNITY",
  "RISK",
  "EXPERIMENT",
  "CAPABILITY",
  "CABINET",
  "RESEARCH",
  "CONVERSATION",
  "LESSON",
  "FORECAST",
  "EVALUATION",
] as const;
export type IntelligenceRecordKind = (typeof intelligenceRecordKinds)[number];
export interface IntelligenceRecord {
  id: string;
  kind: IntelligenceRecordKind;
  key: string;
  version: number;
  createdAt: string;
  evidenceIds: string[];
  supersedesId: string | null;
  origin: "REAL" | "TEST_FIXTURE";
  payload: Record<string, unknown>;
}
