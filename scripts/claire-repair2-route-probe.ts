/**
 * Claire Intelligence Repair Part 2, Slice A: static route probe.
 *
 * The 30-day production distribution needs the database and the telemetry this
 * slice adds. This script measures the thing that does not need either: given
 * a question, which matcher in `answerQuestion`'s ladder claims it first, and
 * therefore whether the repaired conversational path can ever be reached.
 *
 * Every matcher used here is the real one, imported from the code that routes
 * live turns — not a re-implementation.
 *
 *   npx tsx scripts/claire-repair2-route-probe.ts
 */
import { parseBusinessTurn } from "../server/claire/businessConversation";
import { normalizeUtterance } from "../server/claire/business/businessLanguage";
import { operationsQuestion } from "../server/claire/knowledge/operationsKnowledge";
import { isUnpaidQuestion } from "../server/claire/knowledge/openOrdersKnowledge";
import { isAccountQuestion, matchAccounts, type AccountRef } from "../server/claire/knowledge/accountKnowledge";
import { MEMORY_QUESTION } from "../server/claire/turn/claireTurn";
import { isBlendedClaireQuestion } from "../server/claire/answerPathTelemetry";

const NOW = new Date("2026-09-15T16:00:00Z");
const TZ = "America/Los_Angeles";

// A small fixture stand-in for the tenant's real commercial accounts.
const ACCOUNTS: AccountRef[] = [
  { id: 1, name: "The Louise", kind: "account" },
  { id: 2, name: "Century Park East", kind: "account" },
] as never;

/** Questions an operator actually asks on a drive, spanning fact and judgment. */
const QUESTIONS = [
  "What was revenue last month?",
  "How many orders did we do last week?",
  "Who are my top customers this quarter?",
  "What's left on the day line today?",
  "What did I finish yesterday?",
  "How many unpaid orders are there?",
  "What happened at The Louise last time?",
  "What did I tell you about The Louise?",
  "What should I say to them about pricing?",
  "What happened at The Louise last time, and what should I do?",
  "How many orders did they place, and is it worth another visit?",
  "Should I push for the full building or start with a pilot floor?",
  "Why do property managers keep stalling on this?",
  "What's a good way to handle the 'we already have a vendor' objection?",
  "Is it worth going back to Century Park East this week?",
  "Remind me what we decided about the Greystar campaign.",
  "What do you think I'm avoiding today?",
];

function claimedBy(question: string): string {
  const lower = normalizeUtterance(question);
  try {
    const parsed = parseBusinessTurn(question, null, NOW, TZ);
    if (parsed.kind !== "not_analytics") return `business_reader (${parsed.kind})`;
  } catch {
    // parse failure degrades to the next matcher, as it does live.
  }
  if (operationsQuestion(lower)) return "day_work";
  if (isUnpaidQuestion(lower) && !/\bfollow[- ]?up\b/.test(lower)) return "unpaid_orders";
  const matched = matchAccounts(lower, ACCOUNTS);
  if (matched.length > 1) return "account_disambiguation";
  if (matched.length === 1 && (isAccountQuestion(lower) || MEMORY_QUESTION.test(lower))) return "account_history";
  if (MEMORY_QUESTION.test(lower)) return "memory_quote";
  return "encyclopedia, else follow_up_model";
}

const rows = QUESTIONS.map(question => ({
  question,
  claimedBy: claimedBy(question),
  blended: isBlendedClaireQuestion(question),
}));

const width = Math.max(...rows.map(row => row.question.length));
for (const row of rows) {
  console.log(
    `${row.question.padEnd(width)}  ${row.blended ? "BLEND " : "      "}${row.claimedBy}`
  );
}

const deterministic = rows.filter(row => !row.claimedBy.startsWith("encyclopedia"));
console.log(
  `\n${deterministic.length}/${rows.length} claimed by a deterministic matcher before the conversational path is reachable.`
);
const blendedTaken = rows.filter(row => row.blended && !row.claimedBy.startsWith("encyclopedia"));
console.log(
  `${blendedTaken.length}/${rows.filter(row => row.blended).length} blended fact+judgment questions are claimed by a fact-only matcher.`
);
