import { ENV } from "../../_core/env";
import { invokeLLM } from "../../_core/llm";
import { interpretTurn } from "./interpretTurn";
import { detectConfirmation } from "../voiceCommitmentLoop";
import {
  explicitDayLineRefusal,
  explicitPendingDayLineCommit,
  explicitTrackingRequest,
} from "../briefing/titleContract";

export type ClaireBrainV3Target =
  | "open_conversation"
  | "pending_briefing"
  | "pending_account_follow_up"
  | "pending_action"
  | "weekly_planning";

export type ClaireBrainV3Act =
  | "acknowledgement"
  | "narration"
  | "question"
  | "advice_request"
  | "action_request"
  | "work_commitment"
  | "confirmation"
  | "rejection"
  | "correction"
  | "prior_claim_probe"
  | "conversation_control"
  | "unclear";

export type ClaireBrainV3WorkDisposition =
  | "none"
  | "discuss"
  | "propose"
  | "commit";

export type ClaireBrainV3DayLineDisposition =
  | "none"
  | "decline"
  | "accept"
  | "reopen";

export type ClaireBrainV3PriorClaim =
  | "none"
  | "correctness"
  | "provenance";

export type ClaireBrainV3WeeklyDisposition =
  | "none"
  | "continue"
  | "lock"
  | "cancel";

export type ClaireBrainV3Interpretation = {
  target: ClaireBrainV3Target;
  act: ClaireBrainV3Act;
  workDisposition: ClaireBrainV3WorkDisposition;
  dayLineDisposition: ClaireBrainV3DayLineDisposition;
  priorClaim: ClaireBrainV3PriorClaim;
  weeklyDisposition: ClaireBrainV3WeeklyDisposition;
  /** True only for an unscoped chief-of-staff briefing request such as "what should I do today?". */
  broadBriefingRequest: boolean;
  /**
   * The work the operator actually requested/committed to, resolved from the
   * current utterance plus recent dialogue. Null for narration, explanation,
   * advice, hypothetical discussion, or anything the operator did not ask to
   * turn into work.
   */
  canonicalWork: string | null;
  /**
   * A short plain-English statement of what the operator is referring to.
   * This is diagnostic/context only; executors do not mutate from this field.
   */
  referent: string | null;
  rationale: string;
};

export type ClaireBrainV3Input = {
  tenantId: string;
  operatorId: string;
  utterance: string;
  recentTurns: Array<{ speaker: "operator" | "claire"; text: string }>;
  pending: {
    briefing: boolean;
    accountFollowUp: boolean;
    action: boolean;
    weeklyPlanning: boolean;
  };
  dayLineSuppressed: boolean;
};

/**
 * Claire Brain V3 is the ONE conversational interpretation for a turn.
 *
 * It does not perform writes, verify facts, query business systems, or decide
 * what Claire should sound like. It only resolves human meaning. Deterministic
 * systems downstream may execute or reject the resulting intent, but they may
 * not independently reinterpret the raw utterance.
 */
