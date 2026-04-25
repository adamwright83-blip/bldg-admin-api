/**
 * Deterministic post-LLM safety sanitizer for Level 4 offensive copy.
 *
 * Inspects `primaryCopy` and `body` fields. Reports any of:
 *   - bracket placeholder tokens ([link], [url], [name], etc.)
 *   - offer / discount / promo / free / credit / coupon language
 *   - timing claims (numeric or qualitative) not authorized by the payload
 *   - qualitative social-proof phrasing (e.g. "your neighbors are using")
 *   - mentions of specific service categories not in the per-block allowed list
 *
 * Only LLM-path (SMS-deliverable) copy reaches this sanitizer. Card-deliverable
 * copy is deterministic and pre-reviewed; it bypasses sanitization upstream.
 *
 * Output is a structured violation list — caller decides whether to repair,
 * re-prompt, or hard-fail.
 */

export type GeneratedCopyShape = {
  headline: string;
  body: string;
  primaryCopy: string;
  internalNote: string;
};

export type SanitizerInputContext = {
  /** Service categories explicitly mentioned in the per-block payload (lowercased). Empty = none allowed. */
  allowedServiceCategories?: string[];
  /** Numeric timings explicitly present in the payload (e.g. "2 minutes"). Empty = no timing claims allowed. */
  allowedTimingPhrases?: string[];
};

export type SanitizeViolation = {
  field: "primaryCopy" | "body";
  rule:
    | "bracket_placeholder"
    | "offer_or_discount"
    | "free_language"
    | "promo_or_coupon_code"
    | "save_amount"
    | "timing_claim"
    | "social_proof_qualitative"
    | "service_category_unsupported"
    | "service_delivery_mechanic"
    | "generic_sales_phrase";
  match: string;
};

export type SanitizeResult =
  | { ok: true }
  | { ok: false; violations: SanitizeViolation[] };

const FORBIDDEN_BRACKET = /\[\s*[a-z][a-z0-9_\s-]*\s*\]/gi;

const OFFER_PATTERNS: RegExp[] = [
  /\b\d+\s*%\s*off\b/gi,
  /\bpercent\s+off\b/gi,
  /\bdiscount(?:s|ed|ing)?\b/gi,
  /\bcredit\s+toward\b/gi,
  /\btrial\s+(?:offer|period)\b/gi,
  /\bintroductory\s+(?:offer|rate|price)\b/gi,
  /\bcomplimentary\b/gi,
  /\bon\s+the\s+house\b/gi,
  /\bgift\s+card\b/gi,
  /\bbogo\b/gi,
  /\bbuy\s+one\s+get\s+one\b/gi,
];

const FREE_PATTERN = /\bfree\b/gi;
const PROMO_CODE_PATTERN = /\b(?:promo|coupon|referral)\s+code\b/gi;
const SAVE_AMOUNT_PATTERN = /\bsave\s+\$?\d+/gi;

const GENERIC_SALES_PHRASES: RegExp[] = [
  /\bjust\s+checking\s+in\b/gi,
  /\bhope\s+you(?:'| a)?re\s+well\b/gi,
  /\bwanted\s+to\s+reach\s+out\b/gi,
  /\bcircle\s+back\b/gi,
  /\bfollowing\s+up\b/gi,
  /\bpremium\b/gi,
  /\bseamless\b/gi,
  /\belevated\b/gi,
  /\bdelighted\b/gi,
];

const TIMING_PATTERNS: RegExp[] = [
  /\b\d+\s*(?:second|sec|minute|min|hour|hr|day|week|month)s?\b/gi,
  /\b(?:a\s+few|a\s+couple\s+of)\s+(?:seconds?|minutes?|moments?|hours?|days?)\b/gi,
  /\btakes?\s+(?:less\s+than\s+)?(?:a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:second|minute|hour|day)s?\b/gi,
  /\bin\s+(?:seconds?|minutes?)\b/gi,
  /\bquick(?:ly)?\b/gi,
  /\binstant(?:ly|aneous)?\b/gi,
  /\bsame[-\s]?day\b/gi,
  /\bnext[-\s]?day\b/gi,
];

/**
 * Service-delivery mechanics: pickup, delivery, doorstep, drop-off, etc.
 * These are operational claims about how the service works. The payload
 * currently supplies none, so any mention is unsupported and must be stripped.
 * When a future payload includes an explicit `allowedDeliveryMechanics` list,
 * extend the sanitizer context to accept them.
 */
const SERVICE_DELIVERY_MECHANIC_PATTERNS: RegExp[] = [
  /\bpick[-\s]?up\s+and\s+delivery\b/gi,
  /\bpickup\s*(?:&|and|\/)\s*delivery\b/gi,
  /\bpick[-\s]?ups?\b/gi,
  /\bdeliver(?:y|ies|ed|ing)\b/gi,
  /\bdoor[-\s]?step\b/gi,
  /\bdoor[-\s]?to[-\s]?door\b/gi,
  /\bdrop[-\s]?offs?\b/gi,
  /\bdrop[-\s]?ins?\b/gi,
  /\bat\s+your\s+door\b/gi,
  /\bcurb[-\s]?side\b/gi,
  /\bcontactless\b/gi,
];

const SOCIAL_PROOF_PATTERNS: RegExp[] = [
  /\byour\s+neighbor/gi,
  /\bneighbors?\s+(?:are|is|have|has|already|signed|using|love|trust|joined)\b/gi,
  /\balready\s+using\b/gi,
  /\bjoin\s+(?:your\s+)?neighbor/gi,
  /\bresidents?\s+(?:are|is)\s+using\b/gi,
];

/**
 * Banned service-category terms — only flagged when NOT in the
 * payload-supplied allowed-categories set. Multi-word phrases match as
 * case-insensitive substrings; single-word terms use word boundaries.
 */
const SERVICE_CATEGORY_TERMS: string[] = [
  "laundry",
  "wash and fold",
  "wash & fold",
  "wash/fold",
  "wash-fold",
  "wash fold",
  "dry cleaning",
  "dry-cleaning",
  "drycleaning",
  "dry clean",
  "dry-clean",
  "alteration",
  "alterations",
  "tailor",
  "tailoring",
  "tailored",
  "hem",
  "hemming",
];

function collectMatches(text: string, re: RegExp): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out;
}

