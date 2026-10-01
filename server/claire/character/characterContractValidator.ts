import type { ClaireMode } from "./types";
import type { RapportBand, PersonalAccessRung } from "../progression/policy";

export type CharacterContractValidationInput = {
  text: string;
  rapportBand: RapportBand;
  personalRung?: PersonalAccessRung;
  mode?: ClaireMode;
  unresolvedBusiness?: boolean;
};

export type CharacterContractValidationResult = {
  ok: boolean;
  reason?: string;
  sanitizedText?: string;
};

/**
 * Recognizes operational / business questions that are ALWAYS valid for Claire to ask,
 * regardless of rapport.
 */
const OPERATIONAL_QUESTION_CUE = new RegExp(
  [
    String.raw`\b(?:day\s*line|task|tasks|items?|orders?|sales?|customers?|clients?|account|accounts?|property|properties)\b`,
    String.raw`\b(?:route|stop|stops|deliver(?:y|ies)?|pickup|pickups|cleancloud|unpaid|invoice|invoices|bill|billing)\b`,
    String.raw`\b(?:batch|batching|recovery|dormant|outreach|call|contact|message|follow[-\s]?up)\b`,
    String.raw`\b(?:schedule|scheduled|reschedule|timing|tomorrow|today|thursday|friday|monday|tuesday|wednesday|saturday|sunday)\b`,
    String.raw`\b(?:anything\s+else|what\s+else|ready\s+to|what\s+do\s+you\s+need|need\s+anything|need\s+from\s+me|how\s+can\s+i\s+help)\b`,
    String.raw`\b(?:should\s+i|shall\s+i|do\s+you\s+want\s+me\s+to|want\s+to\s+put|want\s+to\s+add|want\s+to\s+lock)\b`,
    String.raw`\b(?:which\s+(?:one|account|customer|client|order|day)|which\s+do\s+you\s+mean)\b`,
  ].join("|"),
  "i"
);

/**
 * Recognizes non-business, social/leisure curiosity questions that probe into the
 * operator's personal life or extend small talk.
 */
const SOCIAL_QUESTION_CUE = new RegExp(
  [
    String.raw`\b(?:what|which)\s+(?:movie|film|show|book|song|game|band|restaurant|bar|place)\b`,
    String.raw`\b(?:who|who's|who\s+all)\s+(?:are\s+you|were\s+you|did\s+you)?\s*(?:seeing|going\s+with|hanging\s+with|with)\b`,
    String.raw`\b(?:how\s+was|how\s+did)\s+(?:church|the\s+movie|the\s+film|the\s+service|the\s+trip|the\s+weekend|the\s+date|the\s+dinner|your\s+friend|your\s+weekend)\b`,
    String.raw`\b(?:what|where)\s+(?:did\s+you|are\s+you\s+going\s+to)\s+(?:watch|see|eat|drink|go|hang\s+out|play|do)\b`,
    String.raw`\b(?:what\s+are\s+you\s+up\s+to|what\s+are\s+your\s+plans|doing\s+anything\s+fun)\b`,
    String.raw`\b(?:what\s+kind\s+of\s+movie|what\s+did\s+you\s+see)\b`,
  ].join("|"),
  "i"
);

/** Romance / flirtatious acceptance violating canon. */
const ROMANTIC_ACCEPTANCE_CUE = new RegExp(
  [
    String.raw`\b(?:i'd|i\s+would)\s+love\s+to\s+(?:go\s+out|get\s+a\s+drink|have\s+a\s+drink|get\s+dinner|grab\s+drinks?)\b`,
    String.raw`\b(?:let's\s+do\s+it|sounds\s+like\s+a\s+date|it's\s+a\s+date)\b`,
    String.raw`\b(?:flirt|sweetheart|darling|honey)\b`,
  ].join("|"),
  "i"
);

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

export function validateClaireCharacterContract(
  input: CharacterContractValidationInput
): CharacterContractValidationResult {
  const { text, rapportBand, unresolvedBusiness } = input;
  const trimmed = text.trim();
  if (!trimmed) return { ok: true };

  // Rule 1: romance track is permanently prohibited across all rapport bands.
  if (ROMANTIC_ACCEPTANCE_CUE.test(trimmed)) {
    const defaultRefusal = unresolvedBusiness
      ? "I'll pass, thanks. We still have items on the line."
      : "I'll pass, thanks. Let me know what you need on today's line.";
    return {
      ok: false,
      reason: "romantic_advance_unauthorized",
      sanitizedText: defaultRefusal,
    };
  }

  // Rule 2: At low rapport (band 0), Claire acknowledges social/casual material briefly,
  // but NEVER extends the social thread with unsolicited personal curiosity questions.
  if (rapportBand === 0) {
    const sentences = splitIntoSentences(trimmed);
    const nonSocialSentences: string[] = [];
    let hadSocialQuestion = false;

    const isOperationalMode =
      input.mode === "pre_drive" ||
      input.mode === "strategy" ||
      input.mode === "failure_review" ||
      input.mode === "post_stop" ||
      input.mode === "field_debrief" ||
      input.mode === "evening_planning" ||
      input.mode === "morning_reconciliation";

    for (const sentence of sentences) {
      const hasQuestion = /\?/.test(sentence);
      if (hasQuestion) {
        const isExplicitSocial = SOCIAL_QUESTION_CUE.test(sentence);
        const isOperational = OPERATIONAL_QUESTION_CUE.test(sentence);
        const isSocial = isExplicitSocial || (!isOperationalMode && !isOperational);
        if (isSocial) {
          hadSocialQuestion = true;
          continue; // Strip the unauthorized social follow-up question
        }
      }
      nonSocialSentences.push(sentence);
    }

    if (hadSocialQuestion) {
      let resultText = nonSocialSentences.join(" ").trim();
      const operationalReturn = unresolvedBusiness
        ? "We still have work on today's line."
        : "Let me know what you need on the line.";

      if (!resultText) {
        resultText = `Understood. ${operationalReturn}`;
      } else if (!OPERATIONAL_QUESTION_CUE.test(resultText)) {
        // If the remaining text is just an acknowledgement without an operational return,
        // attach the natural pivot back to role.
        resultText = `${resultText.replace(/[.!?]+$/, "")}. ${operationalReturn}`;
      }

      return {
        ok: false,
        reason: "low_rapport_social_question_extension",
        sanitizedText: resultText,
      };
    }
  }

  return { ok: true };
}
