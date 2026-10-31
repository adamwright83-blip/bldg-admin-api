/**
 * Onboarding intelligence: compare investigator models on the same controlled Google accounts.
 *
 *   DATABASE_URL=mysql://root:root@127.0.0.1:3411/first_ten_test npx tsx scripts/onboarding-intelligence-eval.ts [out.md]
 *
 * Runs every investigator that can run here (the deterministic one always; Claude when ANTHROPIC_API_KEY is set;
 * Gemini when GEMINI_API_KEY is set) over the synthetic onboarding scenario told with two different sets of names,
 * through the real research tools, investigation loop, reconciliation and questions, and scores each on the
 * brief's acceptance outcomes plus cost and latency. Local disposable database only: it refuses anything else.
 * Synthetic data only; no real account is read.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const url = new URL(process.env.DATABASE_URL ?? "mysql://invalid");
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error("Refusing: the evaluation writes to the database, and only a local disposable database is allowed.");
  process.exit(1);
}

type Score = Record<string, string | number | boolean>;

async function main() {
  const { fakeAccess, fakeGoogle } = await import("../server/firstTenMinutes/testSupport/fakeGoogle");
  const { BRIEF_NAMES, SCENARIO_NOW, SYNTHETIC_NAMES, onboardingScenario } = await import("../server/firstTenMinutes/testSupport/onboardingScenario");
  const { CoverageLedger } = await import("../server/firstTenMinutes/research/coverage");
  const { googleResearch } = await import("../server/firstTenMinutes/research/googleResearch");
  const { investigate } = await import("../server/businessKnowledge/investigation/loop");
  const { heuristicInvestigator } = await import("../server/businessKnowledge/investigation/heuristic");
  const { claudeInvestigator, geminiInvestigator, withFloor } = await import("../server/businessKnowledge/investigation/models");
  const { readBusinessUnderstanding } = await import("../server/businessKnowledge/understanding");
  const { questions, forgetKnowledge } = await import("../server/businessKnowledge/store");

  const candidates: Array<{ name: string; make: (usage: any, notes: string[]) => any }> = [{ name: "heuristic", make: () => heuristicInvestigator() }];
  if (process.env.ANTHROPIC_API_KEY) candidates.push({ name: "claude+floor", make: (usage, notes) => withFloor(claudeInvestigator(`eval-${randomUUID()}`, usage), usage, notes) });
  if (process.env.GEMINI_API_KEY) candidates.push({ name: "gemini+floor", make: (usage, notes) => withFloor(geminiInvestigator(usage), usage, notes) });

  const rows: Score[] = [];
  for (const candidate of candidates) {
    for (const names of [SYNTHETIC_NAMES, BRIEF_NAMES]) {
      const scope = { journeyId: randomUUID(), tenantId: null };
      const usage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
      const notes: string[] = [];
      const google = fakeGoogle(onboardingScenario(names), { now: SCENARIO_NOW });
      const ledger = new CoverageLedger(() => SCENARIO_NOW);
      const research = googleResearch(fakeAccess(names.owner.email), ledger, { fetch: google.fetch, now: () => SCENARIO_NOW, sleep: async () => undefined });
      const started = Date.now();
      const result = await investigate(scope, { research, ledger, model: candidate.make(usage, notes), ownerEmail: names.owner.email, now: () => SCENARIO_NOW, notes, usage: usage as unknown as Record<string, number> });
      const elapsed = Date.now() - started;
      const u = await readBusinessUnderstanding(scope);
      const asked = await questions(scope);
      const has = (list: { name: string }[], name: string) => list.some(item => item.name === name);
      const collaborator = u.people.find(item => item.name.startsWith(names.collaborator.first));
      rows.push({
        model: candidate.name,
        names: `${names.business}/${names.collaborator.first}`,
        status: result.status,
        "business current": has(u.current, names.business),
        "brand current": has(u.current, names.brand),
        "product prelaunch": has(u.prelaunch, names.product),
        "game part of product": u.relationships.some(item => item.subject === names.game && item.type === "part_of" && item.object === names.product),
        "freelance not current": !u.current.some(item => /website/i.test(item.name)) && [...u.dormant, ...u.unknown].some(item => /website/i.test(item.name)),
        "collaborator found": Boolean(collaborator),
        "collaborator role": collaborator?.role ?? "",
        "relationship asked": asked.some(row => row.kind === "relationship"),
        "no merged entities": !u.relationships.some(item => item.type === "same_legal_entity"),
        "false businesses": [...u.current, ...u.prelaunch].filter(item => ![names.business, names.brand, names.product, names.game].includes(item.name)).map(item => item.name).join(", ") || "none",
        "research questions": result.research.length,
        "tool calls": result.used.toolCalls,
        "google requests": google.calls.length,
        "model calls": usage.calls,
        "model failures": usage.failures,
        "tokens in/out": `${usage.inputTokens}/${usage.outputTokens}`,
        "model latency ms": usage.latencyMs,
        "wall ms": elapsed,
      });
      await forgetKnowledge(scope);
    }
  }

  const keys = Object.keys(rows[0]);
  const table = [`| ${keys.join(" | ")} |`, `| ${keys.map(() => "---").join(" | ")} |`, ...rows.map(row => `| ${keys.map(key => String(row[key])).join(" | ")} |`)].join("\n");
  const skipped = [!process.env.ANTHROPIC_API_KEY ? "Claude (ANTHROPIC_API_KEY not set)" : null, !process.env.GEMINI_API_KEY ? "Gemini (GEMINI_API_KEY not set)" : null].filter(Boolean);
  const report = [
    "# Onboarding investigator comparison",
    "",
    `Run ${new Date().toISOString()} on the synthetic onboarding scenario (two name sets), controlled Google, real MySQL.`,
    skipped.length ? `\nNot run here: ${skipped.join("; ")}.` : "",
    "",
    table,
    "",
  ].join("\n");
  const out = process.argv[2] ?? "tmp/onboarding-intelligence/eval.md";
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, report);
  console.log(report);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
