/**
 * Real-model replays spend Anthropic credit. They run only when someone has
 * explicitly authorized it for this run (CLAIRE_PAID_REPLAY_AUTHORIZED=1, set
 * by the manual CI input or by hand), never because a suite flag is lying
 * around in a shell. 2026-10-16: repeated replays spent about $10 in a session.
 *
 * Approximate cost of one run, Sonnet 4.6 list price, measured from the replays:
 *   workLedger.live.test.ts                    ~45 planner calls   ~$0.60
 *   workLedgerCall.live.integration.test.ts    ~70 model calls     ~$1.10
 *   conversationIntegrity.live.integration.test.ts ~50 model calls ~$0.80
 */
export function paidModelReplayAuthorized(suiteFlag: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (suiteFlag !== "1") return false;
  if (env.CLAIRE_PAID_REPLAY_AUTHORIZED !== "1") {
    console.warn("[PaidReplay] skipped: set CLAIRE_PAID_REPLAY_AUTHORIZED=1 to spend Anthropic credit on this replay");
    return false;
  }
  // `railway run` injects the production service's environment, including the production
  // Anthropic key. Replays must run on the separately capped testing key instead.
  if (Object.keys(env).some(name => name.startsWith("RAILWAY_"))) {
    throw new Error("[PaidReplay] refused: Railway production environment detected. Use the capped testing key (ANTHROPIC_API_KEY=<testing key>) outside `railway run`.");
  }
  if (env.CLAIRE_REPLAY_KEY_IS_TESTING !== "1") {
    throw new Error("[PaidReplay] refused: confirm the key is the capped testing workspace key with CLAIRE_REPLAY_KEY_IS_TESTING=1.");
  }
  return Boolean(env.ANTHROPIC_API_KEY?.trim()) && env.ANTHROPIC_API_KEY !== "verification-transport-stub";
}
