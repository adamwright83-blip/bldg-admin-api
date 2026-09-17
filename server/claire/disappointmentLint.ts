/**
 * Disappointment & CEO Framing Lints (Guardrail G2 & Executive Prohibition)
 *
 * Enforces Guardrail G2:
 * Missed, skipped, partial, or dropped work is never framed as Claire being
 * disappointed, let down, or displeased. It is stated as what remains plus
 * the options (repair, reschedule, drop).
 *
 * Also enforces the global rule:
 * The operator is a player, not a CEO. Never use "CEO", "executive", "board approval",
 * or similar framing in any user-facing string, prompt, or Claire utterance.
 */

export const DISAPPOINTMENT_PATTERNS: RegExp[] = [
  /\bdisappointed\b/i,
  /\blet (?:me|us) down\b/i,
  /\byou didn'?t even\b/i,
  /\bagain\?/i,
  /\bshame\b/i,
  /\bfailed to\b/i,
  /\bwhy didn'?t you\b/i,
  /\bdispleased\b/i,
  /\blet down\b/i,
  /\bunacceptable\b/i,
];

export const CEO_LANGUAGE_PATTERNS: RegExp[] = [
  /\bCEO\b/,
  /\bChief Executive\b/i,
  /\bthe board\b/i,
  /\bboard of directors\b/i,
  /\bboard approval\b/i,
  /\bexecutive leadership\b/i,
  /\bC-suite\b/i,
];

export function lintDisappointmentFraming(text: string): {
  passes: boolean;
  matchedPattern?: string;
} {
  for (const pattern of DISAPPOINTMENT_PATTERNS) {
    if (pattern.test(text)) {
      return { passes: false, matchedPattern: pattern.source };
    }
  }
  return { passes: true };
}

export function lintCeoLanguage(text: string): {
  passes: boolean;
  matchedPattern?: string;
} {
  for (const pattern of CEO_LANGUAGE_PATTERNS) {
    if (pattern.test(text)) {
      return { passes: false, matchedPattern: pattern.source };
    }
  }
  return { passes: true };
}
