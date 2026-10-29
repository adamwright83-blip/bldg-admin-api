/**
 * Operator authorization for a Day Line write made from a tool call.
 *
 * The model decides WHAT the operator authorized; the server checks that the
 * authorization it cites is real and specific. Three checks, all at the tool
 * boundary:
 *
 * 1. The quoted words were actually said on this call (never fabricated).
 * 2. A bare acknowledgement ("yes", "sure", "do it") binds only to an offer
 *    Claire actually made in her previous line, and only for the items that
 *    offer named. Not "did the line end with a question mark" (run 11 refused
 *    a real offer phrased as a statement): did the line offer, and did it name
 *    this work.
 * 3. Work that existed before the call is conservative territory. Moving,
 *    completing or removing it needs the operator's words to name that item
 *    and to carry the action ("take the Pham session off", "the Alvarado
 *    disposal is done", "I'll do that tomorrow" after Claire named it). "I
 *    didn't say anything about the Pham session" names it and asks for
 *    nothing; the tool refuses and Claire asks. Work added on this call is the
 *    operator's own dictation and stays easy to correct.
 *
 * The principle (2026-10-29): proactive about recording new work, conservative
 * about changing work the operator already committed to.
 */

export type AuthorizationVerdict =
  | { ok: true; quote: string; bareAck: boolean }
  | { ok: false; reason: string };

const BARE_ACK = /^(?:yes|yeah|yep|yup|sure|ok|okay|fine|do it|go ahead|please|yes please|correct|right|that's right|exactly|of course|just do it|go|affirmative|sounds good|perfect|good)[.!,\s]*$/i;

/** Claire offering to do something, however punctuated. */
const OFFER = /\b(want me to|should i|shall i|do you want|would you like|if you(?:'d| would)? like|if you want|say the word|i can (?:put|add|move|take|mark|set)|i could (?:put|add|move)|i'll (?:put|add|move) (?:it|that|them|those) (?:on|there) if)\b|\?\s*$/i;

const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "then", "them", "they", "will", "just", "about", "there", "their", "your", "you're", "have", "need", "want", "some", "thing", "things", "today", "tomorrow", "tonight", "morning", "afternoon", "evening", "night", "week", "next", "coming", "day", "days", "after", "before", "please", "claire", "also", "okay", "yeah", "really", "already", "still", "like", "said", "say", "told", "tell", "line", "list", "work", "item", "items", "stuff", "something", "anything", "nothing", "take", "put", "move", "mark", "done", "over", "down", "back", "again", "right", "sure", "good", "fine", "what", "when", "which", "where", "while", "would", "could", "should", "going", "gonna", "doing", "does", "didn't", "don't", "doesn't", "isn't", "wasn't", "aren't", "it's", "that's", "there's", "here's", "i'll", "i'm", "i've", "we'll", "let's"]);

export function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that identify a piece of work: 4+ letters, not filler, possessives stripped. */
export function distinctiveTokens(text: string): string[] {
  return [
    ...new Set(
      normalizeWords(text)
        .split(" ")
        .map(token => token.replace(/'s$/, "").replace(/'$/, ""))
        .filter(token => token.length >= 4 && !STOPWORDS.has(token))
    ),
  ];
}

/** Verbs and generic nouns that describe the kind of work, not which work. */
const GENERIC_WORK = new Set(["pitch", "person", "follow", "followup", "visit", "call", "email", "text", "deliver", "delivery", "pickup", "pick", "drop", "dropoff", "clean", "cleaning", "session", "meeting", "appointment", "check", "order", "renew", "quote", "replace", "install", "walk", "interview", "write", "finish", "complete", "grade", "review", "prep", "setup", "repair", "trim", "mow", "wash", "drive", "stop", "swing", "signing", "count", "audit", "invoice", "invoices", "with", "house", "place", "office", "store", "shop", "school", "family", "sisters", "brothers", "morning", "afternoon", "tonight", "tomorrow", "today"]);

/**
 * The words that say WHICH piece of work: proper names in the title (any
 * capitalized word after the first), else its non-generic nouns. "Pitch The
 * Chadwick in person" → chadwick; "Renew the business license" → business, license.
 */
