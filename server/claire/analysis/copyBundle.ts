import type { ConversationSession, ConversationTurn } from "../conversation/types";
import { CLAIRE_EVALUATOR_VERSION } from "../conversation/types";
import type { QualitativeEvaluation } from "./conversationAnalysisSchema";

export function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt ?? startedAt);
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes === 0) return `${remainder}s`;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

export function renderAnalysisSummary(input: {
  session: ConversationSession;
  evaluation: QualitativeEvaluation;
  acceptedActionCount: number;
  completedActionCount: number;
  needsDetails: string[];
}): string {
  const understood =
    input.evaluation.operatorCorrections > 0 &&
    (input.evaluation.objectiveUnderstood === "YES" ||
      input.evaluation.objectiveUnderstood === "PARTIAL")
      ? `AFTER ${input.evaluation.operatorCorrections} CORRECTION${
          input.evaluation.operatorCorrections === 1 ? "" : "S"
        }`
      : input.evaluation.objectiveUnderstood;
  const lesson =
    input.evaluation.productFriction[0]?.summary ??
    input.evaluation.possibleMisunderstandings[0]?.summary ??
    (input.evaluation.missingCapabilities[0]
      ? `Missing capability: ${input.evaluation.missingCapabilities[0]}`
      : "No meaningful product lesson was found.");
  const when = new Date(input.session.startedAt).toLocaleString("en-US", {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  return [
    "CLAIRE CALL ANALYSIS",
    `${when}`,
    `Duration: ${formatDuration(input.session.startedAt, input.session.endedAt)}`,
    "",
    "WHAT HAPPENED",
    input.evaluation.summary,
    "",
    "CLAIRE PERFORMANCE",
    `Objective understood: ${understood}`,
    `Useful next step: ${
      input.evaluation.usefulNextStepReached == null
        ? "UNKNOWN"
        : input.evaluation.usefulNextStepReached
          ? "YES"
          : "NO"
    }`,
    `Operator corrections: ${input.evaluation.operatorCorrections}`,
    `Re-explanations: ${input.evaluation.operatorReexplanations}`,
    `Possible unsupported claims: ${input.evaluation.possibleUnsupportedClaims}`,
    `Accepted actions: ${input.acceptedActionCount}`,
    "",
    "WHAT WE SHOULD LEARN",
    lesson,
    "",
    "ACTION OUTCOME",
    `Accepted ${input.acceptedActionCount} · completed ${input.completedActionCount}`,
    input.needsDetails.length
      ? `Still missing:\n${input.needsDetails.map(item => `- ${item}`).join("\n")}`
      : "No NEEDS_DETAILS items.",
  ].join("\n");
}

export function renderCopyAnalysisBundle(input: {
  session: ConversationSession;
  evaluation: QualitativeEvaluation;
  turns: ConversationTurn[];
  acceptedActionCount: number;
  completedActionCount: number;
  outcomeCount: number;
  needsDetails: string[];
}): string {
  const moments = input.evaluation.notableMoments
    .slice(0, 8)
    .map(moment => {
      const turn = input.turns.find(item => item.ordinal === moment.turnOrdinal);
      const excerpt = moment.excerpt ?? turn?.text ?? "";
      return `- ${moment.kind}: ${moment.summary}${excerpt ? ` — “${excerpt}”` : ""}`;
    })
    .join("\n");
  return [
    "CLAIRE CALL ANALYSIS",
    `Date: ${input.session.startedAt}`,
    `Duration: ${formatDuration(input.session.startedAt, input.session.endedAt)}`,
    `Conversation type: ${input.session.conversationKind}`,
    `Claire ${input.session.claireCharacterVersion ?? "unknown"} · compiler ${
      input.session.claireCompilerVersion ?? "unknown"
    } · ${input.session.gitSha ?? "unknown"}`,
    `Evaluator: ${CLAIRE_EVALUATOR_VERSION}`,
    "",
    "WHAT HAPPENED",
    input.evaluation.summary,
    "",
    `Operator objective: ${input.evaluation.operatorObjective ?? "UNKNOWN"}`,
    `Objective understood: ${input.evaluation.objectiveUnderstood}`,
    `Useful next step: ${
      input.evaluation.usefulNextStepReached == null
        ? "UNKNOWN"
        : String(input.evaluation.usefulNextStepReached)
    }`,
    `Operator corrections: ${input.evaluation.operatorCorrections}`,
    `Re-explanations: ${input.evaluation.operatorReexplanations}`,
    input.evaluation.unnecessaryQuestions != null
      ? `Unnecessary questions: ${input.evaluation.unnecessaryQuestions}`
      : null,
    `Possible unsupported claims: ${input.evaluation.possibleUnsupportedClaims}`,
    input.evaluation.strategyQuality != null
      ? `Strategy quality: ${input.evaluation.strategyQuality}/10`
      : null,
    "",
    "WHAT WE SHOULD LEARN",
    input.evaluation.productFriction[0]?.summary ??
      input.evaluation.possibleMisunderstandings[0]?.summary ??
      "No meaningful product lesson was found.",
    "",
    "PRODUCT FRICTION",
    input.evaluation.productFriction.length
      ? input.evaluation.productFriction.map(item => `- ${item.summary}`).join("\n")
      : "None recorded.",
    "",
    "MISSING CAPABILITIES",
    input.evaluation.missingCapabilities.length
      ? input.evaluation.missingCapabilities.map(item => `- ${item}`).join("\n")
      : "None recorded.",
    "",
    `Actions proposed/accepted: ${input.acceptedActionCount}`,
    `Actions completed: ${input.completedActionCount}`,
    `Outcomes: ${input.outcomeCount}`,
    "",
    "NEEDS_DETAILS",
    input.needsDetails.length
      ? input.needsDetails.map(item => `- ${item}`).join("\n")
      : "None.",
    "",
    "KEY MOMENTS",
    moments || "None.",
    "",
    "FULL TRANSCRIPT AVAILABLE IN GOLDLINE",
  ]
    .filter(item => item !== null)
    .join("\n");
}

export function renderFullTranscript(turns: ConversationTurn[]): string {
  return turns
    .map(
      turn =>
        `${turn.speaker === "OPERATOR" ? "ADAM" : "CLAIRE"}: ${turn.text}`
    )
    .join("\n\n");
}

export function renderNotificationBody(input: {
  durationLabel: string;
  evaluation: QualitativeEvaluation;
  acceptedActionCount: number;
}): string {
  const lesson =
    input.evaluation.productFriction[0]?.summary ??
    input.evaluation.possibleMisunderstandings[0]?.summary ??
    input.evaluation.summary;
  return `${input.durationLabel} conversation analyzed.\n${input.evaluation.operatorCorrections} correction · ${input.acceptedActionCount} accepted action · ${input.evaluation.possibleUnsupportedClaims} unsupported claims.\n\n${lesson}`;
}
