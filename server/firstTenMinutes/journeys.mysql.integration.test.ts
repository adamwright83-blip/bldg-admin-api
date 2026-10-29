import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The first-ten journey and its connections on real MySQL (drizzle/0152 through scripts/migrate.mjs).
 * Runs only against a local database named first_ten_test, so it can never touch anything that matters:
 *   DATABASE_URL=mysql://root:root@127.0.0.1:3411/first_ten_test node scripts/migrate.mjs
 *   DATABASE_URL=… pnpm vitest run --config vitest.integration.config.ts server/firstTenMinutes
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
// Revokes go to a closed local port: best effort, and nothing real is called.
process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = "http://127.0.0.1:9";

const GMAIL = "https://www.googleapis.com/auth/gmail.readonly";
const CALENDAR = "https://www.googleapis.com/auth/calendar.readonly";

describe.skipIf(!allowed)("first-ten journeys on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    // The first import loads the whole SaaS store; give it room once, here.
    await import("./journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  it("starts a first-ten draft and journey, and resumes only with that draft's token", async () => {
    const { startJourney, requireJourney, journeyView } = await import("./journeys");
    const started = await startJourney({ requestId: randomUUID(), kind: "own" });
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      "SELECT onboardingMode, currentStep, status FROM dayforge_saas_onboarding_sessions WHERE id = ?", // legacy signup-draft table
      [started.credentials.sessionId]
    );
    expect(rows[0]).toMatchObject({ onboardingMode: "joystick_first_ten", currentStep: "first_ten", status: "draft" });
    expect(started.journey).toMatchObject({ kind: "own", stage: "connect", tenantId: null });

    const resumed = await requireJourney(started.credentials);
    expect(resumed.journey.id).toBe(started.journey.id);
    const view = await journeyView(resumed.journey, resumed.session);
    expect(view).toMatchObject({ id: started.journey.id, kind: "own", stage: "connect", connections: [] });

    await expect(requireJourney({ ...started.credentials, resumeToken: "x".repeat(43) })).rejects.toThrow(/expired/);
  });

  it("refuses today's funnel's drafts", async () => {
    const { startJoystickOnboardingDraft } = await import("../saas/saasStore");
    const { requireJourney } = await import("./journeys");
    const today = await startJoystickOnboardingDraft({ requestId: randomUUID() });
    await expect(
      requireJourney({ sessionId: today.session.id, resumeToken: today.resumeToken! })
    ).rejects.toThrow(/different signup/);
  });

  it("stores access encrypted, reads it back, reconnects cleanly, and forgets it on disconnect", async () => {
    const { startJourney, requireJourney, journeyView, disconnectProvider } = await import("./journeys");
    const { saveConnection, connectionSecrets } = await import("./store");
    const started = await startJourney({ requestId: randomUUID(), kind: "own" });
    const journeyId = started.journey.id;

    await saveConnection({
      journeyId,
      provider: "google",
      accountLabel: "nina@wildrootflowers.example",
      accountSubject: "sub-123",
      grantedScopes: ["openid", GMAIL, CALENDAR],
      accessToken: "ya29.plain-access-token",
      refreshToken: "1//plain-refresh-token",
      accessExpiresAt: new Date(Date.now() + 3600_000),
    });
    const [stored] = await db.query<mysql.RowDataPacket[]>(
      "SELECT encrypted_access_token, encrypted_refresh_token, status FROM first_ten_connections WHERE journey_id = ?",
      [journeyId]
    );
    expect(stored[0].status).toBe("connected");
    expect(stored[0].encrypted_access_token).not.toContain("plain");
    expect(stored[0].encrypted_refresh_token).not.toContain("plain");

    const secrets = await connectionSecrets(journeyId, "google");
    expect(secrets).toMatchObject({ accessToken: "ya29.plain-access-token", refreshToken: "1//plain-refresh-token" });

    const { session, journey } = await requireJourney(started.credentials);
    expect((await journeyView(journey, session)).connections).toEqual([
      expect.objectContaining({ provider: "google", account: "nina@wildrootflowers.example", products: ["gmail", "calendar"] }),
    ]);

    // Google sends no refresh token on a reconnect without fresh consent: nothing stale survives.
    await saveConnection({
      journeyId,
      provider: "google",
      accountLabel: "nina@wildrootflowers.example",
      accountSubject: "sub-123",
      grantedScopes: ["openid", GMAIL],
      accessToken: "ya29.second",
      refreshToken: null,
      accessExpiresAt: null,
    });
    const after = await connectionSecrets(journeyId, "google");
    expect(after).toMatchObject({ accessToken: "ya29.second", refreshToken: null });
    const [count] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM first_ten_connections WHERE journey_id = ?", [journeyId]);
    expect(Number(count[0].n)).toBe(1);

    await disconnectProvider(journey, "google");
    expect(await connectionSecrets(journeyId, "google")).toBeNull();
    const [gone] = await db.query<mysql.RowDataPacket[]>(
      "SELECT encrypted_access_token, encrypted_refresh_token, status FROM first_ten_connections WHERE journey_id = ?",
      [journeyId]
    );
    expect(gone[0]).toMatchObject({ encrypted_access_token: null, encrypted_refresh_token: null, status: "disconnected" });
    expect((await journeyView(journey, session)).connections).toEqual([]);
  });

  it("shows the example's invented account and keeps the stage it is moved to", async () => {
    const { startJourney, requireJourney, journeyView, moveJourney } = await import("./journeys");
    const started = await startJourney({ requestId: randomUUID(), kind: "example" });
    await moveJourney(started.journey, "understanding");
    const { session, journey } = await requireJourney(started.credentials);
    const view = await journeyView(journey, session);
    expect(view.kind).toBe("example");
    expect(view.stage).toBe("understanding");
    expect(view.connections[0].account).toMatch(/\.example$/);
  });
});