export function identifyingTokens(title: string): string[] {
  const words = title.replace(/[’‘]/g, "'").split(/\s+/).filter(Boolean);
  const proper = [
    ...new Set(
      words
        .slice(1)
        .filter(word => /^[A-Z][A-Za-z'’.-]*$/.test(word) && !/^(The|A|An|At|In|On|To|For|With|And|Of|From|By)$/.test(word))
        .map(word => normalizeWords(word).replace(/'s$/, ""))
        .filter(word => word.length >= 3)
    ),
  ];
  if (proper.length) return proper;
  return distinctiveTokens(title).filter(token => !GENERIC_WORK.has(token));
}

/** Whether `text` names the work `title` describes: shares one of its identifying words. */
export function namesWork(text: string, title: string): boolean {
  const words = new Set(normalizeWords(text).split(" ").map(token => token.replace(/'s$/, "")));
  const identifying = identifyingTokens(title);
  const pool = identifying.length ? identifying : distinctiveTokens(title);
  return pool.some(token => words.has(token));
}

export function isBareAck(text: string): boolean {
  return BARE_ACK.test(text.trim());
}

export function isOffer(text: string | null | undefined): boolean {
  return Boolean(text && OFFER.test(text.trim()));
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
  const bareAck = isBareAck(quote);
  if (bareAck && !isOffer(input.lastClaireText)) {
    return { ok: false, reason: `"${quote}" answers nothing: your previous line made no offer, so it authorizes no write; ask plainly` };
  }
  return { ok: true, quote, bareAck };
}

/**
 * A bare yes binds to the offer Claire just made, for the work that offer named.
 * Returns the titles the offer did not name (empty = all bound).
 */
export function changesOutsideOffer(lastClaireText: string | null, titles: readonly string[]): string[] {
  if (!lastClaireText) return [...titles];
  return titles.filter(title => !namesWork(lastClaireText, title));
}

const REFERENT = /\b(that|it|those|them|this|these|the (?:first|second|third|last) one|both|all three|all of (?:it|them|those))\b/i;
const REMOVE_ACTION = /\b(take|pull|get|knock|scratch|strike|cross|drop|remove|delete|cancel|clear|kill|skip|leave) (?:\w+ ){0,6}?(?:off|out|it|that|them)\b|\b(?:off|out of) (?:the )?(?:list|line|day line|schedule|tomorrow|today|\w+day)\b|\b(remove|delete|cancel|scratch|skip|drop) (?:the |that |it|them)?/i;
const COMPLETE_ACTION = /\b(done|finished|complete|completed|did (?:it|that|the|them|this)|already did|handled|took care|wrapped|knocked out|mark (?:it|that|them|the)|marked|is in|went fine|went well|got it done|is over with|crossed off)\b/i;
const MOVE_ACTION = /\b(move|push|bump|shift|reschedule|slide|switch|swap|instead|defer|postpone|do (?:it|that|them|those|this) (?:tomorrow|tonight|on |next |the day after|\w+day)|(?:to|for|on) (?:tomorrow|tonight|today|next \w+|the day after tomorrow|\w+day)\b|tomorrow instead|another day|later this week)/i;

export type ExistingRowOp = "move" | "remove" | "complete";

/**
 * Pre-existing work: the operator's words must name THIS item (or refer to the
 * item Claire just named) and carry THIS action. Otherwise refuse, and say why,
 * so Claire asks instead of acting.
 */
export function authorizeExistingRowChange(input: {
  op: ExistingRowOp;
  rowTitle: string;
  rowId: string;
  quote: string;
  lastClaireText: string | null;
  /** move only: the spoken target day, so "I'll do that tomorrow" counts as the action. */
  toDay?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const quote = input.quote.trim();
  const named = quote.includes(input.rowId) || namesWork(quote, input.rowTitle);
  const referred = !named && REFERENT.test(quote) && Boolean(input.lastClaireText && namesWork(input.lastClaireText, input.rowTitle));
  if (!named && !referred) {
    return { ok: false, reason: `"${input.rowTitle}" was on the Day Line before this call, and the operator's words do not name it; ask before changing work they already committed to` };
  }
  const action = input.op === "remove" ? REMOVE_ACTION : input.op === "complete" ? COMPLETE_ACTION : MOVE_ACTION;
  const toDayWords = input.op === "move" && input.toDay ? normalizeWords(input.toDay) : null;
  const actionPresent = action.test(quote) || Boolean(toDayWords && normalizeWords(quote).includes(toDayWords));
  if (!actionPresent) {
    const verb = input.op === "remove" ? "take it off" : input.op === "complete" ? "that it is done" : "move it";
    return { ok: false, reason: `"${input.rowTitle}" was on the Day Line before this call; the operator mentioned it but did not say to ${verb}. Ask: "Do you want me to ${input.op === "complete" ? "mark it done" : input.op === "remove" ? "take it off" : "move it"}?"` };
  }
  return { ok: true };
}
