/**
 * Operator authorization for a Day Line write made from a tool call.
 *
 * The model decides WHAT the operator authorized; the server checks that the
 * authorization it cites is real. Every `apply_day_line_changes` call must
 * quote the operator's authorizing words, and the quote must be something the
 * operator actually said on this call. A bare acknowledgement ("yes", "sure",
 * "do it") counts only when Claire's previous line asked a question, because a
 * yes to nothing authorizes nothing. The model cannot manufacture approval
 * from words that were never spoken, and the quote is stored with the row.
 */

export type AuthorizationVerdict =
  | { ok: true; quote: string }
  | { ok: false; reason: string };

const BARE_ACK = /^(?:yes|yeah|yep|yup|sure|ok|okay|fine|do it|go ahead|please|yes please|correct|right|that's right|exactly|of course|just do it|go|affirmative)[.!,\s]*$/i;

export function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyOperatorAuthorization(input: {
  quote: string | null | undefined;
  operatorTurns: readonly string[];
  /** What Claire said right before the operator's latest turn, if anything. */
  lastClaireText: string | null;
}): AuthorizationVerdict {
  const quote = (input.quote ?? "").trim();
  if (!quote) return { ok: false, reason: "no operator words were cited; quote what the operator said that authorizes this" };
  const needle = normalizeWords(quote);
  if (needle.length < 2) return { ok: false, reason: "the cited words are too short to be an authorization" };
  const saidIt = input.operatorTurns.some(turn => normalizeWords(turn).includes(needle));
  if (!saidIt) return { ok: false, reason: `the operator did not say "${quote}" on this call; cite their actual words or ask` };
  if (BARE_ACK.test(quote)) {
    const asked = Boolean(input.lastClaireText && /\?\s*$/.test(input.lastClaireText.trim()));
    if (!asked) return { ok: false, reason: `"${quote}" answers nothing: you did not ask a question just before it, so it authorizes no write` };
  }
  return { ok: true, quote };
}
