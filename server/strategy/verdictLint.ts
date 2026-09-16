/**
 * Verdict and Causation Lint (Slice 8, Guardrails G5 & G12).
 * G5: Evidence, not verdicts. Rejects judgmental words about plays.
 * G12: Attribution is not causation. Rejects causal claims about plays.
 */

export interface LintResult {
  valid: boolean;
  violations: string[];
  cleanText: string;
}

const VERDICT_PATTERNS = [
  /\b(?:isn't|is not|not)\s+working\b/i,
  /\b(?:failing|failed|failure)\b/i,
  /\b(?:waste of (?:time|money))\b/i,
  /\b(?:crushing it|killing it)\b/i,
  /\b(?:game changer|miracle|total disaster)\b/i,
  /\b(?:terrible|awful|pathetic)\s+(?:play|strategy|funnel|route)\b/i,
  /\b(?:huge|massive)\s+(?:success|flop)\b/i,
  /\b(?:weak|strong)\s+(?:play|strategy|route|performance)\b/i,
];

const CAUSAL_PATTERNS = [
  /\b(?:caused by|responsible for)\s+(?:this|the)?\s*(?:play|growth|route)\b/i,
  /\b(?:created|generated|produced|drove)\s+(?:\d+\s+)?(?:new\s+)?customers?\b/i,
  /\b(?:play|route|strategy)\s+(?:produced|created|drove|generated)\s+(?:\d+\s+)?(?:new\s+)?customers?\b/i,
];

/**
 * Lints text against verdict language (Guardrail G5).
 */
export function lintVerdictLanguage(text: string): LintResult {
  const violations: string[] = [];
  for (const pattern of VERDICT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      violations.push(`Verdict language detected: "${match[0]}"`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    cleanText: text,
  };
}

/**
 * Lints text against causal claims (Guardrail G12).
 */
export function lintCausalLanguage(text: string): LintResult {
  const violations: string[] = [];
  for (const pattern of CAUSAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      violations.push(`Causal claim detected: "${match[0]}". Must use "linked to", not causal verbs.`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
    cleanText: text,
  };
}