function termOccursAsWord(text: string, term: string): string | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = term.includes(" ") || term.includes("-") || term.includes("/") || term.includes("&")
    ? new RegExp(escaped, "i")
    : new RegExp(`\\b${escaped}\\b`, "i");
  const m = re.exec(text);
  return m ? m[0] : null;
}

function inspectField(
  field: "primaryCopy" | "body",
  text: string,
  ctx: SanitizerInputContext
): SanitizeViolation[] {
  const violations: SanitizeViolation[] = [];

  for (const m of collectMatches(text, FORBIDDEN_BRACKET)) {
    violations.push({ field, rule: "bracket_placeholder", match: m });
  }
  for (const re of OFFER_PATTERNS) {
    for (const m of collectMatches(text, re)) {
      violations.push({ field, rule: "offer_or_discount", match: m });
    }
  }
  for (const m of collectMatches(text, FREE_PATTERN)) {
    violations.push({ field, rule: "free_language", match: m });
  }
  for (const m of collectMatches(text, PROMO_CODE_PATTERN)) {
    violations.push({ field, rule: "promo_or_coupon_code", match: m });
  }
  for (const m of collectMatches(text, SAVE_AMOUNT_PATTERN)) {
    violations.push({ field, rule: "save_amount", match: m });
  }
  for (const re of GENERIC_SALES_PHRASES) {
    for (const m of collectMatches(text, re)) {
      violations.push({ field, rule: "generic_sales_phrase", match: m });
    }
  }

  const allowedTimings = (ctx.allowedTimingPhrases ?? []).map((p) => p.toLowerCase());
  for (const re of TIMING_PATTERNS) {
    for (const m of collectMatches(text, re)) {
      if (allowedTimings.some((p) => p === m.toLowerCase())) continue;
      violations.push({ field, rule: "timing_claim", match: m });
    }
  }

  for (const re of SOCIAL_PROOF_PATTERNS) {
    for (const m of collectMatches(text, re)) {
      violations.push({ field, rule: "social_proof_qualitative", match: m });
    }
  }

  for (const re of SERVICE_DELIVERY_MECHANIC_PATTERNS) {
    for (const m of collectMatches(text, re)) {
      violations.push({ field, rule: "service_delivery_mechanic", match: m });
    }
  }

  const allowedCats = new Set(
    (ctx.allowedServiceCategories ?? []).map((c) => c.toLowerCase())
  );
  for (const term of SERVICE_CATEGORY_TERMS) {
    if (allowedCats.has(term.toLowerCase())) continue;
    const hit = termOccursAsWord(text, term);
    if (hit) {
      violations.push({ field, rule: "service_category_unsupported", match: hit });
    }
  }

  return violations;
}

export function sanitizeCopy(
  copy: GeneratedCopyShape,
  ctx: SanitizerInputContext = {}
): SanitizeResult {
  const violations: SanitizeViolation[] = [
    ...inspectField("primaryCopy", copy.primaryCopy, ctx),
    ...inspectField("body", copy.body, ctx),
  ];
  if (violations.length === 0) return { ok: true };
  return { ok: false, violations };
}

/**
 * Human-readable, model-readable list of violations to feed back into a re-prompt.
 */
export function describeViolations(violations: SanitizeViolation[]): string {
  const ruleLabels: Record<SanitizeViolation["rule"], string> = {
    bracket_placeholder: "bracketed placeholder token (e.g. [link])",
    offer_or_discount: "offer or discount language",
    free_language: 'the word "free"',
    promo_or_coupon_code: "promo, coupon, or referral code reference",
    save_amount: 'a "save $X" or "save N" claim',
    timing_claim: "a timing claim (e.g. minutes, seconds, quick, instantly) not in the payload",
    social_proof_qualitative: 'qualitative social-proof phrasing (e.g. "your neighbors are using")',
    service_category_unsupported: "a specific service-category term not authorized by the payload",
    service_delivery_mechanic: 'a service-delivery mechanic (e.g. "pickup", "delivery", "doorstep") not authorized by the payload',
    generic_sales_phrase: "generic sales phrase banned by the Level 4 copy contract",
  };
  return violations
    .map((v) => `- in ${v.field}: ${ruleLabels[v.rule]} — matched "${v.match}"`)
    .join("\n");
}
