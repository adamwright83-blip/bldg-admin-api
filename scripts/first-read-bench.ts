/**
 * The first-sixty-seconds benchmark (server/businessKnowledge/firstRead/bench.ts) against a person's own connected
 * Google account. NOT run by CI, and never run without the account owner's explicit authorization. Read-only; writes
 * nothing to the database; nothing goes to analytics; the report is readable by you only.
 *
 *   scripts/first-read-bench.sh --journey <own journey id> --i-have-authorization [options]
 *
 *   --variants <list>     fast:separate, fast:combined, agent:separate, agent:combined (default: all four)
 *   --runs <n>            how many times to run each variant, interleaved (default 3, at most 5)
 *   --thinking <level>    low (default), medium, high, or default (the model's own, medium) for the readings
 *   --model <id>          the Gemini model (default gemini-3.8-flash; needs GEMINI_API_KEY). Google limits the 2.5
 *                         models to projects that used them before; production's project hasn't.
 *   --no-judge            skip the judge (then nothing that needs it is stated)
 *   --expect <file>       your Gmail/Drive AI Overview findings, kept outside the repo, graded by meaning:
 *                         {"findings": [{"id": "G1", "from": "gmail", "statement": "…", "expected": "active", "unconfirmed": false}]}
 *   --out-dir <dir>       where reports go (default tmp/first-read-bench, readable by you only)
 *   --input-cents-per-million <n> --output-cents-per-million <n>   the model's price (default: Gemini 3.8 Flash, paid tier, through 2026-12-31)
 *
 * Find the journey id with: scripts/onboarding-cold-test.sh --list
 *
 *   npx tsx scripts/first-read-bench.ts --rerender <report.json>
 *     writes the report again from a saved result with this version's reporting; nothing is read or sent.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Private: nothing from a run reaches analytics.
process.env.POSTHOG_AI_CAPTURE_CONTENT = "0";
delete process.env.POSTHOG_PROJECT_TOKEN;

const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const refuse = (message: string): never => {
  console.error(`Refusing: ${message}`);
  process.exit(2);
};

/** A saved result, with its dates as Dates again. */
function revive(file: string) {
  return JSON.parse(readFileSync(file, "utf8"), (key, value) => ((key === "at" || key === "lastSeen") && typeof value === "string" ? new Date(value) : value));
}

async function main() {
  const saved = value("--rerender");
  if (saved) {
    const { benchReport } = await import("../server/businessKnowledge/firstRead/bench");
    const out = saved.replace(/\.json$/, ".rerendered.md");
    writeFileSync(out, benchReport(revive(saved)), { mode: 0o600 });
    chmodSync(out, 0o600);
    console.log(`Report: ${out}`);
    process.exit(0);
  }
  const journeyId = value("--journey") ?? refuse("--journey <own journey id> is required");
  if (!args.includes("--i-have-authorization")) refuse("this reads a real person's Gmail and Drive. Pass --i-have-authorization only with the account owner's explicit go-ahead.");
  const { VARIANTS, benchReport, runFirstReadBench } = await import("../server/businessKnowledge/firstRead/bench");
  type Variant = (typeof VARIANTS)[number];
  const variants = (value("--variants") ?? VARIANTS.join(",")).split(",").map(v => v.trim()) as Variant[];
  if (!variants.length || variants.some(v => !VARIANTS.includes(v))) refuse(`--variants takes ${VARIANTS.join(", ")}`);
  const runs = Number(value("--runs") ?? 3);
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) refuse("--runs takes 1 to 5");
  const thinking = value("--thinking") ?? "low";
  if (!["low", "medium", "high", "default"].includes(thinking)) refuse("--thinking takes low, medium, high or default");
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || refuse("GEMINI_API_KEY isn't set. Nothing was read.");
  const expectFile = value("--expect");
  const expect = expectFile ? JSON.parse(readFileSync(expectFile, "utf8")) : null;
  if (expect && !Array.isArray(expect.findings)) refuse("--expect needs {\"findings\": [...]}");

  const { coldTestSource } = await import("../server/businessKnowledge/coldTest");
  const { google } = await coldTestSource(journeyId);
  const result = await runFirstReadBench({
    google,
    variants,
    runs,
    geminiKey,
    model: value("--model") ?? "gemini-3.8-flash",
    thinking: thinking === "default" ? undefined : (thinking as "low" | "medium" | "high"),
    judge: !args.includes("--no-judge"),
    expect,
    centsPerMillion: { input: Number(value("--input-cents-per-million") ?? 75), output: Number(value("--output-cents-per-million") ?? 375) },
  });

  const dir = value("--out-dir") ?? "tmp/first-read-bench";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stem = join(dir, `first-read-${result.startedAt.replace(/[:.]/g, "-")}`);
  for (const [file, body] of [[`${stem}.md`, benchReport(result)], [`${stem}.json`, JSON.stringify(result, null, 2)]] as const) {
    writeFileSync(file, body, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  console.log(`auth ${result.authMs} ms; model ${result.model}, thinking ${result.thinking}`);
  for (const run of result.runs) {
    const grade = run.grading ? `, recall ${Math.round(run.grading.recall * 100)}%, status right ${Math.round(run.grading.statusRight * 100)}%` : "";
    console.log(`${run.variant} #${run.run}: first verified ${run.firstVerifiedMs} ms, both sources ${run.allVerifiedMs} ms, ${run.costCents.toFixed(2)}¢${grade}${run.notes.length ? ` — ${run.notes.join("; ")}` : ""}`);
  }
  console.log(`Report: ${stem}.md`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