export async function interpretClaireBrainV3(
  input: ClaireBrainV3Input
): Promise<ClaireBrainV3Interpretation | null> {
  if (!ENV.anthropicApiKey?.trim()) return null;

  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      model: ENV.anthropicModelClaire || ENV.anthropicModel,
      maxTokens: 320,
      temperature: 0,
      outputSchema: {
        name: "claire_brain_v3_turn",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "target",
            "act",
            "workDisposition",
            "dayLineDisposition",
            "priorClaim",
            "weeklyDisposition",
            "broadBriefingRequest",
            "canonicalWork",
            "referent",
            "rationale",
          ],
          properties: {
            target: {
              type: "string",
              enum: [
                "open_conversation",
                "pending_briefing",
                "pending_account_follow_up",
                "pending_action",
                "weekly_planning",
              ],
            },
            act: {
              type: "string",
              enum: [
                "acknowledgement",
                "narration",
                "question",
                "advice_request",
                "action_request",
                "work_commitment",
                "confirmation",
                "rejection",
                "correction",
                "prior_claim_probe",
                "conversation_control",
                "unclear",
              ],
            },
            workDisposition: {
              type: "string",
              enum: ["none", "discuss", "propose", "commit"],
            },
            dayLineDisposition: {
              type: "string",
              enum: ["none", "decline", "accept", "reopen"],
            },
            priorClaim: {
              type: "string",
              enum: ["none", "correctness", "provenance"],
            },
            weeklyDisposition: {
              type: "string",
              enum: ["none", "continue", "lock", "cancel"],
            },
            broadBriefingRequest: { type: "boolean" },
            canonicalWork: { type: ["string", "null"] },
            referent: { type: ["string", "null"] },
            rationale: { type: "string" },
          },
        },
      },
      messages: [
        {
          role: "system",
          content: [
            "You are Claire Brain V3, the sole semantic interpreter for a live operator conversation.",
            "Read the CURRENT utterance as a normal human would, using the recent dialogue to resolve pronouns, short replies, corrections, and implied referents.",
            "You do NOT answer the operator. You only describe what the operator means so deterministic executors can act safely.",
            "",
            "NON-NEGOTIABLE AUTHORITY RULES:",
            "1. Persistent workflows are background state, never conversational authority. A stale Weekly Mission, pending Day Line bundle, or old proposal cannot claim a turn merely because it can parse the words.",
            "2. The most recent unresolved conversational question/proposal owns ambiguous replies such as yes, no, sure, do it, that works, I can commit to that.",
            "3. Distinguish discussion from action. Narration, explanation, context, frustration, preferences, hypotheticals, strategic discussion, and observations are NOT work items.",
            "4. canonicalWork is non-null ONLY when the operator is genuinely asking Claire to create/track/schedule work, stating a concrete work commitment that Claire should propose tracking, explicitly confirming a concrete action from recent dialogue, or revising concrete held work. For a revision, canonicalWork is the normalized revised work, not the conversational filler around it.",
            "5. Never literalize conversational phrasing into work. Example: 'I will mentally prepare to visit those places' after agreeing to a three-stop Friday route refers to the THREE-STOP ROUTE, not a task named 'mentally prepare'.",
            "6. If the operator says they do not want to discuss/use the Day Line, dayLineDisposition=decline. While dayLineSuppressed=true, do not propose Day Line work unless the operator explicitly reopens it or explicitly commands a tracking/scheduling action.",
            "7. A clear 'put that on the Day Line', 'schedule it', 'create that mission', or equivalent can reopen tracking even after suppression: dayLineDisposition=reopen.",
            "8. priorClaim is correctness/provenance ONLY when the operator is genuinely challenging a specific factual claim Claire made (e.g. 'are you sure?', 'where did that number come from?'). Complaints about Claire's verification behavior, ordinary corrections, fragments like 'so', statements like 'it's already 7 PM', or 'nobody asked you to verify that' are NOT prior-claim probes.",
            "9. weekly_planning means the FORMAL persisted Weekly Mission workflow, not ordinary strategy about the remaining days. Natural conversation such as 'let's look at Thursday and Friday' or 'what should my sales mission be Friday?' stays open_conversation unless Claire's immediately preceding live prompt was clearly the formal Weekly Mission workflow or the operator explicitly says weekly plan / lock the week / back to weekly planning. When formal weekly_planning is selected, weeklyDisposition says whether this turn continues, locks, or cancels it.",
            "10. A bare confirmation may lock weekly planning ONLY when Claire's immediately preceding unresolved question was the weekly lock confirmation. Otherwise weeklyDisposition=continue or none.",
            "11. If Claire proposes a concrete mission/route and the operator says 'I can commit to that', workDisposition=commit and canonicalWork must resolve to that concrete mission/route, not the operator's literal confirmation sentence. If that proposal was explicitly to schedule/create the mission, dayLineDisposition=reopen is allowed even if generic Day Line discussion was previously suppressed.",
            "12. If the operator asks what they SHOULD do, requests strategy, or is collaboratively shaping a mission but has not yet committed, use workDisposition=discuss.",
            "13. broadBriefingRequest=true only for an unscoped chief-of-staff request such as 'what should I do today?', 'what do I need to know?', or 'what's most important?'. It is false for questions scoped to a person, account, mission, or topic.",
            "14. rationale must be a concise plain-English semantic summary of what the operator means in this turn and what it refers to, not a policy explanation or classifier commentary. This summary is passed to Claire's speaking model so it can respond to the same meaning.",
            "15. If uncertain, choose open_conversation, workDisposition=none, priorClaim=none, weeklyDisposition=none. Ambiguity must never create work or trigger verification.",
            "",
            "TARGET meanings:",
            "- pending_briefing: answering/refining Claire's currently held Day Line/work bundle.",
            "- pending_account_follow_up: answering/refining a held account follow-up action.",
            "- pending_action: answering/refining another concrete action/mission proposal Claire just made.",
            "- weekly_planning: deliberately continuing the actual weekly-planning workflow.",
            "- open_conversation: normal conversation, narration, advice, new topic, clarification, pushback, strategy, etc.",
            "",
            "Current background state:",
            JSON.stringify({
              pending: input.pending,
              dayLineSuppressed: input.dayLineSuppressed,
            }),
            "",
            "Recent conversation, oldest to newest:",
            JSON.stringify(input.recentTurns.slice(-12)),
          ].join("\n"),
        },
        { role: "user", content: input.utterance },
      ],
    });

    const parsed = JSON.parse(contentText(result)) as Partial<ClaireBrainV3Interpretation>;
    const validTarget = [
      "open_conversation",
      "pending_briefing",
      "pending_account_follow_up",
      "pending_action",
      "weekly_planning",
    ].includes(parsed.target ?? "");
    const validAct = [
      "acknowledgement",
      "narration",
      "question",
      "advice_request",
      "action_request",
      "work_commitment",
      "confirmation",
      "rejection",
      "correction",
      "prior_claim_probe",
      "conversation_control",
      "unclear",
    ].includes(parsed.act ?? "");
    const validWork = ["none", "discuss", "propose", "commit"].includes(
      parsed.workDisposition ?? ""
    );
    const validDayLine = ["none", "decline", "accept", "reopen"].includes(
      parsed.dayLineDisposition ?? ""
    );
    const validPrior = ["none", "correctness", "provenance"].includes(
      parsed.priorClaim ?? ""
    );
    const validWeekly = ["none", "continue", "lock", "cancel"].includes(
      parsed.weeklyDisposition ?? ""
    );
    if (
      !validTarget ||
      !validAct ||
      !validWork ||
      !validDayLine ||
      !validPrior ||
      !validWeekly ||
      typeof parsed.broadBriefingRequest !== "boolean"
    ) {
      return null;
    }

    return {
      target: parsed.target as ClaireBrainV3Target,
      act: parsed.act as ClaireBrainV3Act,
      workDisposition: parsed.workDisposition as ClaireBrainV3WorkDisposition,
      dayLineDisposition: parsed.dayLineDisposition as ClaireBrainV3DayLineDisposition,
      priorClaim: parsed.priorClaim as ClaireBrainV3PriorClaim,
      weeklyDisposition: parsed.weeklyDisposition as ClaireBrainV3WeeklyDisposition,
      broadBriefingRequest: parsed.broadBriefingRequest as boolean,
      canonicalWork:
        typeof parsed.canonicalWork === "string" && parsed.canonicalWork.trim()
          ? parsed.canonicalWork.trim()
          : null,
      referent:
        typeof parsed.referent === "string" && parsed.referent.trim()
          ? parsed.referent.trim()
          : null,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    };
  } catch {
    return null;
  }
}

