import { accountById, accountOwnsDraft } from "./store";
import { isJourneyToken, readJourneyToken } from "./session";

export { isJourneyToken };

/**
 * Whether an account journey token (session.ts) opens this draft: signed for this draft, by an account whose sessions
 * haven't been revoked since, which owns the draft's journey.
 */
export async function journeyTokenOpensDraft(sessionId: string, token: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const claim = readJourneyToken(token, sessionId, env);
  if (!claim) return false;
  const account = await accountById(claim.accountId);
  if (!account || account.sessionVersion !== claim.version) return false;
  return accountOwnsDraft(account.id, sessionId);
}
