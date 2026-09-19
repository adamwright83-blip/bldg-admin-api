import { CLAIRE_CANON } from "../character/characterDefinition";
import { lintCeoLanguage, lintDisappointmentFraming } from "../disappointmentLint";

/**
 * Failure-day language lint (Earned Rapport brief §32-33). On a verified failure
 * day Claire runs the business; she is not a coach. This adds the categories the
 * existing disappointment lint does not cover.
 */

const PATTERNS: Record<string, RegExp[]> = {
  shame_or_pressure: [
    /\bprove yourself\b/i,
    /\byou let me down\b/i,
    /\bdon'?t want this (?:badly )?enough\b/i,
    /\bmaybe you don'?t want\b/i,
    /\bwhat(?:'s| is) wrong with you\b/i,
    /\bbroken streak\b/i,
    /\bstreak\b/i,
  ],
  consolation: [
    /\bdon'?t be discouraged\b/i,
    /\bdon'?t be too hard on yourself\b/i,
    /\bit'?s (?:okay|ok|alright) to (?:feel|be)\b/i,
    /\bI'?m sorry you\b/i,
    /\bthat must (?:have been|be) (?:hard|tough|difficult|frustrating)\b/i,
    /\byou'?re not alone\b/i,
  ],
  motivation: [
    /\brejection is (?:part of|a part of)\b/i,
    /\bpart of (?:the )?(?:growth|journey|process)\b/i,
    /\bI'?m proud of you\b/i,
    /\bkeep (?:pushing|going|your head up)\b/i,
    /\bnever give up\b/i,
    /\bbelieve in yourself\b/i,
    /\bevery no gets you closer\b/i,
  ],
  diagnosis_or_coaching: [
    /\bavoid(?:ing|ance)\b/i,
    /\bfear of (?:rejection|failure|success)\b/i,
    /\bmindset\b/i,
    /\bself[- ]sabotag/i,
    /\byou (?:tend|seem) to\b/i,
    /\bhow (?:does|did) that make you feel\b/i,
    /\bimposter\b/i,
  ],
  lowered_regard: [
    /\brespect you less\b/i,
    /\bless (?:impressed|confident) in you\b/i,
    /\bI expected more\b/i,
    /\bnot what I expected\b/i,
  ],
};

export type ToneLintResult = { passes: boolean; violations: Array<{ category: string; pattern: string }> };

export function lintFailureDayLanguage(text: string): ToneLintResult {
  const violations: ToneLintResult["violations"] = [];
  const disappointment = lintDisappointmentFraming(text);
  if (!disappointment.passes) violations.push({ category: "disappointment", pattern: disappointment.matchedPattern ?? "" });
  const ceo = lintCeoLanguage(text);
  if (!ceo.passes) violations.push({ category: "ceo_language", pattern: ceo.matchedPattern ?? "" });
  for (const [category, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) if (pattern.test(text)) violations.push({ category, pattern: pattern.source });
  }
  // Volunteered biography: distinctive words of any non-core canon fragment.
  const lowered = text.toLowerCase();
  for (const fragment of CLAIRE_CANON) {
    if (!fragment.fact || fragment.accessClass === "core") continue;
    const words = [...new Set(fragment.fact.toLowerCase().match(/[a-z]{7,}/g) ?? [])].filter(w => w !== "claire");
    if (words.filter(word => lowered.includes(word)).length >= 2) {
      violations.push({ category: "volunteered_biography", pattern: fragment.id });
    }
  }
  return { passes: violations.length === 0, violations };
}
