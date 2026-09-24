/**
 * Bounded work-frame classification.
 *
 * Perception describes. This module does not route, mint grants, or choose an
 * executable action. Unknown and thrown failures are explicit statuses so
 * Executive Function can fail toward hold.
 *
 * Names of particular campaigns, ads, or people do not belong here.
 */

import type {
  AttentionRepairKind,
  StrategicShape,
  WorkDeclarationKind,
  WorkFrameClassifierStatus,
} from "../contracts/perceivedTurn";
import { detectConversationControl } from "../../turn/interpretTurn";

export type WorkFrameHints = {
  explicitActionRequest?: boolean;
  operatorWorkCommitment?: boolean;
};

export type WorkFrameClassification = {
  status: WorkFrameClassifierStatus;
  workDeclarationKind: WorkDeclarationKind;
  attentionRepair: AttentionRepairKind;
  operatorIntentAttested: boolean;
  embeddedExternalFact: boolean;
  explicitMissionWriteRequest: boolean;
  openFragment: boolean;
  strategicShape: StrategicShape;
  declaredContentLabel: string | null;
  factualChallenge: boolean;
};

const STRATEGIC = new RegExp(
  [
    String.raw`\b(?:my|today'?s|the)\s+mission\b`,
    String.raw`\bmission\s+today\b`,
    String.raw`\ba\s+mission\b`,
    String.raw`\btoday'?s\s+objective\b`,
    String.raw`\bmain\s+thing\s+today\b`,
    String.raw`\bconsidered\s+(?:as\s+)?(?:my\s+)?mission\b`,
    String.raw`\bas\s+my\s+mission\b`,
    String.raw`\bi(?:'m|\s+am)\s+(?:going\s+to\s+|want\s+to\s+|need\s+to\s+)?focus\s+on\b`,
  ].join("|"),
  "i"
);

const EXPLICIT_DAY_LINE =
  /\b(?:put|add|log|schedule|track|pencil)\b[\s\S]{0,80}\b(?:on|onto|to)\s+(?:my\s+|the\s+)?day\s*line\b/i;

