/**
 * Onboarding intelligence: cold-start tests against the account owner's real, connected Google account. NOT run by
 * CI, and never run without the account owner's explicit authorization. The operator's guide is "Cold tests against a
 * real account" in docs/goldline/ONBOARDING_INTELLIGENCE.md; scripts/onboarding-cold-test.sh runs
 * this against production from a Railway-linked checkout.
 *
 *   npx tsx scripts/onboarding-intelligence-real-account.ts --journey <own journey id> --i-have-authorization [options]
 *
 *   --mode intelligence     the investigation alone (default): conclusions, Claire's questions, coverage, cost
 *   --mode journey          the whole first ten minutes: the crew's reading, Claire's questions, the portrait, and the
 *                           chapter played to the writing table (a draft is prepared there; nothing is sent)
 *   --investigator claude|gemini|heuristic, --model <id>     the investigator model (default: the server's setting)
 *   --answers ask|skip      journey mode: answer Claire's questions here (default when interactive) or leave them
 *   --intelligence off      journey mode: the first ten minutes without the investigation
 *   --expect <file>         your private expectations, for discoveries, omissions and incorrect conclusions
 *   --runs <n>              n cold tests one after another (1 to 10), each from nothing
 *   --out-dir <dir>         where reports go (default tmp/onboarding-intelligence/runs, readable by you only)
 *   --input-cents-per-million <n> --output-cents-per-million <n>   price the investigator at this rate (e.g. Gemini)
 *   --keep                  keep the test's rows to inspect them (then delete them with --sweep --yes)
 *
 *   npx tsx scripts/onboarding-intelligence-real-account.ts --list
 *     the own journeys with Google connected (id, account, stage, workspace), to find the one to test. Reads only.
 *
 *   npx tsx scripts/onboarding-intelligence-real-account.ts --sweep [--yes]
 *     lists, and with --yes deletes, rows left by a test that was killed or kept. Only cold-test ids are touched.
 *
 * Each run reads Google read-only into a throwaway test journey ("coldtest-…") that starts from nothing, and deletes
 * exactly what it wrote. Of the person's own journey only its connection is used: its knowledge, findings, answers and
 * portrait, and their workspace, are never read or written. See server/businessKnowledge/coldTest.ts.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

// Private: nothing from a test run reaches analytics (no prompts or replies captured, no PostHog client at all).
process.env.POSTHOG_AI_CAPTURE_CONTENT = "0";
delete process.env.POSTHOG_PROJECT_TOKEN;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const refuse = (message: string): never => {
  console.error(`Refusing: ${message}`);
  process.exit(2);
};

async function sweep() {
  const { forgetColdTest, leftoverColdTests } = await import("../server/businessKnowledge/coldTest");
  const ids = await leftoverColdTests();
  if (!ids.length) return console.log("No cold-test rows are left.");
  console.log(`Rows left by ${ids.length} cold test(s): ${ids.join(", ")}`);
  if (!flag("--yes")) return console.log("Run again with --yes to delete them. Only these cold-test ids are touched.");
  for (const id of ids) {
    const { deleted } = await forgetColdTest(id);
    console.log(`Deleted ${id}: ${Object.values(deleted).reduce((sum, n) => sum + n, 0)} rows; none left.`);
  }
}

/** Own journeys with a connected Google account: the ones a cold test can read. Nothing is written. */
async function listJourneys() {
  const { and, desc, eq } = await import("drizzle-orm");
  const { firstTenDb } = await import("../server/firstTenMinutes/store");
  const { firstTenConnections, firstTenJourneys } = await import("../server/firstTenMinutes/schema");
  const db = await firstTenDb();
  const rows = await db
    .select({ id: firstTenJourneys.id, stage: firstTenJourneys.stage, tenantId: firstTenJourneys.tenantId, createdAt: firstTenJourneys.createdAt, account: firstTenConnections.accountLabel })
    .from(firstTenJourneys)
    .innerJoin(firstTenConnections, and(eq(firstTenConnections.journeyId, firstTenJourneys.id), eq(firstTenConnections.provider, "google"), eq(firstTenConnections.status, "connected")))
    .where(eq(firstTenJourneys.kind, "own"))
    .orderBy(desc(firstTenJourneys.createdAt));
  if (!rows.length) return console.log("No own journey has Google connected.");
  for (const row of rows) {
    console.log(`${row.id}  ${row.account ?? "(no account label)"}  stage ${row.stage}  ${row.tenantId ? "workspace" : "no workspace yet"}  started ${row.createdAt.toISOString().slice(0, 10)}`);
  }
}

