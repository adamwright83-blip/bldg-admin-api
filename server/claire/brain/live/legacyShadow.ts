/**
 * Reverse shadow: Brain V2 answers; legacy Claire only observes.
 *
 * After V2 has produced and returned its answer, legacy Claire's own semantic
 * interpreter (Brain V3, the classifier at the front of `runClaireTurn`)
 * independently reads the same completed utterance and the same recent turns.
 * The two readings are compared and the comparison is recorded.
 *
 * Read-only is structural, not aspirational:
 *
 *  - Only `interpretClaireBrainV3` runs. It is a single model call that returns
 *    a typed interpretation; it performs no writes, verifies nothing, and reads
 *    no business system. The rest of `runClaireTurn` is NOT run: it commits
 *    progression disclosures, ingests Daphne, writes decision records, Day Line
 *    work and turn traces, so it can never be a background observer.
 *  - It receives copies of the text it needs, never the live conversation state.
 *  - `observeLegacyClaireDetached` returns synchronously and never rejects, so a
 *    caller cannot await it on the live path, and its result cannot reach speech,
 *    call control, or any mutation.
 *  - The only write is the comparison telemetry row.
 *
 * Kill switch: `CLAIRE_V1_SHADOW=0`.
 */

import { appendClaireAnswerPathLog } from "../../character/generationLog";
import {
  interpretClaireBrainV3,
  type ClaireBrainV3Input,
  type ClaireBrainV3Interpretation,
} from "../../turn/brainV3";

export type V2DecisionSummary = {
  lanes: string[];
  businessIntent: string;
  dialogueActs: string[];
  priorClaim: "none" | "correctness" | "provenance";
  actionClasses: string[];
  endCall: boolean;
  composition: string;
  pendingDisposition: string;
};

export type LegacyComparison = {
  event: "claire_legacy_v1_shadow";
  version: "claire-v1-observer";
  conversationKey: string;
  surface: "voice" | "text";
  v2: V2DecisionSummary;
  v1: {
    available: boolean;
    target: string | null;
    act: string | null;
    workDisposition: string | null;
    dayLineDisposition: string | null;
    priorClaim: string | null;
    weeklyDisposition: string | null;
    identityTopic: string | null;
    broadBriefingRequest: boolean | null;
  };
  disagreements: string[];
  v1LatencyMs: number;
};

export type LegacyShadowInput = {
  tenantId: string;
  operatorUserId: string;
  conversationKey: string;
  surface: "voice" | "text";
  interpretation: ClaireBrainV3Input;
  v2: V2DecisionSummary;
};

export type LegacyShadowDeps = {
  interpret?: (input: ClaireBrainV3Input) => Promise<ClaireBrainV3Interpretation | null>;
  record?: (comparison: LegacyComparison, input: LegacyShadowInput) => Promise<void>;
  nowMs?: () => number;
  env?: NodeJS.ProcessEnv;
};

export function isLegacyClaireShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.CLAIRE_V1_SHADOW?.trim().toLowerCase();
  return !(flag === "0" || flag === "false" || flag === "off");
}

/** Where the legacy reading would have taken the turn somewhere V2 did not. */
export function compareLegacyReading(
  v2: V2DecisionSummary,
  v1: ClaireBrainV3Interpretation | null
): string[] {
  if (!v1) return ["v1_unavailable"];
  const out: string[] = [];
  const v1Ends = v1.act === "conversation_control";
  if (v1Ends !== v2.endCall) out.push("call_control");
  const v1Work = v1.workDisposition === "propose" || v1.workDisposition === "commit";
  const v2Work = v2.actionClasses.some(cls => cls === "propose_day_line" || cls === "commit_day_line" || cls === "commit_briefing");
  if (v1Work !== v2Work) out.push("work_authority");
  if (v1.priorClaim !== v2.priorClaim) out.push("prior_claim");
  const v1Rejects = v1.act === "rejection" || v1.dayLineDisposition === "decline";
  const v2Rejects = v2.pendingDisposition === "reject" || v2.dialogueActs.includes("refusal");
  if (v1Rejects !== v2Rejects) out.push("rejection");
  const v1Advice = v1.act === "advice_request";
  const v2Judgment = v2.businessIntent === "judgment_question";
  if (v1Advice && !v2Judgment && v2.composition === "deterministic") out.push("advice_vs_fact");
  if (v1.weeklyDisposition !== "none") out.push("weekly_planning_unowned_by_v2");
  return out;
}

async function defaultRecord(comparison: LegacyComparison, input: LegacyShadowInput): Promise<void> {
  try {
    console.info(`[ClaireLegacyShadow] ${JSON.stringify(comparison)}`);
  } catch {
    // Inspector line is telemetry only.
  }
  await appendClaireAnswerPathLog({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    answerPath: "legacy_v1_shadow",
    businessReader: null,
    rendererProse: false,
    surface: input.surface,
    turnKind: comparison.v2.composition,
    modelRequested: null,
    modelServed: null,
    promptChars: null,
    fallbackReason: comparison.v1.available ? null : "v1_unavailable",
    // Comparison classes only: no operator words and no candidate prose.
    spokenText: "",
    detail: comparison,
  });
}

/** Awaitable core, for tests. Never throws. */
export async function observeLegacyClaire(
  input: LegacyShadowInput,
  deps: LegacyShadowDeps = {}
): Promise<LegacyComparison | null> {
  try {
    if (!isLegacyClaireShadowEnabled(deps.env)) return null;
    if (!input.interpretation.utterance.trim()) return null;
    const now = deps.nowMs ?? Date.now;
    const started = now();
    const reading = await (deps.interpret ?? interpretClaireBrainV3)({
      ...input.interpretation,
      // A copy, so nothing the interpreter does can reach the live arrays.
      recentTurns: input.interpretation.recentTurns.map(turn => ({ ...turn })),
      pending: { ...input.interpretation.pending },
    }).catch(() => null);
    const comparison: LegacyComparison = {
      event: "claire_legacy_v1_shadow",
      version: "claire-v1-observer",
      conversationKey: input.conversationKey,
      surface: input.surface,
      v2: input.v2,
      v1: {
        available: Boolean(reading),
        target: reading?.target ?? null,
        act: reading?.act ?? null,
        workDisposition: reading?.workDisposition ?? null,
        dayLineDisposition: reading?.dayLineDisposition ?? null,
        priorClaim: reading?.priorClaim ?? null,
        weeklyDisposition: reading?.weeklyDisposition ?? null,
        identityTopic: reading?.identityTopic ?? null,
        broadBriefingRequest: reading?.broadBriefingRequest ?? null,
      },
      disagreements: compareLegacyReading(input.v2, reading),
      v1LatencyMs: now() - started,
    };
    await (deps.record ?? defaultRecord)(comparison, input).catch(() => undefined);
    return comparison;
  } catch {
    return null;
  }
}

/** Fire-and-forget. Returns before the legacy interpreter starts; never rejects. */
export function observeLegacyClaireDetached(input: LegacyShadowInput, deps: LegacyShadowDeps = {}): void {
  try {
    setImmediate(() => {
      void observeLegacyClaire(input, deps).catch(() => undefined);
    });
  } catch {
    // Scheduling failure is telemetry loss only.
  }
}
