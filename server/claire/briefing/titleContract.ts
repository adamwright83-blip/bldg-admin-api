/**
 * Day Line title contract. A spoken brain dump is provenance, not a task title.
 *
 *  - The raw utterance is always preserved separately (`sourceText` / `quote`).
 *  - A title is the ACTION: normally 3–8 words, verb + object.
 *  - 8 words is a target, not an invariant. Customer / building / product / action
 *    identifiers are never truncated just to hit the count.
 *  - Reasons, feelings, who asked, and background never belong in a title.
 *
 * `compressTitle` only ever DELETES words from what the operator said; it never adds any.
 */

export const TITLE_TARGET_MAX_WORDS = 8;

/** Where a reason / feeling / background clause begins. Everything from here on is context, not the task. */
const REASON_SPLIT =
  /\s*[,;—-]?\s*\b(?:because|since|so that|which means|and that means|that means|but whatever|whatever|and (?:i|we)(?:'m| am| are|'ve| have)\b|as (?:my|our) \w+|my boss|and my boss|considering|given that)\b/i;

const LEAD_IN =
  /^(?:(?:and|so|also|then|yes|yeah|ok|okay|um|uh|well|like|actually|basically)[,\s]+)*(?:(?:i|we)(?:'ve| have|'m| am)?\s+(?:still\s+)?(?:need|have|got|gotta|want|am supposed|'m supposed|am going|'m going)\s+to\s+|(?:i|we)\s+gotta\s+)?/i;

const DETERMINERS = new Set(["a", "an", "the", "my", "his", "her", "our", "their", "some", "this", "that"]);
const TRAILING_STOP = new Set(["via", "for", "to", "of", "and", "or", "the", "a", "an", "with", "at", "on", "in", "by", "from", "as", "so", "but"]);

const words = (text: string) => text.split(/\s+/).filter(Boolean);
const capitalize = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/**
 * A token that must survive compression: proper names, products, buildings, spelled brands.
 * Never drop or slice these merely to satisfy the word target.
 */
export function isProtectedTitleToken(token: string): boolean {
  const raw = token.replace(/[.,;:!?]+$/g, "");
  if (!raw) return false;
  if (/[A-Z]/.test(raw) && /[a-z]/.test(raw) && raw[0] === raw[0]!.toUpperCase()) return true;
  if (/[A-Z]{2,}/.test(raw)) return true;
  if (/\d/.test(raw)) return true;
  if (/[.]/.test(raw)) return true; // z-e-e-l-y.ai / Zeely.ai
  return false;
}

function dropUnprotectedDeterminer(parts: string[]): string[] {
  const next = [...parts];
  for (let i = 0; i < next.length && unprotectedCount(next) > TITLE_TARGET_MAX_WORDS; ) {
    if (i > 0 && DETERMINERS.has(next[i]!.toLowerCase()) && !isProtectedTitleToken(next[i]!)) {
      next.splice(i, 1);
    } else i += 1;
  }
  return next;
}

function unprotectedCount(parts: string[]): number {
  return parts.length;
}

export function compressTitle(raw: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(LEAD_IN, "").trim();
  const cut = REASON_SPLIT.exec(text);
  if (cut && cut.index > 0) {
    const head = text.slice(0, cut.index).trim();
    if (words(head).length >= 2) text = head;
  }
  text = text.replace(/[.,;:!?—-]+$/g, "").trim();
  let parts = dropUnprotectedDeterminer(words(text));
  while (parts.length > 2 && TRAILING_STOP.has(parts[parts.length - 1]!.toLowerCase().replace(/[.,;:!?]+$/g, ""))) {
    parts.pop();
  }
  // Prefer the target length, but stop before dropping a protected identifier.
  while (parts.length > TITLE_TARGET_MAX_WORDS) {
    const last = parts[parts.length - 1]!;
    if (isProtectedTitleToken(last)) break;
    parts.pop();
  }
  while (parts.length > 2 && TRAILING_STOP.has(parts[parts.length - 1]!.toLowerCase().replace(/[.,;:!?]+$/g, ""))) {
    parts.pop();
  }
  return capitalize(parts.join(" ").replace(/[.,;:!?—-]+$/g, ""));
}

export function titleWordCount(title: string): number {
  return words(title).length;
}

/** Enforce the contract without destroying identifiers. A faithful short title is left alone. */
export function enforceTitleContract(title: string): string {
  const trimmed = title.replace(/\s+/g, " ").trim();
  if (!trimmed) return trimmed;
  if (REASON_SPLIT.test(trimmed)) return compressTitle(trimmed);
  if (titleWordCount(trimmed) <= TITLE_TARGET_MAX_WORDS) return trimmed;
  return compressTitle(trimmed);
}

const EXPLICIT_TRACKING =
  /\b(?:add|put|place|log|track|note|write|save|schedule|set)\b[^.!?]{0,80}\b(?:day ?line|reminder|to-?do|calendar|my list|the list|my plan|the plan)\b|\bremind me\b|\bday ?line\b[^.!?]{0,40}\b(?:add|put)\b|\byou can put (?:that|it)\b/i;

export function explicitTrackingRequest(utterance: string): boolean {
  return EXPLICIT_TRACKING.test(utterance);
}

export function explicitDayLineRefusal(utterance: string): boolean {
  return /\b(?:don'?t|do not|no need to|i don'?t need)\b[^.!?]{0,40}\b(?:day ?line|the list|on (?:the|my) (?:list|plan))\b/i.test(
    utterance
  );
}
