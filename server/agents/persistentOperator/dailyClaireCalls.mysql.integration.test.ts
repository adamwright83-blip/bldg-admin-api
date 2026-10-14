/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/* Real MySQL, real appointment store, worker, action policy and dispatch fences.
 * Controlled phone provider only: no real outbound call is placed. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveCanonicalOperatorIdentity, type CanonicalOperatorIdentity } from "./identity";
import { OperatorAppointmentStore } from "./operatorAppointmentStore";
import { OperatorAppointmentWorker } from "./operatorAppointmentWorker";
import { ensureDailyClaireAppointments, grantDailyClaireCall, revokeDailyClaireCall } from "./dailyCallAuthorization";
import { grantStrategicCallAuthorization } from "./strategicCallAuthorization";
import { evaluatePersistentActionPolicy } from "./actionPolicy";
import { DAILY_CLAIRE_CALLS } from "../../../shared/dailyClaireCalls";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../../shared/saasTenant";

const provider = vi.hoisted(() => ({ calls: [] as Array<{ to: string }>, fail: false }));
vi.mock("../../twilioPlatform/claireCallProvider", () => ({
  placeClaireOutboundCall: async (request: { to: string; from: string }) => {
    if (request.to !== "+15555550111") throw new Error("Controlled provider refuses any non-test phone");
    if (provider.fail) throw new Error("Controlled provider failure");
    provider.calls.push(request);
    return { callSid: `CA${randomUUID().replaceAll("-", "")}` };
  },
}));

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";
// Monday Oct 12 2026: 08:00 PDT and 18:00 PDT.
const MONDAY_MORNING = new Date("2026-10-12T15:00:00Z");
const MONDAY_EVENING = new Date("2026-10-13T01:00:00Z");
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

describeMysql("daily Claire calls: four independent authorities", () => {
  let sql: mysql.Connection;
  let pool: mysql.Pool;
  let store: OperatorAppointmentStore;
  const phones: Record<string, string> = {};

  async function operatorTenant(label: string) {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `daily-${label}-${suffix}`;
    const operator = `daily-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Daily test", "Daily test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, operator, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, operator]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    phones[operator] = "+15555550111";
    process.env.CLAIRE_OPERATOR_PHONES = JSON.stringify(phones);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operator }, subsystem: "daily_acceptance" });
    if (!resolved.ok) throw new Error("identity");
    return { tenantId, operator, identity: resolved.identity };
  }
  const grant = (identity: CanonicalOperatorIdentity, purpose: "morning_readiness" | "evening_debrief", start: string, end: string) =>
    grantDailyClaireCall({ identity, purpose, weekdays: ALL_DAYS, localStart: start, localEnd: end, timeZone: zone, sourceReference: `authenticated_app:${randomUUID()}` });
  // Daily kinds only: the worker also seeds the separate Sunday-planning appointment.
  const appointments = async (tenantId: string) =>
    (await sql.execute<mysql.RowDataPacket[]>("SELECT * FROM operator_appointments WHERE tenantId = ? AND appointmentKind IN ('daily_morning_readiness','daily_evening_debrief') ORDER BY scheduledFor", [tenantId]))[0];
  async function runWorkerFor(ms: number, now: Date) {
    const worker = new OperatorAppointmentWorker(store, { leaseOwner: `daily-${randomUUID()}`, leaseMs: 30_000, pollMs: 50, concurrency: 1, retryBaseMs: 50, now: () => now });
    worker.start();
    await new Promise(r => setTimeout(r, ms));
    await worker.stop();
  }
  async function runWorkerUntilSettled(tenantId: string, now: Date) {
    const worker = new OperatorAppointmentWorker(store, { leaseOwner: `daily-${randomUUID()}`, leaseMs: 30_000, pollMs: 50, concurrency: 1, retryBaseMs: 50, now: () => now });
    worker.start();
    const end = Date.now() + 25_000;
    try {
      while (Date.now() < end) {
        const rows = await appointments(tenantId);
        if (rows.length && rows.every(r => ["completed", "dead_letter", "cancelled", "missed"].includes(r.status))) break;
        await new Promise(r => setTimeout(r, 100));
      }
    } finally {
      await worker.stop();
    }
    return appointments(tenantId);
  }

  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    pool = mysql.createPool(process.env.DATABASE_URL!);
    store = new OperatorAppointmentStore(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await sql?.end();
  });

  it("morning grant alone schedules and places only the morning call, even with nothing to approve", async () => {
    const { tenantId, identity } = await operatorTenant("morning");
    await grant(identity, "morning_readiness", "07:30", "09:00");
    const rows = await runWorkerUntilSettled(tenantId, MONDAY_MORNING);
    expect(rows.map(r => r.appointmentKind)).toEqual(["daily_morning_readiness"]);
    expect(rows[0]).toMatchObject({ status: "completed" });
    expect(rows[0]!.callSid).toBeTruthy();
    // No strategic proposal and an empty Day Line did not block it; the conversation carries the briefing.
    const [state] = (await sql.execute<mysql.RowDataPacket[]>("SELECT stateJson FROM claire_conversation_states WHERE tenantId = ? AND id LIKE 'claire-call:%' ORDER BY createdAt DESC LIMIT 1", [tenantId]))[0];
    const conv = typeof state!.stateJson === "string" ? JSON.parse(state!.stateJson) : state!.stateJson;
    expect(conv.sessionKind).toBe("morning_readiness");
    expect(conv.showrunner.briefing.businessDate).toBe("2026-10-12");
    expect(conv.history[0].text).toMatch(/Good morning, it's Claire\..*Are you ready to get going\?$/);
  }, 60_000);

  it("evening grant alone places only the evening call, with no unfinished missions", async () => {
    const { tenantId, identity } = await operatorTenant("evening");
    await grant(identity, "evening_debrief", "17:30", "19:00");
    // At 8 AM the evening appointment exists, scheduled for its window, and is not placed.
    await runWorkerFor(1500, MONDAY_MORNING);
    const morning = await appointments(tenantId);
    expect(morning.map(r => [r.appointmentKind, r.status, r.callSid])).toEqual([["daily_evening_debrief", "scheduled", null]]);
    expect(new Date(morning[0]!.scheduledFor).toISOString()).toBe("2026-10-13T00:30:00.000Z");
    const rows = await runWorkerUntilSettled(tenantId, MONDAY_EVENING);
    expect(rows.map(r => r.appointmentKind)).toEqual(["daily_evening_debrief"]);
    expect(rows[0]).toMatchObject({ status: "completed" });
  }, 60_000);

  it("existing strategic and Sunday permissions authorize neither daily call", async () => {
    const { tenantId, identity, operator } = await operatorTenant("strategy");
    const strategic = await grantStrategicCallAuthorization({ identity, weekdays: [1, 2, 3, 4, 5], localStart: "07:00", localEnd: "20:00", timeZone: zone, dailyLimit: 1, sourceReference: `authenticated_app:${randomUUID()}` });
    await ensureDailyClaireAppointments({ store, now: MONDAY_MORNING, tenantId });
    expect(await appointments(tenantId)).toEqual([]);
    for (const purpose of ["morning_readiness", "evening_debrief"] as const) {
      const policy = await evaluatePersistentActionPolicy({
        tenantId, canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: operator,
        exactAction: DAILY_CLAIRE_CALLS[purpose].exactAction, riskClass: "EXTERNAL_COMMUNICATION",
        standingAuthorizationId: strategic.id, now: MONDAY_MORNING,
      });
      expect(policy.allowed).toBe(false);
    }
  }, 60_000);

  it("a morning grant never authorizes the evening action, and overlapping windows are refused", async () => {
    const { tenantId, identity, operator } = await operatorTenant("cross");
    const morning = await grant(identity, "morning_readiness", "07:30", "09:00");
    const policy = await evaluatePersistentActionPolicy({
      tenantId, canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: operator,
      exactAction: DAILY_CLAIRE_CALLS.evening_debrief.exactAction, riskClass: "EXTERNAL_COMMUNICATION",
      standingAuthorizationId: morning.id, now: MONDAY_EVENING,
    });
    expect(policy.allowed).toBe(false);
    await expect(grant(identity, "evening_debrief", "08:30", "10:00")).rejects.toThrow(/overlaps/);
  }, 60_000);

  it("revocation stops future dispatch even for an already-scheduled appointment", async () => {
    const { tenantId, identity } = await operatorTenant("revoke");
    await grant(identity, "morning_readiness", "07:30", "09:00");
    await ensureDailyClaireAppointments({ store, now: MONDAY_MORNING, tenantId });
    expect((await appointments(tenantId)).length).toBe(1);
    await revokeDailyClaireCall(identity, "morning_readiness");
    await runWorkerFor(2000, MONDAY_MORNING);
    const rows = await appointments(tenantId);
    expect(rows[0]!.callSid).toBeNull();
    expect(rows[0]!.callDispatchStartedAt).toBeNull();
    expect(rows[0]!.status).not.toBe("completed");
  }, 60_000);

  it("seeding is idempotent per purpose and business date, and survives a restart", async () => {
    const { tenantId, identity } = await operatorTenant("idem");
    await grant(identity, "morning_readiness", "07:30", "09:00");
    const early = new Date("2026-10-12T13:00:00Z"); // 06:00 PDT, before the window opens
    await ensureDailyClaireAppointments({ store, now: early, tenantId });
    await ensureDailyClaireAppointments({ store: new OperatorAppointmentStore(pool), now: early, tenantId });
    const rows = await appointments(tenantId);
    expect(rows).toHaveLength(1);
    // Window start in the business timezone: 07:30 PDT = 14:30 UTC.
    expect(new Date(rows[0]!.scheduledFor).toISOString()).toBe("2026-10-12T14:30:00.000Z");
    // A fresh store/worker (process restart) still executes it exactly once.
    await runWorkerUntilSettled(tenantId, MONDAY_MORNING);
    await runWorkerFor(1000, MONDAY_MORNING);
    const after = await appointments(tenantId);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ status: "completed" });
    expect(after[0]!.callSid).toBeTruthy();
  }, 60_000);

  it("daylight-saving end: the window still starts at 07:30 local", async () => {
    const { tenantId, identity } = await operatorTenant("dst");
    await grant(identity, "morning_readiness", "07:30", "09:00");
    await ensureDailyClaireAppointments({ store, now: new Date("2026-11-02T14:00:00Z"), tenantId }); // Mon Nov 2, 06:00 PST
    const rows = await appointments(tenantId);
    expect(new Date(rows[0]!.scheduledFor).toISOString()).toBe("2026-11-02T15:30:00.000Z");
  }, 60_000);

  it("a failed call is recorded as a failure, never a success receipt, with bounded attempts", async () => {
    const { tenantId, identity } = await operatorTenant("fail");
    await grant(identity, "morning_readiness", "07:30", "09:00");
    provider.fail = true;
    try {
      const rows = await runWorkerUntilSettled(tenantId, MONDAY_MORNING);
      expect(rows[0]!.status).not.toBe("completed");
      expect(rows[0]!.callSid).toBeNull();
      expect(Number(rows[0]!.attemptCount)).toBeLessThanOrEqual(2);
    } finally {
      provider.fail = false;
    }
  }, 60_000);

  it("tenants cannot use each other's calling authority", async () => {
    const a = await operatorTenant("iso-a");
    const b = await operatorTenant("iso-b");
    const bGrant = await grant(b.identity, "morning_readiness", "07:30", "09:00");
    const policy = await evaluatePersistentActionPolicy({
      tenantId: a.tenantId, canonicalOperatorId: a.identity.canonicalOperatorId, operatorUserId: a.operator,
      exactAction: DAILY_CLAIRE_CALLS.morning_readiness.exactAction, riskClass: "EXTERNAL_COMMUNICATION",
      standingAuthorizationId: bGrant.id, now: MONDAY_MORNING,
    });
    expect(policy.allowed).toBe(false);
    await ensureDailyClaireAppointments({ store, now: MONDAY_MORNING, tenantId: a.tenantId });
    expect(await appointments(a.tenantId)).toEqual([]);
  }, 60_000);
});