async function main() {
  if (flag("--list")) return listJourneys();
  if (flag("--sweep")) return sweep();

  const journeyId = value("--journey");
  if (!journeyId || !flag("--i-have-authorization")) {
    refuse("pass --journey <id> and --i-have-authorization (the account owner's explicit authorization to read their Google account for this test).");
  }
  const mode = value("--mode") ?? "intelligence";
  if (mode !== "intelligence" && mode !== "journey") refuse("--mode is intelligence or journey");
  const investigator = value("--investigator");
  if (investigator && !["claude", "gemini", "heuristic"].includes(investigator)) refuse("--investigator is claude, gemini or heuristic");
  const runs = Number(value("--runs") ?? 1);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) refuse("--runs is a whole number from 1 to 10");
  const answers = value("--answers") ?? (process.stdin.isTTY ? "ask" : "skip");
  if (answers !== "ask" && answers !== "skip") refuse("--answers is ask or skip");
  const priceIn = value("--input-cents-per-million");
  const priceOut = value("--output-cents-per-million");
  const price = priceIn || priceOut ? { input: Number(priceIn), output: Number(priceOut) } : null;
  if (price && !(price.input >= 0 && price.output >= 0)) refuse("pass both --input-cents-per-million and --output-cents-per-million as numbers");
  const outDir = value("--out-dir") ?? "tmp/onboarding-intelligence/runs";

  const harness = await import("../server/businessKnowledge/coldTest");
  const report = await import("../server/businessKnowledge/coldTestReport");
  const expectPath = value("--expect");
  const expectations = expectPath ? report.parseExpectations(JSON.parse(readFileSync(expectPath, "utf8"))) : null;
  const source = await harness.coldTestSource(journeyId!);
  const choice = { investigator: investigator as "claude" | "gemini" | "heuristic" | undefined, model: value("--model") };

  const prompt = answers === "ask" ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const answer = async (question: { question: string; followUp: string | null }) => {
    if (!prompt) return null;
    console.log(`\nClaire asks: ${question.followUp ?? question.question}`);
    const text = (await prompt.question("Your answer (Enter to leave it): ")).trim();
    return text || null;
  };

  let broken = false;
  for (let run = 1; run <= runs; run += 1) {
    console.log(`Cold test ${run} of ${runs} (${mode}), reading ${source.journey.id}'s connected accounts read-only…`);
    const raw =
      mode === "journey"
        ? await harness.runJourneyColdTest({ source, choice, keep: flag("--keep"), intelligence: value("--intelligence") !== "off", answer })
        : await harness.runIntelligenceColdTest({ source, choice, keep: flag("--keep") });
    const outcome = price ? report.repriced(raw, price) : raw;
    const before = report.previousOutcome(outDir, outcome);
    const page = report.renderColdTestReport(outcome, expectations ? report.compareWithExpectations(outcome, expectations) : null, before ? report.compareWithPrevious(outcome, before) : null);
    const files = report.writeColdTestReport(outDir, outcome, page);
    const failed = outcome.checks.filter(check => !check.ok);
    broken ||= failed.length > 0;
    console.log(
      `Test ${outcome.id}: ${"kept" in outcome.cleanup ? "kept (delete with --sweep --yes)" : "started from nothing, cleaned up, none left"}; ` +
        `about $${(outcome.usage.totalCostCents / 100).toFixed(2)}; ${failed.length ? `${failed.length} rule check(s) FAILED` : "rule checks passed"}.\nReport: ${files.markdown}`
    );
  }
  prompt?.close();
  process.exit(broken ? 1 : 0);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error instanceof Error ? error.message : "failed");
    process.exit(1);
  });
