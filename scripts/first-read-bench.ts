/**
 * The first-sixty-seconds benchmark (server/businessKnowledge/firstRead/bench.ts) against a person's own connected
 * Google account. NOT run by CI, and never run without the account owner's explicit authorization. Read-only; writes
 * nothing to the database; nothing goes to analytics; the report is readable by you only.
 *
 *   scripts/first-read-bench.sh --journey <own journey id> --i-have-authorization [options]
 *
 *   --paths rest|mcp      rest (default): JOYSTICK's own Gmail/Drive readers; mcp: Google's search_corpus (preview only)
 *   --strategies <list>   for rest: fast, agent, survey (default fast,agent,survey; survey is the 24-month comparison)
 *   --model <id>          the Gemini model (default gemini-3.8-flash; needs GEMINI_API_KEY. gemini-2.5-flash is closed to new users)
 *   --no-judge            skip the second model call that checks each claim against its quotes
 *   --expect <file>       your Gmail/Drive AI Overview results as expectations, kept outside the repo:
 *                         {"current": ["Name|Alias"], "past": [...], "people": [...], "mention": [...]}
 *   --out-dir <dir>       where reports go (default tmp/first-read-bench, readable by you only)
 *   --input-cents-per-million <n> --output-cents-per-million <n>   the model's price (default: Gemini 3.8 Flash, paid tier, through 2026-12-31)
 *
 * Find the journey id with: scripts/onboarding-cold-test.sh --list
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

async function main() {
  const journeyId = value("--journey") ?? refuse("--journey <own journey id> is required");
  if (!args.includes("--i-have-authorization")) refuse("this reads a real person's Gmail and Drive. Pass --i-have-authorization only with the account owner's explicit go-ahead.");
  const { STRATEGIES, benchReport, runFirstReadBench } = await import("../server/businessKnowledge/firstRead/bench");
  type Strategy = (typeof STRATEGIES)[number];
  const path = value("--paths") ?? "rest";
  if (path !== "rest" && path !== "mcp") refuse("--paths takes rest or mcp");
  const strategies = (path === "mcp" ? ["mcp"] : (value("--strategies") ?? "fast,agent,survey").split(",").map(s => s.trim())) as Strategy[];
  if (!strategies.length || strategies.some(s => !STRATEGIES.includes(s) || (path === "rest" && s === "mcp"))) refuse("--strategies takes fast, agent and survey");
  const geminiKey = process.env.GEMINI_API_KEY?.trim() || refuse("GEMINI_API_KEY isn't set. Nothing was read.");
  const expectFile = value("--expect");
  const expect = expectFile ? JSON.parse(readFileSync(expectFile, "utf8")) : null;

  const { coldTestSource } = await import("../server/businessKnowledge/coldTest");
  const { google } = await coldTestSource(journeyId);
  const result = await runFirstReadBench({
    google,
    strategies,
    geminiKey,
    model: value("--model") ?? "gemini-3.8-flash",
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
  console.log(`auth ${result.authMs} ms`);
  for (const run of result.runs) {
    const requests = Object.entries(run.requests).map(([kind, n]) => `${kind} ${n}`).join(", ");
    console.log(`${run.strategy}: first draft ${run.firstResultMs} ms, all verified ${run.totalMs} ms, ${run.costCents.toFixed(2)}¢ — Google requests: ${requests}`);
  }
  console.log(`Report: ${stem}.md`);
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
