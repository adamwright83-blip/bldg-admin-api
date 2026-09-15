import { CLAIRE_CHARACTER_DEFINITION, CLAIRE_CHARACTER_VERSION } from "./characterDefinition";
import { retrieveEligibleClaireCanon } from "./canonStore";
import { CLAIRE_ROUTINE_FEW_SHOTS } from "./fewShots";
import { CLAIRE_FIELD_MODE_OVERRIDE, CLAIRE_PERSONALITY_LOCK } from "./personalityLock";
import type {
  ClaireCompiledContext,
  ClaireMode,
  ClaireRelationshipEvent,
  ClaireRelationshipState,
} from "./types";

/**
 * Runtime/assembly version, independent of characterVersion — bump this
 * when the compiler's composition logic changes even if canon/DNA didn't
 * (Slice 1).
 */
export const CLAIRE_COMPILER_VERSION = "claire-runtime-2";

function summarizeSharedHistory(
  events: ClaireRelationshipEvent[],
  topic?: string
): string[] {
  const ranked = topic
    ? [...events].sort((left, right) => {
        const leftHit = left.summary.toLowerCase().includes(topic) ? 1 : 0;
        const rightHit = right.summary.toLowerCase().includes(topic) ? 1 : 0;
        return rightHit - leftHit;
      })
    : events;
  return ranked.slice(-5).map(event => event.summary);
}

/**
 * Composes the compact runtime context Claire's prompt-building code
 * (reasoning.ts) should splice in. Deliberately small: identity + DNA +
 * personality lock + mode + relationship state + tier + a handful of
 * shared-history summaries + eligible canon + (only for routine field
 * modes) compact few-shots. Never the full character bible.
 */
export function compileClaireCharacterContext(input: {
  mode: ClaireMode;
  relationshipState: ClaireRelationshipState;
  recentSharedHistory: ClaireRelationshipEvent[];
  explicitlyRequestedTopic?: string;
}): ClaireCompiledContext {
  const modePolicy = CLAIRE_CHARACTER_DEFINITION.modes[input.mode];
  const recentEvents = input.recentSharedHistory.slice(-5);
  const sharedHistorySummaries = summarizeSharedHistory(
    input.recentSharedHistory,
    input.explicitlyRequestedTopic
  );
  const sharedHistoryEventIds = recentEvents.map(event => event.id);
  const eligibleCanonFragments = retrieveEligibleClaireCanon({
    disclosureTier: input.relationshipState.disclosureTier,
    mode: input.mode,
    fieldOverride: modePolicy.fieldOverride,
    explicitlyRequestedTopic: input.explicitlyRequestedTopic,
  });
  const eligibleCanonFacts = eligibleCanonFragments.map(fragment => fragment.fact);
  const eligibleCanonFragmentIds = eligibleCanonFragments.map(fragment => fragment.id);

  const lines: string[] = [CLAIRE_PERSONALITY_LOCK];
  if (modePolicy.fieldOverride) lines.push(CLAIRE_FIELD_MODE_OVERRIDE);
  lines.push(`Mode objective: ${modePolicy.objective} Keep it under ${modePolicy.maxWords} spoken words.`);
  if (sharedHistorySummaries.length) {
    lines.push(
      `Durable shared history with this operator (most recent last, use only if relevant, never contradict it): ${sharedHistorySummaries.join(" | ")}`
    );
  }
  if (eligibleCanonFacts.length && (!modePolicy.fieldOverride || input.explicitlyRequestedTopic)) {
    lines.push(
      `Eligible personal canon at this operator's disclosure tier (${input.relationshipState.disclosureTier}) — reveal only if it naturally fits, never force it: ${eligibleCanonFacts.join(" | ")}`
    );
  }
  lines.push(
    "Never invent biography beyond what is listed above. Undefined personal history stays undefined — deflect or stay vague rather than confabulate."
  );

  return {
    version: {
      characterVersion: CLAIRE_CHARACTER_VERSION,
      compilerVersion: CLAIRE_COMPILER_VERSION,
    },
    mode: input.mode,
    disclosureTier: input.relationshipState.disclosureTier,
    relationshipDimensions: {
      professionalRespect: input.relationshipState.professionalRespect,
      reliability: input.relationshipState.reliability,
      disclosureSafety: input.relationshipState.disclosureSafety,
      familiarity: input.relationshipState.familiarity,
    },
    personalityLock: CLAIRE_PERSONALITY_LOCK,
    sharedHistorySummaries,
    sharedHistoryEventIds,
    eligibleCanonFacts,
    eligibleCanonFragmentIds,
    fewShotBlock:
      modePolicy.fieldOverride && CLAIRE_ROUTINE_FEW_SHOTS.length
        ? CLAIRE_ROUTINE_FEW_SHOTS.map(shot => shot.text).join("\n---\n")
        : null,
    promptSection: lines.join(" "),
  };
}
