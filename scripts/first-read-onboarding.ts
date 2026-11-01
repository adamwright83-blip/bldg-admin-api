/**
 * The onboarding first read (server/firstTenMinutes/firstRead/firstRead.ts), run exactly as the OAuth callback runs it,
 * against a person's stored Google grant, with nothing written to the database: what it would save is printed.
 * Read-only (coldTest's readOnlyFetch). NOT run by CI.
 *
 *   scripts/first-read-onboarding.sh --journey <own journey id> --i-have-authorization
 */
process.env.POSTHOG_AI_CAPTURE_CONTENT = "0";
delete process.env.POSTHOG_PROJECT_TOKEN;

const args = process.argv.slice(2);
const value = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

async function main() {
  const journeyId = value("--journey");
  if (!journeyId || !args.includes("--i-have-authorization")) throw new Error("pass --journey <id> --i-have-authorization (only with the person's go-ahead)");
  const { coldTestSource, readOnlyFetch } = await import("../server/businessKnowledge/coldTest");
  const { refreshGoogleAccess, googleAccount } = await import("../server/firstTenMinutes/google");
  const { runFirstRead } = await import("../server/firstTenMinutes/firstRead/firstRead");
  const { google } = await coldTestSource(journeyId);
  const startedAt = new Date();
  const tokens = await refreshGoogleAccess({ refreshToken: google.refreshToken! }, { fetch: readOnlyFetch() });
  const account = await googleAccount(tokens.accessToken);
  const access = { ...google, accessToken: tokens.accessToken, accessExpiresAt: tokens.expiresAt, onRefreshed: async () => undefined };
  const saves: Array<Record<string, unknown>> = [];
  const status = await runFirstRead({
    startedAt,
    ownerName: account.name,
    ownerEmail: google.ownerEmail,
    access,
    gemini: { apiKey: process.env.GEMINI_API_KEY!, model: "gemini-3.8-flash", thinking: "low" },
    fetch: readOnlyFetch(),
    save: async patch => void saves.push({ at: Date.now() - startedAt.getTime(), ...patch }),
  });
  for (const s of saves) {
    const { revealJson, publicJson, understandingJson, ...rest } = s as Record<string, unknown> & { revealJson?: { lines: string[] }; publicJson?: { profiles: unknown; findings: unknown[] }; understandingJson?: unknown };
    console.log(`save at ${((s.at as number) / 1000).toFixed(1)} s: ${JSON.stringify({ ...rest, at: undefined })}`);
    if (revealJson) console.log(revealJson.lines.map(l => `  > ${l}`).join("\n"));
    if (understandingJson) console.log("  understanding kept");
    if (publicJson) console.log(`  public kept: profiles ${JSON.stringify(publicJson.profiles)}, ${publicJson.findings.length} findings`);
  }
  console.log(`status ${status}`);
  process.exit(0);
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