const EXPLICIT_MISSION_WRITE =
  /\b(?:make|set|mark)\b[\s\S]{0,80}\b(?:today'?s\s+mission|my\s+mission(?:\s+today)?|the\s+mission)\b/i;

const CONTEXT_NARRATION = new RegExp(
  [
    String.raw`\b(?:just\s+)?telling\s+you\b`,
    String.raw`\bneed\s+you\s+to\s+(?:know|be\s+aware|hear|listen)\b`,
    String.raw`\bbe\s+aware\s+of\b`,
    String.raw`\bkeeping\s+(?:you|me)\s+in\s+the\s+loop\b`,
    String.raw`\bi(?:'m|\s+am)\s+not\s+answering\b`,
    String.raw`\bi(?:'m|\s+am)\s+(?:heading|going)\s+home\b`,
    String.raw`\bheading\s+home\b`,
    String.raw`\bgoing\s+home\b`,
    String.raw`\bon\s+my\s+way\s+home\b`,
  ].join("|"),
  "i"
);

/**
 * Conversation repair only. Introducing a mission ("I'm telling you…", "I need you
 * to know…") is not attention repair. Those phrases stay context or strategic work.
 */
const ATTENTION_REPAIR = new RegExp(
  [
    String.raw`\blisten\s+to\s+me\b`,
    String.raw`\byou(?:'re|\s+are)\s+not\s+listening\b`,
    String.raw`\blisten\b(?:\s*,\s*|\s+)(?:different\s+thing|this\s+is)\b`,
  ].join("|"),
  "i"
);

const SUBJECT_CHANGE = new RegExp(
  [
    String.raw`\bdifferent\s+thing\b`,
    String.raw`\bchang(?:e|ing)\s+(?:the\s+)?subjects?\b`,
    String.raw`\bi(?:'m|\s+am)\s+not\s+answering\b`,
    String.raw`\btalking\s+about\s+something\s+else\b`,
    String.raw`\bnot\s+what\s+i(?:'m|\s+am)?\s+(?:talking|saying|trying\s+to\s+say)\b`,
    String.raw`\bthat(?:'s|\s+is)\s+not\s+what\s+i(?:'m|\s+am)?\s+saying\b`,
  ].join("|"),
  "i"
);

const OPERATOR_INTENT =
  /\b(?:i|we)\s+(?:(?:also|still)\s+)?(?:have\s+to|need\s+to|gotta|got\s+to|must|should|want\s+to|plan\s+to|am\s+going\s+to|'m\s+going\s+to)\s+\w+/i;

const EXTERNAL_FACT =
  /\b(?:owe|owes|owed)\b|\b\$\s?\d|\b\d[\d,]*\s*(?:dollars|bucks|thousand)\b/i;

const FACTUAL_CHALLENGE =
  /\b(?:number|figure|amount|total|revenue|sales)\b/i;

const FACTUAL_STANCE = /\b(?:wrong|incorrect|not\s+right|meant|said)\b/i;

function clip(value: string): string | null {
  const tidy = value
    .replace(/\s+/g, " ")
    .replace(/^(?:to|that)\s+/i, "")
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\b(?:for\s+today|today)\s*$/i, "")
    .trim();
  if (tidy.length < 3) return null;
  if (/^(?:today|that|this|it|me|you)$/i.test(tidy)) return null;
  return tidy.length > 80 ? tidy.slice(0, 80).trim() : tidy;
}

function strategicContentLabel(text: string): string | null {
  const patterns: RegExp[] = [
    /\b(?:mission|objective|main\s+thing)\s+(?:today\s+)?(?:is|was)\s+(?:to\s+)?(.+)/i,
    /\b(?:make|set|mark)\s+(.+?)\s+(?:today'?s|my|the)\s+mission\b/i,
    /\b((?:publish(?:ing)?|post(?:ing)?)\s+[^,.]{3,80})/i,
    /\b(?:want|need|have)\s+(.+?)\s+considered\b/i,
    /\bi(?:'m|\s+am)\s+(?:going\s+to\s+)?focus\s+on\s+(.+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const label = match?.[1] ? clip(match[1]) : null;
    if (label) return label;
  }
  return null;
}

function intentionComplement(text: string): string | null {
  const sentence = text.trim().split(/(?<=[.!?])\s+/)[0] ?? text;
  const match =
    /\b(?:i|we)\s+(?:(?:also|still)\s+)?(?:have\s+to|need\s+to|gotta|got\s+to|must|should|want\s+to|plan\s+to|am\s+going\s+to|'m\s+going\s+to)\s+(.+)/i.exec(
      sentence
    );
  if (!match?.[1]) return null;
  const beforeCause = match[1].split(/\b(?:because|since)\b/i)[0] ?? match[1];
  return clip(beforeCause);
}

/** A desire aimed at a noun phrase that never says what should happen to it. */
export function endsWithOpenDesire(text: string): boolean {
  const trimmed = text.trim().replace(/[.!?]+$/g, "");
  if (/\b(?:day\s*line|mission|objective|considered|to\s+(?:be|do|put|add|call|make))\b/i.test(trimmed)) {
    return false;
  }
  return /\bi\s+want\s+(?:this|that|the|a|an)\b(?:\s+[a-z0-9'-]+){0,6}$/i.test(trimmed);
}

/** A held fragment plus a role clause is one finished strategic declaration. */
export function strategicJoinCompletes(text: string): boolean {
  return /\b(?:considered\s+as\s+(?:my\s+)?mission|as\s+my\s+mission|today'?s\s+mission)\b/i.test(text);
}

function ambiguousToken(text: string): boolean {
  const words = text.trim().replace(/[.!?]+$/g, "").split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  return /\b(?:mission|objective|day\s*line|dateline)\b/i.test(text) && !/\b(?:my|today|put|add|make|set|the)\b/i.test(text);
}

function failed(factualChallenge: boolean): WorkFrameClassification {
  return {
    status: "failed",
    workDeclarationKind: "none",
    attentionRepair: "none",
    operatorIntentAttested: false,
    embeddedExternalFact: false,
    explicitMissionWriteRequest: false,
    openFragment: false,
    strategicShape: "none",
    declaredContentLabel: null,
    factualChallenge,
  };
}

/**
 * Classify one assembled utterance. Never throws: a defect becomes `failed`,
 * which Executive Function must not treat as mission authority.
 */
export function classifyWorkFrame(text: string, hints: WorkFrameHints = {}): WorkFrameClassification {
  try {
    return classifyWorkFrameUnsafe(text, hints);
  } catch {
    return failed(false);
  }
}

function classifyWorkFrameUnsafe(text: string, hints: WorkFrameHints): WorkFrameClassification {
  const trimmed = text.trim();
  const factualChallenge = FACTUAL_CHALLENGE.test(trimmed) && FACTUAL_STANCE.test(trimmed);
  if (!trimmed) return { ...failed(false), status: "classified" };

  if (ambiguousToken(trimmed)) {
    return { ...failed(factualChallenge), status: "unknown" };
  }

  const attentionRepair: AttentionRepairKind = SUBJECT_CHANGE.test(trimmed)
    ? "subject_change"
    : ATTENTION_REPAIR.test(trimmed) || detectConversationControl(trimmed)
      ? "attention_repair"
      : "none";
  const operatorIntentAttested = OPERATOR_INTENT.test(trimmed);
  const embeddedExternalFact = EXTERNAL_FACT.test(trimmed);
  const explicitMissionWriteRequest = EXPLICIT_MISSION_WRITE.test(trimmed);
  const openFragment = endsWithOpenDesire(trimmed);
  const strategic = STRATEGIC.test(trimmed) || explicitMissionWriteRequest;
  const strategicLabel = strategic ? strategicContentLabel(trimmed) : null;
  const intentLabel = operatorIntentAttested ? intentionComplement(trimmed) : null;
  const declaredContentLabel = strategicLabel ?? intentLabel;
  const strategicShape: StrategicShape = !strategic ? "none" : declaredContentLabel ? "content" : "unresolved";

  let workDeclarationKind: WorkDeclarationKind = "none";
  if (EXPLICIT_DAY_LINE.test(trimmed) && !/\bdon'?t\s+add\b/i.test(trimmed)) {
    workDeclarationKind = "explicit_day_line";
  } else if (explicitMissionWriteRequest || strategic) {
    workDeclarationKind = "strategic_work";
  } else if (CONTEXT_NARRATION.test(trimmed)) {
    workDeclarationKind = "context_narration";
  } else if (hints.explicitActionRequest) {
    workDeclarationKind = "explicit_action";
  } else if (
    hints.operatorWorkCommitment &&
    operatorIntentAttested &&
    declaredContentLabel
  ) {
    // V1's broad commitment hint may fire on a question-shaped clause such as
    // "What should I do about Dana Tuesday?". That hint is descriptive only.
    // Brain V2 grants ordinary-work status only when the utterance independently
    // contains a first-person declarative intention with an extractable complement.
    workDeclarationKind = "ordinary_work";
  }

  return {
    status: "classified",
    workDeclarationKind,
    attentionRepair,
    operatorIntentAttested,
    embeddedExternalFact,
    explicitMissionWriteRequest,
    openFragment,
    strategicShape,
    declaredContentLabel,
    factualChallenge,
  };
}
