import type {
  OperatorArtifactDecision,
  OperatorArtifactDecisionResult,
} from "./operatorArtifactDecision";
import type { ClaireTurnHistoryEntry } from "./turn/claireTurn";
import type { DayWork } from "./knowledge/operationsKnowledge";

/**
 * Voice utility for the already-built operator artifact SMS port.
 *
 * V1 handled a standalone, referential request such as "Claire, text me that"
 * after Claire had already spoken the useful detail. V2 also supports a small
 * deterministic set of named operator artifacts, starting with today's Dayline.
 * It does not reinterpret the operator's own work ("I need to text Dana"),
 * choose a destination, or turn a communication receipt into business truth.
 */

export const OPERATOR_ARTIFACT_SMS_MAX_TEXT = 1_000;
const HISTORY_LIMIT = 16;
const DAYLINE_RENDER_LIMIT = 940;

export type OperatorArtifactVoiceRequest =
  | { kind: "referential" }
  | { kind: "dayline" };

type ResolveNamedOperatorArtifact = (
  request: Exclude<OperatorArtifactVoiceRequest, { kind: "referential" }>
) => Promise<string | null> | string | null;

export const OPERATOR_ARTIFACT_SENT_SPEAK = "Sent it.";
export const OPERATOR_ARTIFACT_FAILED_SPEAK = "I couldn't send it just now.";
export const OPERATOR_ARTIFACT_NO_SOURCE_SPEAK =
  "I don't have anything from the last turn to text yet.";
export const OPERATOR_ARTIFACT_DAYLINE_NO_SOURCE_SPEAK =
  "I don't have a Dayline schedule to text yet.";
export const OPERATOR_ARTIFACT_TOO_LONG_SPEAK =
  "That last answer is too long to text safely. Ask me for the specific detail.";

type ApplyOperatorArtifactDecision = (
  decision: OperatorArtifactDecision
) => Promise<OperatorArtifactDecisionResult>;

export type VoiceOperatorArtifactOutcome = {
  speak: string;
  providerAccepted: boolean;
  sourceText: string | null;
};

function normalizedRequest(utterance: string): string {
  return utterance
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:hey\s+)?claire(?:\s*[:,.-]\s*|\s+)/, "")
    .trim();
}

const DETAIL =
  "(?:address|link|number|route|info|information|details?|reference|checklist)";
const COURTESY = "(?:(?:can|could|would|will)\\s+you\\s+|please\\s+)?";

const STANDALONE_OPERATOR_ARTIFACT_REQUESTS = [
  new RegExp(
    `^${COURTESY}(?:text|send)\\s+me\\s+(?:that|it|this)(?:\\s+${DETAIL})?(?:\\s+to\\s+my\\s+phone)?$`,
    "i"
  ),
  new RegExp(
    `^${COURTESY}(?:text|send)\\s+(?:that|it|this)(?:\\s+${DETAIL})?\\s+to\\s+(?:me|my\\s+phone)$`,
    "i"
  ),
  new RegExp(
    `^${COURTESY}(?:text|send)\\s+me\\s+(?:the\\s+)?${DETAIL}(?:\\s+to\\s+my\\s+phone)?$`,
    "i"
  ),
];


const DAYLINE_ARTIFACT =
  "(?:(?:my|today(?:'s)?)\\s+)?(?:day\\s*line|dayline)(?:\\s+schedule)?|(?:my\\s+)?(?:schedule|plan)\\s+for\\s+today|today(?:'s)?\\s+(?:schedule|plan)";

const STANDALONE_DAYLINE_REQUESTS = [
  new RegExp(
    `^${COURTESY}(?:text|send)\\s+me\\s+(?:a\\s+text\\s+(?:with|of)\\s+)?(?:${DAYLINE_ARTIFACT})(?:\\s+today)?(?:\\s+to\\s+my\\s+phone)?$`,
    "i"
  ),
  new RegExp(
    `^${COURTESY}(?:text|send)\\s+(?:${DAYLINE_ARTIFACT})(?:\\s+today)?\\s+to\\s+(?:me|my\\s+phone)$`,
    "i"
  ),
  new RegExp(
    `^${COURTESY}(?:text|send)\\s+(?:my\\s+)?(?:day\\s*line|dayline)(?:\\s+schedule)?\\s+to\\s+me(?:\\s+today)?$`,
    "i"
  ),
];

export function parseOperatorArtifactVoiceRequest(
  utterance: string
): OperatorArtifactVoiceRequest | null {
  const normalized = normalizedRequest(utterance);
  if (!normalized) return null;
  if (
    STANDALONE_OPERATOR_ARTIFACT_REQUESTS.some(pattern =>
      pattern.test(normalized)
    )
  ) {
    return { kind: "referential" };
  }
  if (STANDALONE_DAYLINE_REQUESTS.some(pattern => pattern.test(normalized))) {
    return { kind: "dayline" };
  }
  return null;
}

export function isStandaloneOperatorArtifactVoiceRequest(
  utterance: string
): boolean {
  return parseOperatorArtifactVoiceRequest(utterance) != null;
}

