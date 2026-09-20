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
  askedByClaire: boolean;
  answeredByOperator: boolean;
  lastCoveredTurn: number;
};

const MAX_COVERED = 10;
const NOT_PEOPLE = new Set(["The", "This", "That", "Any", "Did", "How", "What", "When", "Who", "Where", "Which", "Are", "Is", "Was", "Have", "Has", "Any", "And", "But", "Okay", "Yes", "Noted", "Got", "Claire", "Adam", "Goldline", "Day", "Line", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]);

function peopleIn(text: string, account: AccountRef): string[] {
  const accountWords = new Set(account.name.split(/\s+/));
  return Array.from(new Set(text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])).filter(word => !NOT_PEOPLE.has(word) && !accountWords.has(word));
}

function upsert(coverage: CoveredSubject[], next: CoveredSubject): CoveredSubject[] {
  const previous = coverage.find(entry => entry.subject === next.subject);
  const merged: CoveredSubject = previous
    ? { ...previous, ...next, people: Array.from(new Set([...previous.people, ...next.people])) }
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
      next = upsert(next, { ...entry, answeredByOperator: true, people: [...entry.people, ...peopleIn(input.operatorText, { id: 0, name: entry.name, accountType: "" })], lastCoveredTurn: input.turnOrdinal });
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
    const restarts = covered.some(
      entry => matchAccounts(lower, [{ id: 0, name: entry.name, accountType: "" }]).length > 0 || entry.people.some(person => lower.includes(person.toLowerCase()))
    );
    return !restarts;
  });
  if (kept.length === sentences.length) return null;
  const remaining = kept.join(" ").trim();
  return remaining || "Understood, that one's covered. What's next?";
}
