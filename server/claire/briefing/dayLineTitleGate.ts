/**
 * Day Line title gate. A spoken fragment is provenance, not a task title.
 *
 * Production 2026-10-19/20 (rows 1019eee6-…, 5442b244-…, 7f913f53-…): voice fragments were
 * committed as titles and then read aloud on every call:
 *   "Figure out how to get out in streets"          (cut at the 8-word target; the next clause,
 *                                                     "and hand printouts out to people", was dropped)
 *   "Fold service in person to people and try"      (cut mid-clause on "and try")
 *   "Before I leave work, I have to create new page for Laundry Farm"  (lead-in clause kept)
 *
 * The gate runs before any Day Line commit (briefing commit, work ledger, Brain V2 grant adapter all
 * go through `commitBriefing`). It never invents words. A title can only be:
 *   - committed as given,
 *   - rewritten by DELETING a lead-in ("Before I leave work, I have to …"), or by a model rewrite
 *     whose words are all grounded in what the operator said,
 *   - or refused with ONE clarifying question. The operator's words stay in `quote` / `sourceText`.
 */
import { compressTitle, isProtectedTitleToken, REASON_SPLIT } from "./titleContract";

export type TitleGateVerdict =
  | { verdict: "commit"; title: string; changed: boolean; reason: string | null }
  | { verdict: "needs_rewrite"; title: string; reason: string; question: string }
  | { verdict: "ask"; reason: string; question: string };

const WORD = (text: string) => text.split(/\s+/).filter(Boolean);
const bare = (token: string) => token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

/** A title may not open with one of these: it is the middle of a sentence, not an action. */
const NON_ACTION_START = new Set([
  "and", "so", "but", "or", "then", "also", "well", "um", "uh", "like", "because", "since", "if", "when", "while",
  "before", "after", "once", "that", "which", "who", "what", "how", "why", "where",
  "i", "i'm", "i've", "i'll", "we", "we're", "we've", "you", "he", "she", "they", "it", "my", "our", "your", "their", "his", "her",
  "the", "a", "an", "this", "these", "those", "some", "just", "maybe", "basically", "actually", "yes", "yeah", "ok", "okay",
  "to", "of", "in", "on", "at", "for", "with", "from", "by", "as",
]);

const COMMON_VERBS = new Set([
  "call", "email", "text", "message", "go", "drive", "pay", "buy", "send", "ask", "meet", "visit", "clean", "wash", "fold", "pick", "drop",
  "deliver", "order", "book", "print", "post", "write", "fix", "check", "review", "find", "get", "make", "build", "finish", "start", "plan",
  "update", "reply", "schedule", "confirm", "cancel", "return", "pack", "load", "charge", "collect", "follow", "prep", "prepare", "set",
  "take", "bring", "put", "do", "run", "see", "talk", "walk", "hand", "give", "create", "draft", "submit", "sign", "file", "upload",
]);

const FILLER = new Set(["the", "a", "an", "to", "for", "from", "at", "on", "of", "and", "or", "up", "off", "my", "his", "her", "their", "our", "some", "in", "with", "by", "as", "out", "it", "this", "that", "new"]);
const DANGLING_END = new Set(["and", "or", "to", "for", "the", "a", "an", "with", "at", "on", "in", "by", "from", "as", "so", "but", "of", "via", "then"]);

const LEAD_FILLER = /^(?:(?:and|so|also|then|well|um|uh|okay|ok|yeah|yes|like|basically|actually)[,\s]+)+/i;
const TEMPORAL_CLAUSE = /^(?:before|after|when|once|while|as soon as)\b[^,]{1,70},\s*/i;
const OBLIGATION_LEAD =
  /^(?:(?:i|we)(?:'ve| have|'m| am|'ll| will)?\s+(?:still\s+|really\s+|just\s+)?(?:need to|have to|has to|got to|gotta|want to|am going to|'m going to|should|must|will)|(?:i|we)\s+gotta|(?:i|we)\s+(?:need|have|got)\s+to)\s+/i;

export function meaningfulWords(title: string): string[] {
  return WORD(title)
    .map(bare)
    .filter(token => token && !FILLER.has(token));
}

function startsLikeAction(title: string): boolean {
  const first = bare(WORD(title)[0] ?? "");
  return Boolean(first) && !NON_ACTION_START.has(first);
}

/** Tokens of the quote after a title that is a cut of its opening, or null when the title is not a cut of the quote. */
function uncoveredTail(title: string, quote: string): string[] | null {
  const q = WORD(quote).map(bare).filter(Boolean);
  const t = WORD(title).map(bare).filter(token => token && !["the", "a", "an", "my", "our", "their", "his", "her"].includes(token));
  if (!t.length) return null;
  // The title's words must appear in the quote in the same order, starting where the title starts.
  const qContent = q.filter(token => !["the", "a", "an", "my", "our", "their", "his", "her"].includes(token));
  const start = qContent.indexOf(t[0]!);
  if (start < 0) return null;
  let cursor = start;
  for (const token of t) {
    const at = qContent.indexOf(token, cursor);
    if (at < 0) return null;
    cursor = at + 1;
  }
  return qContent.slice(cursor);
}

