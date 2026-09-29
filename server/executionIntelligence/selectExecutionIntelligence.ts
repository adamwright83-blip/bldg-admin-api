import type {
  ExecutionIntelligenceItem,
  ExecutionIntelligenceSelectionInput,
} from "../../shared/executionIntelligence";
import { listExecutionEligibleTeachings } from "../salesIntel/salesIntelTeachingStore";

export interface ExecutionIntelligenceProvider {
  readonly doctrineFamily: string;
  select(input: ExecutionIntelligenceSelectionInput): Promise<ExecutionIntelligenceItem[]>;
}

function contextText(context: unknown): string {
  if (typeof context === "string") return context.toLowerCase();
  try {
    return JSON.stringify(context ?? "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizedTerms(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(term => term.length >= 4);
}

function applicabilityScore(input: {
  context: string;
  whenToUse: readonly string[];
  whenNotToUse: readonly string[];
}): { eligible: boolean; score: number; reason: string } {
  const negative = input.whenNotToUse.find(rule => {
    const terms = normalizedTerms(rule);
    return terms.length > 0 && terms.every(term => input.context.includes(term));
  });
  if (negative) return { eligible: false, score: 0, reason: `excluded by whenNotToUse: ${negative}` };

  if (input.whenToUse.length === 0) {
    return { eligible: true, score: 0, reason: "accepted general teaching; no whenToUse restriction" };
  }

  let best = 0;
  for (const rule of input.whenToUse) {
    const terms = normalizedTerms(rule);
    if (!terms.length) continue;
    const matches = terms.filter(term => input.context.includes(term)).length;
    best = Math.max(best, matches / terms.length);
  }
  if (best === 0) {
    return { eligible: false, score: 0, reason: "no whenToUse context match" };
  }
  return { eligible: true, score: best, reason: "whenToUse context matched" };
}

export const salesExecutionIntelligenceProvider: ExecutionIntelligenceProvider = {
  doctrineFamily: "sales",
  async select(input) {
    const teachings = await listExecutionEligibleTeachings().catch(() => []);
    const context = contextText({
      objective: input.objectiveRef,
      context: input.context,
    });

    return teachings
      .map(teaching => ({
        teaching,
        fit: applicabilityScore({
          context,
          whenToUse: teaching.whenToUse,
          whenNotToUse: teaching.whenNotToUse,
        }),
      }))
      .filter(entry => entry.fit.eligible)
      .sort(
        (a, b) =>
          b.fit.score - a.fit.score ||
          a.teaching.teachingKey.localeCompare(b.teaching.teachingKey) ||
          b.teaching.version - a.teaching.version
      )
      .slice(0, input.limit)
      .map(({ teaching, fit }) => ({
        key: teaching.teachingKey,
        version: teaching.version,
        doctrineFamily: "sales",
        title: teaching.title,
        principle: teaching.principle,
        sourceProvenance: {
          sourceType: "sales_intel",
          sourceArtifactId: teaching.sourceArtifactId,
          transcriptId: teaching.transcriptId,
          transcriptStartMs: teaching.transcriptStartMs,
          transcriptEndMs: teaching.transcriptEndMs,
        },
        applicability: {
          whenToUse: teaching.whenToUse,
          whenNotToUse: teaching.whenNotToUse,
          reason: fit.reason,
        },
      }));
  },
};

const providers: readonly ExecutionIntelligenceProvider[] = [
  salesExecutionIntelligenceProvider,
];

/**
 * Generic bounded selector. Providers may inform; this function never creates
 * candidate work, ranks Objectives, or grants authority.
 */
export async function selectExecutionIntelligence(
  input: ExecutionIntelligenceSelectionInput
): Promise<ExecutionIntelligenceItem[]> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  if (!Number.isInteger(input.limit) || input.limit < 0 || input.limit > 3) {
    throw new Error("Execution Intelligence limit must be an integer from 0 through 3");
  }
  if (input.limit === 0) return [];

  const selected: ExecutionIntelligenceItem[] = [];
  for (const provider of providers) {
    if (selected.length >= input.limit) break;
    const remaining = input.limit - selected.length;
    const items = await provider.select({ ...input, limit: remaining });
    for (const item of items) {
      if (selected.some(existing => existing.key === item.key && existing.version === item.version)) {
        continue;
      }
      selected.push(item);
      if (selected.length >= input.limit) break;
    }
  }
  return selected;
}
