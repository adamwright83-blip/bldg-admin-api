/**
 * Onboarding intelligence: the real-account acceptance test. NOT run by CI, and never run without the account
 * owner's explicit authorization.
 *
 *   DATABASE_URL=… JWT_SECRET=… npx tsx scripts/onboarding-intelligence-real-account.ts \
 *     --journey <first-ten journey id with a connected Google account> --i-have-authorization [--out tmp/real-account.md]
 *
 * What it does, read-only at Google:
 *  - uses that journey's existing Google connection (the scopes it already has; nothing is requested or changed);
 *  - runs the real investigation into a SEPARATE, throwaway knowledge scope (a new random id), so the journey's own
 *    knowledge, findings, portrait and questions are untouched; the scope is deleted at the end unless --keep;
 *  - writes a report of what it concluded, for the owner to check against what they know: current, preparing,
 *    paused, past, people, how names relate, the questions it would ask, and what it couldn't read.
 *
 * It checks only rules, never answers (no business, person or project is named in this file):
 *  - nothing paused or past is listed as current;
 *  - no two names are made one legal company, and nothing authorises a financial merge;
 *  - no sale or launch is invented for something being prepared (each listed sale cites the owner's own words);
 *  - nothing that looks like a bank, card or identity number is stored;
 *  - every source that couldn't be read completely is listed.
 * Whether the conclusions are RIGHT is for the owner to judge from the report. The report holds names, statuses,
 * dates and source labels: never message bodies or document text.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

async function main() {
  const journeyId = value("--journey");
  if (!journeyId || !flag("--i-have-authorization")) {
    console.error("Refusing: pass --journey <id> and --i-have-authorization (the account owner's explicit authorization to read their Google account for this test).");
    process.exit(2);
  }
  const { journeyById } = await import("../server/firstTenMinutes/store");
  const { googleAccessFor } = await import("../server/firstTenMinutes/understanding/deps");
  const { CoverageLedger } = await import("../server/firstTenMinutes/research/coverage");
  const { googleResearch } = await import("../server/firstTenMinutes/research/googleResearch");
  const { investigate } = await import("../server/businessKnowledge/investigation/loop");
  const { investigatorFor } = await import("../server/businessKnowledge/investigation/models");
  const { readBusinessUnderstanding } = await import("../server/businessKnowledge/understanding");
  const { forgetKnowledge, timeline, liveAssertions } = await import("../server/businessKnowledge/store");
  const { REDACTED } = await import("../server/firstTenMinutes/research/privacy");

  const journey = await journeyById(journeyId);
  if (!journey || journey.kind !== "own") throw new Error("No own journey with that id");
  const access = await googleAccessFor(journey);
  if (!access) throw new Error("That journey has no Google connection");

  const scope = { journeyId: randomUUID(), tenantId: null };
  const ledger = new CoverageLedger();
  const usage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  const notes: string[] = [];
  const { model, configured } = investigatorFor(journey.id, usage, notes);
  const started = Date.now();
  const result = await investigate(scope, { research: googleResearch(access, ledger), ledger, model, ownerEmail: access.ownerEmail, now: () => new Date(), trigger: "real-account acceptance", notes, usage: usage as unknown as Record<string, number> });
  const u = await readBusinessUnderstanding(scope);
  const events = await timeline(scope);
  const live = await liveAssertions(scope);

  const quiet = new Set([...u.dormant, ...u.historical].map(item => item.id));
  const checks = [
    ["nothing paused or past is listed as current", u.current.every(item => !quiet.has(item.id))],
    ["no two names made one legal company by inference", !live.some(row => row.value === "same_legal_entity" && row.basis !== "user_confirmed" && row.basis !== "user_corrected")],
    ["nothing authorises a financial merge", live.every(row => !row.authorizesFinancialMerge)],
    ["no sale or launch on anything being prepared", !events.some(event => (event.kind === "sale" || event.kind === "launch") && u.prelaunch.some(item => item.id === event.entityId))],
    ["no bank, card or identity number stored", !JSON.stringify(u).match(/\b\d{9,19}\b|\b\d{3}-\d{2}-\d{4}\b/)],
  ] as const;
  const line = (item: { name: string; statusWhy: string | null; lastActivityAt: string | null; statusBasis: string | null }) =>
    `- **${item.name}**: ${item.statusWhy ?? ""} ${item.lastActivityAt ? `(last activity ${item.lastActivityAt.slice(0, 10)})` : ""} [${item.statusBasis ?? "?"}]`;
  const report = [
    "# Onboarding intelligence: real-account acceptance",
    "",
    `Run ${new Date().toISOString()} · investigator ${configured} (${model.name}) · ${result.status} after ${result.rounds} rounds, ${result.used.toolCalls} tool calls, ${Math.round((Date.now() - started) / 1000)}s · model calls ${usage.calls} (${usage.failures} failed), tokens ${usage.inputTokens}/${usage.outputTokens}`,
    notes.length ? `\nNotes: ${notes.join("; ")}` : "",
    "",
    "## Rule checks",
    ...checks.map(([name, ok]) => `- ${ok ? "PASS" : "FAIL"}: ${name}`),
    "",
    "## For the owner to judge (is each right?)",
    "### Current", ...u.current.map(line),
    "### Being prepared", ...u.prelaunch.map(line),
    "### Paused (quiet, searched)", ...u.dormant.map(line),
    "### Past", ...u.historical.map(line),
    "### Unknown", ...u.unknown.map(line),
    "### People", ...u.people.map(person => `- **${person.name}**${person.role ? `: ${person.role}` : ""} (sources: ${person.sources.map(source => source.label).join("; ") || "none"})`),
    "### How names relate", ...u.relationships.map(rel => `- ${rel.subject} ${rel.type} ${rel.object} [${rel.basis}, ${rel.confidence}]`),
    "### Questions Claire would ask", ...u.openQuestions.map(question => `- ${question.question}`),
    "### What couldn't be read completely", ...u.coverageGaps.map(gap => `- ${gap.source}: ${gap.state} ${gap.reasons.join("; ")}`),
    "",
    `(Evidence excerpts are kept in the throwaway scope only and are not printed here; ${REDACTED} marks redactions.)`,
  ].join("\n");
  const out = value("--out") ?? "tmp/onboarding-intelligence/real-account.md";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
  console.log(`Report written to ${out}`);
  if (!flag("--keep")) await forgetKnowledge(scope);
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exit(1);
});