function isUtilityStatusLine(text: string): boolean {
  const normalized = text.trim();
  return (
    normalized === OPERATOR_ARTIFACT_SENT_SPEAK ||
    normalized === OPERATOR_ARTIFACT_FAILED_SPEAK ||
    normalized === OPERATOR_ARTIFACT_NO_SOURCE_SPEAK ||
    normalized === OPERATOR_ARTIFACT_DAYLINE_NO_SOURCE_SPEAK ||
    normalized === OPERATOR_ARTIFACT_TOO_LONG_SPEAK ||
    /^go ahead,? i(?:'|’)m listening\.?$/i.test(normalized) ||
    /^still there\?/i.test(normalized) ||
    /^hey adam\. what(?:'|’)s up\?$/i.test(normalized)
  );
}

/**
 * Finds the last substantive Claire line. Utility confirmations are skipped so
 * "send that again" resends the useful content rather than the words "Sent it."
 */
export function latestClaireArtifactText(
  history: readonly ClaireTurnHistoryEntry[]
): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (entry?.speaker !== "claire") continue;
    const text = entry.text.trim();
    if (!text || isUtilityStatusLine(text)) continue;
    return text;
  }
  return null;
}

function describeDayWorkItem(item: DayWork["open"][number]): string {
  return item.timing ? `${item.title} (${item.timing})` : item.title;
}

/**
 * Renders the same authoritative Day Line + route work used by Claire's
 * operations answers. No model, phone matching, or inferred task creation.
 */
export function renderDaylineOperatorArtifact(work: DayWork): string | null {
  const items = [...work.open, ...work.completed];
  if (!items.length) return null;

  const lines = [`DAYLINE — ${work.businessDate}`];
  if (!work.routeAvailable) {
    lines.push("Route stops unavailable — this list may omit pickups, deliveries, or commercial stops.");
  }
  let included = 0;

  for (const item of items) {
    const completed = item.status === "completed" ? " ✓" : "";
    const line = `• ${describeDayWorkItem(item)}${completed}`;
    const remaining = items.length - (included + 1);
    const suffix = remaining > 0 ? `\n+ ${remaining} more on the Line` : "";
    if (([...lines, line].join("\n") + suffix).length > DAYLINE_RENDER_LIMIT) {
      break;
    }
    lines.push(line);
    included += 1;
  }

  if (included < items.length) {
    lines.push(`+ ${items.length - included} more on the Line`);
  }
  return lines.join("\n").slice(0, OPERATOR_ARTIFACT_SMS_MAX_TEXT);
}

export function appendOperatorArtifactVoiceHistory(
  history: readonly ClaireTurnHistoryEntry[],
  input: {
    operatorText: string;
    claireText: string;
    at: number;
  }
): ClaireTurnHistoryEntry[] {
  const additions: ClaireTurnHistoryEntry[] = [];
  if (input.operatorText.trim()) {
    additions.push({
      speaker: "operator",
      text: input.operatorText.slice(0, 1_200),
      at: input.at,
    });
  }
  if (input.claireText.trim()) {
    additions.push({
      speaker: "claire",
      text: input.claireText.slice(0, 1_200),
      at: input.at,
    });
  }
  return [...history, ...additions].slice(-HISTORY_LIMIT);
}

/**
 * Executes exactly one explicit operator-artifact send decision.
 *
 * The callback is injected so this module does not import the Twilio transport
 * at runtime (which would create a claireTwilio -> artifact -> claireTwilio
 * module cycle). The caller resolves the real decision seam lazily.
 */
export async function executeStandaloneOperatorArtifactVoiceRequest(
  input: {
    tenantId: string;
    operatorUserId: string;
    utterance: string;
    history: readonly ClaireTurnHistoryEntry[];
  },
  applyDecision: ApplyOperatorArtifactDecision,
  options: { resolveNamedArtifact?: ResolveNamedOperatorArtifact } = {}
): Promise<VoiceOperatorArtifactOutcome | null> {
  const request = parseOperatorArtifactVoiceRequest(input.utterance);
  if (!request) return null;

  let sourceText: string | null;
  try {
    sourceText =
      request.kind === "referential"
        ? latestClaireArtifactText(input.history)
        : (await options.resolveNamedArtifact?.(request)) ?? null;
  } catch {
    return {
      speak: OPERATOR_ARTIFACT_FAILED_SPEAK,
      providerAccepted: false,
      sourceText: null,
    };
  }

  if (!sourceText) {
    return {
      speak:
        request.kind === "dayline"
          ? OPERATOR_ARTIFACT_DAYLINE_NO_SOURCE_SPEAK
          : OPERATOR_ARTIFACT_NO_SOURCE_SPEAK,
      providerAccepted: false,
      sourceText: null,
    };
  }

  if (sourceText.length > OPERATOR_ARTIFACT_SMS_MAX_TEXT) {
    return {
      speak: OPERATOR_ARTIFACT_TOO_LONG_SPEAK,
      providerAccepted: false,
      sourceText,
    };
  }

  try {
    const applied = await applyDecision({
      action: "send_operator_artifact",
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      artifact: {
        kind: "plain_text",
        text: sourceText,
      },
    });

    const providerAccepted =
      applied.applied && applied.result.providerAccepted === true;

    return {
      speak: providerAccepted
        ? OPERATOR_ARTIFACT_SENT_SPEAK
        : OPERATOR_ARTIFACT_FAILED_SPEAK,
      providerAccepted,
      sourceText,
    };
  } catch {
    return {
      speak: OPERATOR_ARTIFACT_FAILED_SPEAK,
      providerAccepted: false,
      sourceText,
    };
  }
}
