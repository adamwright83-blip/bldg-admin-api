import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * JOYSTICK accounts on real MySQL (drizzle/0165 through scripts/migrate.mjs). Runs only against a local database named
 * first_ten_test, so it can never touch anything that matters:
 *   DATABASE_URL=mysql://root:root@127.0.0.1:3411/first_ten_test node scripts/migrate.mjs
 *   DATABASE_URL=… pnpm vitest run --config vitest.integration.config.ts server/joystickAccount
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/first_ten_test";
  } catch {
    return false;
  }
})();

process.env.JWT_SECRET ||= "first-ten-integration-secret-000000000000";

describe.skipIf(!allowed)("JOYSTICK accounts on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    // the first import loads the whole SaaS store; give it room once, here
    await import("../firstTenMinutes/journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  const identity = (sub: string) => ({ subject: sub, email: `${sub}@acme.example`, name: "Sam Acme", givenName: "Sam" });

  it("creates an account on the first Google sign-in and finds the same one after, keeping Google's latest email", async () => {
    const { signInAccount } = await import("./store");
    const sub = `sub-${randomUUID()}`;
    const first = await signInAccount(identity(sub));
    expect(first.created).toBe(true);
    const again = await signInAccount({ ...identity(sub), email: "renamed@acme.example" });
    expect(again.created).toBe(false);
    expect(again.account.id).toBe(first.account.id);
    const [rows] = (await db.query("SELECT email, session_version FROM joystick_accounts WHERE google_sub = ?", [sub])) as any;
    expect(rows).toEqual([{ email: "renamed@acme.example", session_version: 1 }]);
  });

  it("opens the account's journey with its journey token on any device, never another draft, and never after sign-out", async () => {
    const { signInAccount, linkJourney, latestJourneyFor, revokeAccountSessions, accountForJourney } = await import("./store");
    const { journeyToken } = await import("./session");
    const { startJourney, requireJourney } = await import("../firstTenMinutes/journeys");
    const { account } = await signInAccount(identity(`sub-${randomUUID()}`));
    const mine = await startJourney({ requestId: randomUUID(), kind: "own" });
    const theirs = await startJourney({ requestId: randomUUID(), kind: "own" });
    await linkJourney({ accountId: account.id, journeyId: mine.journey.id, acquisitionSessionId: mine.session.id });
    expect((await latestJourneyFor(account.id))?.journey.id).toBe(mine.journey.id);
    expect((await accountForJourney(mine.journey.id))?.id).toBe(account.id);

    const token = journeyToken({ accountId: account.id, version: account.sessionVersion, sessionId: mine.session.id })!;
    expect((await requireJourney({ sessionId: mine.session.id, resumeToken: token })).journey.id).toBe(mine.journey.id);
    // the draft's own resume token still works too
    expect((await requireJourney(mine.credentials)).journey.id).toBe(mine.journey.id);
    // a token for my draft opens nothing else, and a token made for a draft I don't own opens nothing
    await expect(requireJourney({ sessionId: theirs.session.id, resumeToken: token })).rejects.toThrow();
    const forTheirs = journeyToken({ accountId: account.id, version: account.sessionVersion, sessionId: theirs.session.id })!;
    await expect(requireJourney({ sessionId: theirs.session.id, resumeToken: forTheirs })).rejects.toThrow();

    await revokeAccountSessions(account.id);
    await expect(requireJourney({ sessionId: mine.session.id, resumeToken: token })).rejects.toThrow();
  });

  it("records each funnel step once, for journeys that belong to an account", async () => {
    const { signInAccount, linkJourney, markFunnelStep, accountById } = await import("./store");
    const { startJourney } = await import("../firstTenMinutes/journeys");
    const { account } = await signInAccount(identity(`sub-${randomUUID()}`));
    const started = await startJourney({ requestId: randomUUID(), kind: "own" });
    await linkJourney({ accountId: account.id, journeyId: started.journey.id, acquisitionSessionId: started.session.id });
    const first = new Date("2026-11-02T10:00:00.000Z");
    await markFunnelStep(started.journey.id, "googleConnectedAt", first);
    await markFunnelStep(started.journey.id, "googleConnectedAt", new Date("2026-11-03T10:00:00.000Z"));
    expect((await accountById(account.id))?.googleConnectedAt?.toISOString()).toBe(first.toISOString());
    // a journey with no account records nothing, and doesn't throw
    await expect(markFunnelStep(randomUUID(), "firstLinesAt")).resolves.toBeUndefined();
  });
});
