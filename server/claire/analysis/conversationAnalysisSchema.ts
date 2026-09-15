import { z } from "zod";

export const CLAIRE_EVALUATOR_OUTPUT_NAME = "goldline_call_evaluation";

export const qualitativeEvaluationSchema = z.object({
  conversationPurpose: z.string().nullable(),
  operatorObjective: z.string().nullable(),
  objectiveUnderstood: z.enum(["YES", "PARTIAL", "NO", "UNCLEAR"]),
  objectiveUnderstandingScore: z.number().int().min(0).max(10).nullable(),
  summary: z.string(),
  usefulNextStepReached: z.boolean().nullable(),
  operatorCorrections: z.number().int().min(0),
  operatorReexplanations: z.number().int().min(0),
  unnecessaryQuestions: z.number().int().min(0).nullable(),
  possibleUnsupportedClaims: z.number().int().min(0),
  possibleMisunderstandings: z.array(
    z.object({
      summary: z.string(),
      turnOrdinal: z.number().int().nullable(),
    })
  ),
  productFriction: z.array(
    z.object({
      category: z.string(),
      summary: z.string(),
      turnOrdinal: z.number().int().nullable(),
      severity: z.enum(["low", "medium", "high"]).nullable(),
    })
  ),
  missingCapabilities: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  notableMoments: z.array(
    z.object({
      kind: z.string(),
      summary: z.string(),
      turnOrdinal: z.number().int().nullable(),
      excerpt: z.string().nullable(),
    })
  ),
  recommendedProductReview: z.boolean(),
  reviewReason: z.string().nullable(),
  strategyQuality: z.number().int().min(0).max(10).nullable(),
  conversationEfficiency: z.number().int().min(0).max(10).nullable(),
  truthfulnessConfidence: z.number().int().min(0).max(10).nullable(),
});

export type QualitativeEvaluation = z.infer<typeof qualitativeEvaluationSchema>;

export const EVALUATION_JSON_SCHEMA = {
  name: CLAIRE_EVALUATOR_OUTPUT_NAME,
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "conversationPurpose",
      "operatorObjective",
      "objectiveUnderstood",
      "objectiveUnderstandingScore",
      "summary",
      "usefulNextStepReached",
      "operatorCorrections",
      "operatorReexplanations",
      "unnecessaryQuestions",
      "possibleUnsupportedClaims",
      "possibleMisunderstandings",
      "productFriction",
      "missingCapabilities",
      "unresolvedQuestions",
      "notableMoments",
      "recommendedProductReview",
      "reviewReason",
      "strategyQuality",
      "conversationEfficiency",
      "truthfulnessConfidence",
    ],
    properties: {
      conversationPurpose: { anyOf: [{ type: "string" }, { type: "null" }] },
      operatorObjective: { anyOf: [{ type: "string" }, { type: "null" }] },
      objectiveUnderstood: {
        type: "string",
        enum: ["YES", "PARTIAL", "NO", "UNCLEAR"],
      },
      objectiveUnderstandingScore: {
        anyOf: [{ type: "integer", minimum: 0, maximum: 10 }, { type: "null" }],
      },
      summary: { type: "string" },
      usefulNextStepReached: { anyOf: [{ type: "boolean" }, { type: "null" }] },
      operatorCorrections: { type: "integer", minimum: 0 },
      operatorReexplanations: { type: "integer", minimum: 0 },
      unnecessaryQuestions: {
        anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }],
      },
      possibleUnsupportedClaims: { type: "integer", minimum: 0 },
      possibleMisunderstandings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "turnOrdinal"],
          properties: {
            summary: { type: "string" },
            turnOrdinal: { anyOf: [{ type: "integer" }, { type: "null" }] },
          },
        },
      },
      productFriction: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["category", "summary", "turnOrdinal", "severity"],
          properties: {
            category: { type: "string" },
            summary: { type: "string" },
            turnOrdinal: { anyOf: [{ type: "integer" }, { type: "null" }] },
            severity: {
              anyOf: [
                { type: "string", enum: ["low", "medium", "high"] },
                { type: "null" },
              ],
            },
          },
        },
      },
      missingCapabilities: { type: "array", items: { type: "string" } },
      unresolvedQuestions: { type: "array", items: { type: "string" } },
      notableMoments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "summary", "turnOrdinal", "excerpt"],
          properties: {
            kind: { type: "string" },
            summary: { type: "string" },
            turnOrdinal: { anyOf: [{ type: "integer" }, { type: "null" }] },
            excerpt: { anyOf: [{ type: "string" }, { type: "null" }] },
          },
        },
      },
      recommendedProductReview: { type: "boolean" },
      reviewReason: { anyOf: [{ type: "string" }, { type: "null" }] },
      strategyQuality: {
        anyOf: [{ type: "integer", minimum: 0, maximum: 10 }, { type: "null" }],
      },
      conversationEfficiency: {
        anyOf: [{ type: "integer", minimum: 0, maximum: 10 }, { type: "null" }],
      },
      truthfulnessConfidence: {
        anyOf: [{ type: "integer", minimum: 0, maximum: 10 }, { type: "null" }],
      },
    },
  },
};

export function researchFlagFor(input: {
  evaluation: QualitativeEvaluation;
  acceptedActionCount: number;
  usefulNextStepReached: boolean | null;
}): "NORMAL" | "REVIEW_RECOMMENDED" | "HIGH_VALUE_EXAMPLE" {
  const { evaluation } = input;
  if (
    evaluation.objectiveUnderstood === "YES" &&
    evaluation.operatorCorrections === 0 &&
    input.acceptedActionCount > 0
  ) {
    return "HIGH_VALUE_EXAMPLE";
  }
  if (
    evaluation.recommendedProductReview ||
    evaluation.operatorCorrections >= 1 ||
    evaluation.operatorReexplanations >= 1 ||
    evaluation.possibleUnsupportedClaims >= 1 ||
    evaluation.productFriction.length > 0 ||
    evaluation.missingCapabilities.length > 0 ||
    evaluation.objectiveUnderstood === "NO" ||
    input.usefulNextStepReached === false
  ) {
    return "REVIEW_RECOMMENDED";
  }
  return "NORMAL";
}
