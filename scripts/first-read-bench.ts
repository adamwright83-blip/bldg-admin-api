/**
 * The first-sixty-seconds benchmark (server/businessKnowledge/firstRead/bench.ts) against a person's own connected
 * Google account. NOT run by CI, and never run without the account owner's explicit authorization. Read-only; writes
 * nothing to the database; the report is readable by you only.
 *
 *   scripts/first-read-bench.sh --journey <own journey id> --i-have-authorization [options]
 *
 *   --paths rest,mcp      which retrieval paths to time (default both): JOYSTICK's REST readers, Google's search_corpus
 *   --model <id>          the Gemini model (default gemini-2.5-flash; needs GEMINI_API_KEY)
 *   --expect <file>       private expectations, kept outside the repo: {"mention": ["Name|Alias"], "notCurrent": ["Old thing"]}
 *   --out-dir <dir>       where reports go (default tmp/first-read-bench, readable by you only)
 *   --input-cents-per-million <n> --output-cents-per-million <n>   the model's price (default: Gemini 2.5 Flash list price)
 *
 * Find the journey id with: scripts/onboarding-cold-test.sh --list
 *
 *   scripts/first-read-bench.sh --consent --i-have-authorization [options]
 *
 * --consent uses a separate OAuth client instead of a stored connection: FIRST_READ_PROBE_CLIENT_ID and
 * FIRST_READ_PROBE_CLIENT_SECRET (a Web client marked "Use this client for an AI-powered agent", with redirect URI
 * http://127.0.0.1:8737/callback). You sign in once in your browser; the token stays in memory and is revoked at the end.
 * JOYSTICK's own client and stored connections are not touched.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import type { GoogleAccess } from "../server/firstTenMinutes/understanding/googleReaders";

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

const PROBE_REDIRECT = "http://127.0.0.1:8737/callback";

/** One sign-in on the separate probe client, through a loopback redirect. Read scopes only; nothing is stored. */
async function consentAccess(env: NodeJS.ProcessEnv): Promise<GoogleAccess> {
  const { exchangeGoogleCode, googleAccount, googleAuthorizationUrl } = await import("../server/firstTenMinutes/google");
  const state = crypto.randomUUID();
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", PROBE_REDIRECT);
      if (url.pathname !== "/callback") return void response.writeHead(404).end();
      response.end("Signed in. You can close this tab.");
      server.close();
      if (url.searchParams.get("state") !== state) return reject(new Error("State mismatch: sign-in refused"));
      const value = url.searchParams.get("code");
      return value ? resolve(value) : reject(new Error(`Google refused: ${url.searchParams.get("error") ?? "no code"}`));
    }).listen(8737, "127.0.0.1");
    console.log(`Open this in the browser signed in to the account to test:\n\n${googleAuthorizationUrl({ state, redirectUri: PROBE_REDIRECT }, env)}\n`);
  });
  const tokens = await exchangeGoogleCode({ code, redirectUri: PROBE_REDIRECT }, { env });
  const account = await googleAccount(tokens.accessToken);
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessExpiresAt: tokens.expiresAt,
    grantedScopes: tokens.grantedScopes,
    ownerEmail: account.email,
    onRefreshed: async () => undefined,
  };
}

async function main() {
  const consent = args.includes("--consent");
  const journeyId = consent ? null : (value("--journey") ?? refuse("--journey <own journey id> (or --consent) is required"));
  if (!args.includes("--i-have-authorization")) refuse("this reads a real person's Gmail and Drive. Pass --i-have-authorization only with the account owner's explicit go-ahead.");
  const paths = (value("--paths") ?? "rest,mcp").split(",").map(path => path.trim()) as Array<"rest" | "mcp">;
  if (!paths.length || paths.some(path => path !== "rest" && path !== "mcp")) refuse("--paths takes rest, mcp or rest,mcp");
  const geminiKey = process.env.GEMINI_API_KEY?.trim() ?? refuse("GEMINI_API_KEY isn't set. Nothing was read.");
  const expectFile = value("--expect");
  const expect = expectFile ? JSON.parse(readFileSync(expectFile, "utf8")) : null;

  const { benchReport, runFirstReadBench } = await import("../server/businessKnowledge/firstRead/bench");
  let env = process.env;
  let google: GoogleAccess;
  if (consent) {
    const id = process.env.FIRST_READ_PROBE_CLIENT_ID?.trim() ?? refuse("FIRST_READ_PROBE_CLIENT_ID isn't set");
    const secret = process.env.FIRST_READ_PROBE_CLIENT_SECRET?.trim() ?? refuse("FIRST_READ_PROBE_CLIENT_SECRET isn't set");
    // googleAuthorizationUrl asks for JOYSTICK's read scopes (gmail, calendar, drive): the scopes search_corpus honours.
    env = { ...process.env, JOYSTICK_GOOGLE_CLIENT_ID: id, JOYSTICK_GOOGLE_CLIENT_SECRET: secret };
    google = await consentAccess(env);
  } else {
    const { coldTestSource } = await import("../server/businessKnowledge/coldTest");
    google = (await coldTestSource(journeyId!)).google;
  }
  const result = await runFirstReadBench({
    google,
    env,
    paths,
    geminiKey: geminiKey!,
    model: value("--model") ?? "gemini-2.5-flash",
    expect,
    centsPerMillion: { input: Number(value("--input-cents-per-million") ?? 30), output: Number(value("--output-cents-per-million") ?? 250) },
  });

  const dir = value("--out-dir") ?? "tmp/first-read-bench";
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stem = join(dir, `first-read-${result.startedAt.replace(/[:.]/g, "-")}`);
  for (const [file, body] of [[`${stem}.md`, benchReport(result)], [`${stem}.json`, JSON.stringify(result, null, 2)]] as const) {
    writeFileSync(file, body, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  for (const run of result.runs) {
    const mcp = run.mcp?.map(search => (search.ok ? `${search.hits.length} hits in ${search.latencyMs} ms` : `refused ${search.status}: ${search.error}`)).join(" | ");
    console.log(`${run.path}: Gmail ready ${run.readyMs.gmail} ms, Drive ready ${run.readyMs.drive} ms, both ${run.totalMs} ms${mcp ? ` — ${mcp}` : ""}`);
  }
  console.log(`auth ${result.authMs} ms; model cost ${result.costCents.toFixed(2)}¢. Report: ${stem}.md`);
  if (consent && google.refreshToken) {
    const { revokeGoogleToken } = await import("../server/firstTenMinutes/google");
    console.log((await revokeGoogleToken(google.refreshToken)) ? "The probe's grant was revoked." : "Revoke failed: remove it at myaccount.google.com/permissions.");
  }
  process.exit(0);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