/**
 * True when the title ends before the operator's sentence did and what was left out is a second
 * piece of work ("… and hand printouts out to people"), or the title stops mid-clause ("… and try").
 */
export function titleIsCutFragment(title: string, quote: string): boolean {
  const words = WORD(title);
  if (!words.length) return true;
  const last = bare(words[words.length - 1]!);
  const tail = uncoveredTail(title, quote);
  const hasMoreSpeech = Boolean(tail && tail.length >= 2);
  if (DANGLING_END.has(last)) return true;
  if (/\b(?:and|or)\s+[a-z']+$/i.test(title) && hasMoreSpeech && !isProtectedTitleToken(words[words.length - 1]!)) return true;
  if (tail && tail.length >= 3 && tail[0] === "and") return true;
  return false;
}

function question(quote: string): string {
  const spoken = WORD(quote).slice(0, 16).join(" ").replace(/[.,;:!?]+$/g, "");
  return `I heard "${spoken}", but I can't turn that into one clear task. What should the Day Line say?`;
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** Deterministic part of the gate. Pure; the model rewrite is a separate, injected step. */
export function gateDayLineTitle(input: { title: string; quote: string }): TitleGateVerdict {
  const original = input.title.replace(/\s+/g, " ").trim();
  const quote = (input.quote || original).replace(/\s+/g, " ").trim();
  if (!original) return { verdict: "ask", reason: "empty title", question: question(quote) };

  // 1. Delete lead-ins. Deleting words never adds one.
  let title = original.replace(LEAD_FILLER, "");
  title = title.replace(TEMPORAL_CLAUSE, "").replace(LEAD_FILLER, "");
  title = title.replace(OBLIGATION_LEAD, "").trim();
  title = title.replace(/[.,;:!?—-]+$/g, "").trim();
  title = capitalize(title);
  const stripped = title !== original;

  // 2. A cut fragment is refused: either the model rewrites it or the operator is asked.
  const checkTitle = title || original;
  if (titleIsCutFragment(checkTitle, quote) || titleIsCutFragment(compressTitle(checkTitle), quote)) {
    return {
      verdict: "needs_rewrite",
      title: checkTitle,
      reason: "title is a cut fragment of a longer spoken sentence",
      question: question(quote),
    };
  }

  // 2b. The title contract would cut this title later. Dropping a reason clause ("because …") is its job;
  // dropping the back half of the task itself is how "Fold service in person to people and try" was made.
  if (!REASON_SPLIT.test(checkTitle)) {
    const lost = meaningfulWords(checkTitle).length - meaningfulWords(compressTitle(checkTitle)).length;
    if (lost >= 2) {
      return { verdict: "needs_rewrite", title: checkTitle, reason: "title is too long to keep whole and would be cut mid-task", question: question(quote) };
    }
  }

  // 3. Shape: starts as an action, has an object.
  if (!startsLikeAction(title)) {
    return { verdict: "needs_rewrite", title: checkTitle, reason: "title does not start with an action", question: question(quote) };
  }
  const words = WORD(title);
  const meaningful = meaningfulWords(title);
  const namedObject = words.slice(1).some(isProtectedTitleToken);
  // Three or more meaningful words is a task. Two is a task only as a recognizable verb + object ("Call Dana",
  // "Wash my jacket"); two nouns ("Laundry stuff") is a label, not something to do.
  const shortButActionable = meaningful.length === 2 && (namedObject || COMMON_VERBS.has(bare(words[0]!)));
  if (words.length < 2 || (meaningful.length < 3 && !shortButActionable)) {
    return { verdict: "needs_rewrite", title: checkTitle, reason: "fewer than three meaningful words and no named object", question: question(quote) };
  }
  return { verdict: "commit", title, changed: stripped, reason: stripped ? "lead-in removed" : null };
}

/** A model rewrite is accepted only if it is grounded in the operator's words and passes the gate itself. */
export function acceptRewrittenTitle(rewrite: string, quote: string): string | null {
  const candidate = rewrite.replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "");
  if (!candidate || WORD(candidate).length > 12) return null;
  const allowed = new Set(WORD(quote).map(bare).filter(Boolean));
  const content = meaningfulWords(candidate);
  if (content.length < 2) return null;
  // Each content word must be one the operator said (a plural or tense change of it counts).
  const stem = (token: string) => token.replace(/(?:ing|ed|es|s)$/g, "");
  const allowedStems = new Set([...allowed].map(stem));
  const grounded = content.filter(token => allowed.has(token) || allowedStems.has(stem(token))).length;
  if (grounded / content.length < 0.85) return null;
  const verdict = gateDayLineTitle({ title: candidate, quote: candidate });
  return verdict.verdict === "commit" ? verdict.title : null;
}