export type SafeClaireBrainV3FallbackContext = {
  pending?: {
    briefing?: boolean;
    accountFollowUp?: boolean;
    action?: boolean;
    weeklyPlanning?: boolean;
  };
  sessionKind?: string | null;
  morningSession?: string | null;
  dayLineSuppressed?: boolean;
};

export function safeClaireBrainV3Fallback(
  input?: string | ({ utterance?: string } & SafeClaireBrainV3FallbackContext),
  options?: SafeClaireBrainV3FallbackContext
): ClaireBrainV3Interpretation {
  const utterance = typeof input === "string" ? input : input?.utterance;
  const ctx: SafeClaireBrainV3FallbackContext =
    typeof input === "object" && input !== null ? input : (options ?? {});

  if (!utterance || !utterance.trim()) {
    return {
      target: "open_conversation",
      act: "unclear",
      workDisposition: "none",
      dayLineDisposition: "none",
      priorClaim: "none",
      weeklyDisposition: "none",
      broadBriefingRequest: false,
      canonicalWork: null,
      referent: null,
      rationale: "Brain V3 unavailable; fail closed to conversation without mutation or verification.",
    };
  }

  const text = utterance.trim();
  const interpreted = interpretTurn(text);
  const confirmation = detectConfirmation(text);

  const priorClaim: ClaireBrainV3PriorClaim = interpreted.correctnessChallenge
    ? "correctness"
    : interpreted.provenanceQuestion
      ? "provenance"
      : "none";

  let target: ClaireBrainV3Target = "open_conversation";
  let act: ClaireBrainV3Act = "unclear";
  let workDisposition: ClaireBrainV3WorkDisposition = "none";
  let dayLineDisposition: ClaireBrainV3DayLineDisposition = "none";
  let weeklyDisposition: ClaireBrainV3WeeklyDisposition = "none";

  const isTracking = explicitTrackingRequest(text) || explicitPendingDayLineCommit(text);

  if (interpreted.mayProposeWork) {
    if (isTracking) {
      workDisposition = "commit";
    } else if (interpreted.operatorWorkCommitment || interpreted.hasExplicitActionRequest) {
      workDisposition = "propose";
    }
  }

  if (interpreted.correctnessChallenge || interpreted.provenanceQuestion) {
    act = "prior_claim_probe";
  } else if (interpreted.callControl === "end") {
    act = "conversation_control";
  } else if (interpreted.acknowledgement) {
    act = "acknowledgement";
  } else if (interpreted.correction) {
    act = "correction";
  } else if (confirmation === "yes") {
    act = "confirmation";
  } else if (confirmation === "no" || interpreted.actionRefused) {
    act = "rejection";
  } else if (interpreted.broadBriefingRequest) {
    act = "question";
  } else if (interpreted.hasBusinessQuestion) {
    act = "question";
  } else if (interpreted.operatorWorkCommitment) {
    act = "work_commitment";
  } else if (isTracking || interpreted.hasExplicitActionRequest) {
    act = "action_request";
  }

  const isWeeklyInvite =
    ctx.sessionKind === "weekly_planning_invite" ||
    ctx.morningSession === "weekly_planning_invite" ||
    Boolean(ctx.pending?.weeklyPlanning);

  if (
    isWeeklyInvite &&
    (confirmation === "yes" || confirmation === "no" || /^(?:not now|forget it|cancel)\b/i.test(text))
  ) {
    target = "weekly_planning";
    weeklyDisposition = confirmation === "yes" ? "continue" : "cancel";
  } else if (ctx.pending?.briefing) {
    if (confirmation === "yes" || explicitPendingDayLineCommit(text)) {
      target = "pending_briefing";
      act = "confirmation";
      dayLineDisposition = "accept";
    } else if (confirmation === "no" || interpreted.actionRefused || explicitDayLineRefusal(text)) {
      target = "pending_briefing";
      act = "rejection";
      dayLineDisposition = "decline";
    } else if (interpreted.correction) {
      target = "pending_briefing";
      act = "correction";
    }
  } else if (ctx.pending?.action) {
    if (confirmation === "yes") {
      target = "pending_action";
      act = "confirmation";
      dayLineDisposition = "accept";
    } else if (confirmation === "no" || interpreted.actionRefused || explicitDayLineRefusal(text)) {
      target = "pending_action";
      act = "rejection";
      dayLineDisposition = "decline";
    } else if (interpreted.correction) {
      target = "pending_action";
      act = "correction";
    }
  } else if (ctx.pending?.accountFollowUp) {
    if (confirmation === "yes") {
      target = "pending_account_follow_up";
      act = "confirmation";
    } else if (confirmation === "no" || interpreted.actionRefused) {
      target = "pending_account_follow_up";
      act = "rejection";
    }
  } else {
    // Nothing pending
    if (interpreted.actionRefused || explicitDayLineRefusal(text)) {
      dayLineDisposition = "decline";
      act = "rejection";
    }
  }

  return {
    target,
    act,
    workDisposition,
    dayLineDisposition,
    priorClaim,
    weeklyDisposition,
    broadBriefingRequest: Boolean(interpreted.broadBriefingRequest),
    canonicalWork: null,
    referent: null,
    rationale: "Deterministic fallback from interpretTurn and pending conversational state.",
  };
}

function contentText(result: Awaited<ReturnType<typeof invokeLLM>>): string {
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => ("text" in part ? part.text : "")).join("");
  }
  return "";
}
