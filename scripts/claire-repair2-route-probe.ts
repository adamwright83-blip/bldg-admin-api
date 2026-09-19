/**
 * Claire Intelligence Repair Part 2 — static route probe.
 *
 * Slice A: which matcher in the old first-match-wins ladder claims each
 * question, and therefore whether the repaired conversational path could
 * ever be reached.
 *
 * Slice C+D: the same seventeen questions, routed by the actual, unchanged
 * `classifyClaireAnswerClass` from `answerPathTelemetry.ts` and the same
 * evidence-gathering order `gatherDeterministicEvidence` uses in
 * `claireTurn.ts` (business_reader → day_work → unpaid_orders →
 * account_history). Every function used here is the real one imported from
 * the code that routes live turns — not a re-implementation. Nothing here
 * needs a database; both columns can be reproduced with:
 *
 *   npx tsx scripts/claire-repair2-route-probe.ts
 */
import { parseBusinessTurn } from "../server/claire/businessConversation";
import { normalizeUtterance } from "../server/claire/business/businessLanguage";
import { operationsQuestion } from "../server/claire/knowledge/operationsKnowledge";
import { isUnpaidQuestion } from "../server/claire/knowledge/openOrdersKnowledge";
import { isAccountQuestion, matchAccounts, type AccountRef } from "../server/claire/knowledge/accountKnowledge";
import { MEMORY_QUESTION } from "../server/claire/turn/claireTurn";
import { classifyClaireAnswerClass, isBlendedClaireQuestion } from "../server/claire/answerPathTelemetry";

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

/** BEFORE (Slice A): the old first-match-wins ladder, unconditional. */
function claimedByBefore(question: string): string {
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
  return "encyclopedia, else follow_up_model (often a refusal — old zero-tool bug)";
}

/** The same evidence order `gatherDeterministicEvidence` in claireTurn.ts uses. */
function firstEvidenceSource(question: string): string | null {
  const lower = normalizeUtterance(question);
  try {
    const parsed = parseBusinessTurn(question, null, NOW, TZ);
    if (parsed.kind !== "not_analytics") return `business_reader (${parsed.kind})`;
  } catch {
    // Same degrade as live: no evidence from this source.
  }
  if (operationsQuestion(lower)) return "day_work";
  if (isUnpaidQuestion(lower) && !/\bfollow[- ]?up\b/.test(lower)) return "unpaid_orders";
  const matched = matchAccounts(lower, ACCOUNTS);
  const target = matched.length === 1 ? matched[0] : null;
  if (target && isAccountQuestion(lower)) return "account_history";
  return null;
}

/** AFTER (Slice C+D): the router's actual answer-class gate. */
function claimedByAfter(question: string): string {
  const answerClass = classifyClaireAnswerClass(question);
  if (answerClass === "judgment") {
    // Item D5: never gated on a DB tool. No evidence attempted at all.
    return "follow_up_model (synthesis, no retrieval attempted)";
  }
  if (answerClass === "blended") {
    const evidence = firstEvidenceSource(question);
    return evidence
      ? `follow_up_model (synthesis, evidence: ${evidence})`
      : "follow_up_model (synthesis, no evidence found)";
  }
  // fact_only: unchanged from the old ladder.
  return claimedByBefore(question);
}

const rows = QUESTIONS.map(question => ({
  question,
  blended: isBlendedClaireQuestion(question),
  before: claimedByBefore(question),
  after: claimedByAfter(question),
}));

const width = Math.max(...rows.map(row => row.question.length));
console.log(`${"QUESTION".padEnd(width)}  ${"".padEnd(6)}BEFORE (Slice A)                                          AFTER (Slice C+D)`);
for (const row of rows) {
  console.log(
    `${row.question.padEnd(width)}  ${row.blended ? "BLEND " : "      "}${row.before.padEnd(58)} ${row.after}`
  );
}

const deterministicBefore = rows.filter(row => !row.before.startsWith("encyclopedia"));
console.log(
  `\nBEFORE: ${deterministicBefore.length}/${rows.length} claimed by a deterministic matcher before the conversational path was reachable.`
);
const changed = rows.filter(row => row.before !== row.after);
console.log(`AFTER:  ${changed.length}/${rows.length} questions route differently under the architecture fix.`);
const stillDeterministicAfter = rows.filter(row => !row.after.includes("follow_up_model"));
console.log(`AFTER:  ${stillDeterministicAfter.length}/${rows.length} still terminate deterministically (item F — fast path preserved for fact-only questions).`);

const blendedRows = rows.filter(row => row.blended);
const blendedPreservedAfter = blendedRows.filter(row => row.after.includes("follow_up_model"));
console.log(
  `\nBefore: ${blendedRows.filter(row => !row.before.startsWith("encyclopedia")).length}/${blendedRows.length} blended fact+judgment questions were claimed by a fact-only matcher (judgment half lost).`
);
console.log(`After:  ${blendedPreservedAfter.length}/${blendedRows.length} blended questions now reach Claire's synthesis with the full utterance and gathered evidence.`);

console.log("\nThe two previously-broken blended probes, verbatim:");
for (const row of blendedRows) {
  console.log(`  "${row.question}"`);
  console.log(`    before: ${row.before}`);
  console.log(`    after:  ${row.after}`);
}
