/**
 * Same-call semantic coverage: what subjects this call has already covered.
 *
 * Prompt history carries only the last few turns and `focusAccount` only says what is being
 * discussed *now*, so a subject discussed early in a long call was forgotten and Claire asked
 * about it again ("How's Dana at The Louise?" three times). This is compact, durable
 * (conversation state), and independent of the model's history window.
 *
 * Conversation continuity only: it never earns rapport, never creates business truth.
 */
import type { AccountRef } from "../knowledge/accountKnowledge";
import { matchAccounts } from "../knowledge/accountKnowledge";

export type CoveredSubject = {
  subject: string; // account:<id>
  name: string;
  people: string[];
  intent: "status_update";
  /** Content words already exchanged about this subject (Claire's ask + the operator's answer). */
  covered?: string[];
  askedByClaire: boolean;
  answeredByOperator: boolean;
  lastCoveredTurn: number;
};

const MAX_COVERED = 40;
const NOT_PEOPLE = new Set(["The", "This", "That", "Any", "Did", "How", "What", "When", "Who", "Where", "Which", "Are", "Is", "Was", "Have", "Has", "Any", "And", "But", "Okay", "Yes", "Noted", "Got", "Claire", "Adam", "Goldline", "Day", "Line", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

function peopleIn(text: string, account: AccountRef): string[] {
  const accountWords = new Set(account.name.split(/\s+/));
  return Array.from(new Set(text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])).filter(word => !NOT_PEOPLE.has(word) && !accountWords.has(word));
}

const STOP = new Set("about after again also and any are been before but can could did does doing done for from get going gone got had has have her him his how its just like more much not now off one our out over said say she some than that the their them then there these they this those was were what when where which who will with would you your yours".split(" "));
/** Generic status-check words: asking for "an update" adds no new topic. */
const GENERIC_STATUS = new Set("update updates status news latest lately happening happened going went goes moving progress stand standing thing things stuff there anything something over looking look looks situation deal currently right days week today how's".split(" "));

export function contentWords(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z][a-z']{3,}/g) ?? []).filter(word => !STOP.has(word) && !GENERIC_STATUS.has(word))));
}

function upsert(coverage: CoveredSubject[], next: CoveredSubject): CoveredSubject[] {
  const previous = coverage.find(entry => entry.subject === next.subject);
  const merged: CoveredSubject = previous
    ? { ...previous, ...next, people: Array.from(new Set([...previous.people, ...next.people])), covered: Array.from(new Set([...(previous.covered ?? []), ...(next.covered ?? [])])) }
    : next;
  return [...coverage.filter(entry => entry.subject !== next.subject), merged].slice(-MAX_COVERED);
}

/** Claire asked the operator about an account: that subject is now open and has been asked. */
export function recordClaireQuestionCoverage(
  coverage: CoveredSubject[] | undefined,
  input: { claireText: string; accounts: AccountRef[]; turnOrdinal: number }
): CoveredSubject[] {
  let next = coverage ?? [];
  const questions = input.claireText.split(/(?<=[.!?])\s+/).filter(sentence => sentence.includes("?"));
  for (const sentence of questions) {
    const matches = matchAccounts(sentence.toLowerCase(), input.accounts);
    if (matches.length !== 1) continue;
    const account = matches[0]!;
    next = upsert(next, {
      subject: `account:${account.id}`,
      name: account.name,
      people: peopleIn(sentence, account),
      intent: "status_update",
      covered: contentWords(sentence),
      askedByClaire: true,
      answeredByOperator: false,
      lastCoveredTurn: input.turnOrdinal,
    });
  }
  return next;
}

/** The operator replied after Claire asked: the open subject is answered. */
export function recordOperatorReplyCoverage(
  coverage: CoveredSubject[] | undefined,
  input: { operatorText: string; accounts: AccountRef[]; turnOrdinal: number }
): CoveredSubject[] {
  let next = coverage ?? [];
  const substantive = input.operatorText.trim().split(/\s+/).filter(Boolean).length >= 3;
  if (!substantive) return next;
  for (const entry of next) {
    if (entry.askedByClaire && !entry.answeredByOperator && input.turnOrdinal > entry.lastCoveredTurn) {
      next = upsert(next, { ...entry, covered: Array.from(new Set([...(entry.covered ?? []), ...contentWords(input.operatorText)])), answeredByOperator: true, people: [...entry.people, ...peopleIn(input.operatorText, { id: 0, name: entry.name, accountType: "" })], lastCoveredTurn: input.turnOrdinal });
    }
  }
  return next;
}

export function coveredThisCallLines(coverage: CoveredSubject[] | undefined): string[] {
  return (coverage ?? [])
    .filter(entry => entry.askedByClaire && entry.answeredByOperator)
    .map(entry => `${entry.name}${entry.people.length ? ` / ${entry.people.join(", ")}` : ""} / current status`);
}

/** The operator has explicitly returned to the subject: it may be discussed again. */
function operatorReopens(entry: CoveredSubject, operatorText: string, accounts: AccountRef[]): boolean {
  const lower = operatorText.toLowerCase();
  if (matchAccounts(lower, accounts).some(account => `account:${account.id}` === entry.subject)) return true;
  return entry.people.some(person => lower.includes(person.toLowerCase()));
}

/**
 * Deterministic backstop: drop a question sentence that restarts an already-covered
 * subject unless the operator reopened it this turn. Returns the corrected reply, or null when
 * nothing was restarted.
 */
export function suppressRestartedQuestion(
  reply: string,
  input: { coverage: CoveredSubject[] | undefined; operatorText: string; accounts: AccountRef[] }
): string | null {
  const covered = (input.coverage ?? []).filter(entry => entry.askedByClaire && entry.answeredByOperator && !operatorReopens(entry, input.operatorText, input.accounts));
  if (!covered.length) return null;
  const sentences = reply.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter(sentence => {
    if (!sentence.includes("?")) return true;
    const lower = sentence.toLowerCase();
    const matched = covered.filter(
      entry => matchAccounts(lower, [{ id: 0, name: entry.name, accountType: "" }]).length > 0 || entry.people.some(person => lower.includes(person.toLowerCase()))
    );
    if (!matched.length) return true;
    // A genuinely narrower follow-up (it introduces a topic not yet exchanged) is not a restart.
    return matched.some(entry => {
      const names = new Set([...entry.name.toLowerCase().split(/\s+/), ...entry.people.map(person => person.toLowerCase())]);
      const known = new Set(entry.covered ?? []);
      return contentWords(sentence).some(word => !names.has(word) && !known.has(word));
    });
  });
  if (kept.length === sentences.length) return null;
  const remaining = kept.join(" ").trim();
  return remaining || "Understood, that one's covered. What's next?";
}
