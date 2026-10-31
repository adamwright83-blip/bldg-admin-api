import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { formatInTimeZone } from "date-fns-tz";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nextRunAt } from "../../../shared/claireRoutines";

/**
 * Claire routines on real MySQL and a stand-in Gmail: routines created through the tenant-operator API, run by the
 * worker's own tick, read from each workspace's own provisioned journey and Google connection over HTTP, and nobody
 * else's workspace. Local disposable database only; the Gmail is a local HTTP server, never Google.
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

const LA = "America/Los_Angeles";
const MINUTE = 60_000;
const NINA = "nina@wildrootflowers.example";
const realNow = Date.now();
const daysAgo = (days: number) => String(realNow - days * 86_400_000);
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
const message = (id: string, thread: string, from: string, to: string, days: number, subject: string, text: string) => ({
  id,
  threadId: thread,
  internalDate: daysAgo(days),
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "From", value: from },
      { name: "To", value: to },
      { name: "Subject", value: subject },
    ],
    body: { data: b64(text) },
  },
});
const MAIL = [
  message("s-elena", "th-elena", `Nina Vale <${NINA}>`, "Elena Ruiz <elena@larkspurhotel.example>", 4, "Re: Friday flowers?", "We now have a weekly Friday delivery. Is that still something you're looking for?"),
  message("s-teo", "th-teo", `Nina Vale <${NINA}>`, "Teo Marsh <teo@marsh.example>", 6, "Standing order", "Shall I keep the Friday order going?"),
  message("r-teo", "th-teo", "Teo Marsh <teo@marsh.example>", NINA, 3, "Re: Standing order", "Yes please."),
];

const PREFIX = "rtn_";
const tenantId = () => `${PREFIX}${randomUUID().replace(/-/g, "").slice(0, 24)}`;
// legacy membership table name (tenant operator access), retained for compatibility
const MEMBERSHIPS = "dayforge_saas_memberships"; // legacy

describe.skipIf(!allowed)("Claire routines on MySQL and a stand-in Gmail", () => {
  let db: mysql.Connection;
  let gmail: http.Server;
  const queries: string[] = [];
  const previousOrigin = process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;
  const nina = tenantId(); // connected Gmail: the weekly routine, cross-tenant, run now, stop
  const other = tenantId(); // another workspace, no journey
  const flaky = tenantId(); // connected: fails every time
  const recovers = tenantId(); // connected: fails once, then reads
  const unconnected = tenantId(); // provisioned, Gmail never connected
  const owners = new Map([nina, other, flaky, recovers, unconnected].map(tenant => [tenant, `${tenant}-owner`]));

  type Caller = ReturnType<Awaited<typeof import("./router")>["claireRoutinesRouter"]["createCaller"]>;
  let callers: Map<string, Caller>;
  let tick: (now: Date, tenants: string[], read?: (tenant: string) => Promise<unknown>) => Promise<{ done: number; failed: number; skipped: number; movedOn: number }>;
  const runsOf = async (routineId: string) =>
    (await db.query<mysql.RowDataPacket[]>("SELECT * FROM claire_routine_runs WHERE routine_id = ? ORDER BY started_at, attempts", [routineId]))[0];
  const routineRow = async (routineId: string) => (await db.query<mysql.RowDataPacket[]>("SELECT * FROM claire_routines WHERE id = ?", [routineId]))[0][0];

  beforeAll(async () => {
    db = await mysql.createConnection(url);
    // leftovers of an earlier, interrupted run of this file only
    await db.query("DELETE FROM claire_routine_runs WHERE tenant_id LIKE ?", [`${PREFIX}%`]);
    await db.query("DELETE FROM claire_routines WHERE tenant_id LIKE ?", [`${PREFIX}%`]);
    gmail = http.createServer((req, res) => {
      const requested = new URL(req.url ?? "/", "http://gmail.local");
      const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (requested.pathname === "/gmail.googleapis.com/gmail/v1/users/me/messages") {
        const q = requested.searchParams.get("q") ?? "";
        queries.push(q);
        const sent = /(^|\s)in:sent\b/.test(q);
        return json(200, { messages: MAIL.filter(item => item.payload.headers[0].value.includes(NINA) === sent).map(item => ({ id: item.id, threadId: item.threadId })) });
      }
      const one = requested.pathname.match(/^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
      const found = one ? MAIL.find(item => item.id === one[1]) : null;
      return found ? json(200, found) : json(404, {});
    });
    await new Promise<void>(resolve => gmail.listen(0, "127.0.0.1", resolve));
    process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = `http://127.0.0.1:${(gmail.address() as AddressInfo).port}`;

    const { startJourney } = await import("../../firstTenMinutes/journeys");
    const { saveConnection } = await import("../../firstTenMinutes/store");
    for (const tenant of [nina, flaky, recovers, unconnected]) {
      const journey = (await startJourney({ requestId: randomUUID(), kind: "own" })).journey;
      await db.query("UPDATE first_ten_journeys SET tenant_id = ? WHERE id = ?", [tenant, journey.id]);
      if (tenant === unconnected) continue;
      await saveConnection({
        journeyId: journey.id,
        provider: "google",
        accountLabel: NINA,
        accountSubject: `sub-${tenant}`,
        accessToken: "token",
        refreshToken: null,
        accessExpiresAt: new Date(realNow + 3_600_000),
        grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
      });
    }
    for (const [tenant, openId] of owners) {
      await db.query(`INSERT INTO ${MEMBERSHIPS} (tenantId, userOpenId, role, active) VALUES (?, ?, 'owner', 1)`, [tenant, openId]);
    }

    const { claireRoutinesRouter } = await import("./router");
    callers = new Map(
      [...owners].map(([tenant, openId]) => [
        tenant,
        claireRoutinesRouter.createCaller({ req: {} as never, res: {} as never, user: { id: 1, openId, role: "user" } as never, vendorSession: null, tenantId: tenant } as never),
      ])
    );
    const { runDueRoutines } = await import("./runner");
    const { drizzleRoutineStore } = await import("../../routines/routineStore");
    // the real store and runner; each tick looks only at this file's workspaces
    tick = (now, tenants, read) =>
      runDueRoutines(now, {
        store: { ...drizzleRoutineStore, dueRoutines: async (at, limit) => (await drizzleRoutineStore.dueRoutines(at, limit)).filter(row => tenants.includes(row.tenantId)) },
        ...(read ? { read: read as never } : {}),
      });
  }, 60_000);

  afterAll(async () => {
    if (previousOrigin === undefined) delete process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;
    else process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = previousOrigin;
    await new Promise(resolve => gmail?.close(resolve));
    if (db) {
      await db.query("DELETE FROM claire_routine_runs WHERE tenant_id LIKE ?", [`${PREFIX}%`]);
      await db.query("DELETE FROM claire_routines WHERE tenant_id LIKE ?", [`${PREFIX}%`]);
      await db.query(`DELETE FROM ${MEMBERSHIPS} WHERE tenantId LIKE ?`, [`${PREFIX}%`]);
      await db.end();
    }
  });

  let weekly: { id: string; nextRunAt: string };

  it("creates a routine from the operator's words, runs it once when due, and keeps what it found with links", async () => {
    const owner = callers.get(nina)!;
    expect(await owner.preview({ instruction: "Every Monday morning, tell me who I'm waiting to hear back from", timeZone: LA })).toMatchObject({
      ok: true,
      describe: "Every Monday at 8:00 — who you're waiting to hear back from",
    });
    // words Claire can't run are refused, and nothing is saved
    expect(await owner.create({ instruction: "Every Monday, email everyone who hasn't replied", timeZone: LA })).toMatchObject({ ok: false, reason: /only read and report/ });
    expect(await owner.list()).toEqual([]);

    const created = await owner.create({ instruction: "Every Monday morning, tell me who I'm waiting to hear back from", timeZone: LA });
    if (!created.ok) throw new Error(created.reason);
    expect(created.routine).toMatchObject({ kind: "waiting_on", cadence: "weekly", weekday: 1, localTime: "08:00", status: "active", runs: [] });
    const due = new Date(created.routine.nextRunAt!);
    expect(due.getTime()).toBeGreaterThan(Date.now());
    expect(formatInTimeZone(due, LA, "EEEE HH:mm")).toBe("Monday 08:00");
    weekly = { id: created.routine.id, nextRunAt: created.routine.nextRunAt! };

    // not yet due: nothing runs
    expect(await tick(new Date(due.getTime() - MINUTE), [nina])).toMatchObject({ done: 0 });
    expect(await runsOf(weekly.id)).toHaveLength(0);

    const asked = queries.length;
    expect(await tick(new Date(due.getTime() + MINUTE), [nina])).toMatchObject({ done: 1, failed: 0 });
    expect(queries.length).toBeGreaterThan(asked); // it read Gmail fresh
    const [run] = await runsOf(weekly.id);
    expect(run).toMatchObject({ tenant_id: nina, trigger: "schedule", status: "done", attempts: 1, period_key: formatInTimeZone(due, LA, "yyyy-MM-dd"), error: null });
    expect(run.summary).toBe("You're waiting on a reply from 1 person: Elena Ruiz (4 days).");
    const findings = typeof run.findings_json === "string" ? JSON.parse(run.findings_json) : run.findings_json;
    expect(findings.items).toEqual([
      expect.objectContaining({ person: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" }, subject: "Re: Friday flowers?", messageId: "s-elena", threadId: "th-elena", waitingDays: 4 }),
    ]);
    expect(findings.items[0].url).toContain("th-elena");
    const after = await routineRow(weekly.id);
    const following = nextRunAt({ cadence: "weekly", weekday: 1, localTime: "08:00", timeZone: LA }, new Date(due.getTime() + MINUTE));
    expect(formatInTimeZone(following, LA, "EEEE HH:mm")).toBe("Monday 08:00");
    expect(new Date(after.next_run_at).getTime()).toBe(following.getTime());
    expect(after.last_run_at).not.toBeNull();

    // a second tick in the same period does nothing, and doesn't read Gmail again
    const seen = queries.length;
    expect(await tick(new Date(due.getTime() + 6 * MINUTE), [nina])).toMatchObject({ done: 0, failed: 0 });
    // even if the routine still looked due (a worker stopped between finishing and moving on): no second run
    await db.query("UPDATE claire_routines SET next_run_at = ? WHERE id = ?", [due, weekly.id]);
    expect(await tick(new Date(due.getTime() + 7 * MINUTE), [nina])).toMatchObject({ done: 0, movedOn: 1 });
    expect(queries.length).toBe(seen);
    expect(await runsOf(weekly.id)).toHaveLength(1);
    expect(new Date((await routineRow(weekly.id)).next_run_at).getTime()).toBe(following.getTime());

    // the desk's list: the routine in words with its run and findings
    const [listed] = await owner.list();
    expect(listed).toMatchObject({ id: weekly.id, describe: "Every Monday at 8:00 — who you're waiting to hear back from", status: "active" });
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]).toMatchObject({ trigger: "schedule", status: "done", summary: "You're waiting on a reply from 1 person: Elena Ruiz (4 days).", note: null });
    expect(listed.runs[0].findings?.items[0].url).toContain("th-elena");
  });

  it("pause stops runs; resume recomputes the next time from now", async () => {
    const owner = callers.get(nina)!;
    const paused = await owner.pause({ id: weekly.id });
    expect(paused).toMatchObject({ status: "paused", nextRunAt: null });
    expect((await routineRow(weekly.id)).next_run_at).toBeNull();
    expect(await tick(new Date(Date.now() + 30 * 86_400_000), [nina])).toMatchObject({ done: 0 });
    expect(await runsOf(weekly.id)).toHaveLength(1);

    const resumed = await owner.resume({ id: weekly.id });
    const next = new Date(resumed.nextRunAt!);
    expect(resumed.status).toBe("active");
    expect(next.getTime()).toBeGreaterThan(Date.now());
    expect(next.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);
    expect(formatInTimeZone(next, LA, "EEEE HH:mm")).toBe("Monday 08:00");
  });

  it("another workspace cannot list, pause, stop or run it", async () => {
    const stranger = callers.get(other)!;
    expect(await stranger.list()).toEqual([]);
    for (const attempt of [() => stranger.pause({ id: weekly.id }), () => stranger.resume({ id: weekly.id }), () => stranger.stop({ id: weekly.id }), () => stranger.runNow({ id: weekly.id })]) {
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await routineRow(weekly.id)).status).toBe("active");
    expect(await runsOf(weekly.id)).toHaveLength(1);
    // and Nina's own login can't reach into a workspace it isn't a member of
    const { claireRoutinesRouter } = await import("./router");
    const trespass = claireRoutinesRouter.createCaller({ req: {} as never, res: {} as never, user: { id: 1, openId: owners.get(nina), role: "user" } as never, vendorSession: null, tenantId: other } as never);
    await expect(trespass.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("run now runs it once (a second press in the same minute is the same run) and leaves its schedule alone", async () => {
    const owner = callers.get(nina)!;
    const scheduled = (await routineRow(weekly.id)).next_run_at;
    const run = await owner.runNow({ id: weekly.id });
    expect(run).toMatchObject({ trigger: "manual", status: "done", summary: "You're waiting on a reply from 1 person: Elena Ruiz (4 days)." });
    const again = await owner.runNow({ id: weekly.id });
    if (again.id !== run.id) {
      // the minute turned between the two presses: still one run per minute
      expect(new Date(again.startedAt).getUTCMinutes()).not.toBe(new Date(run.startedAt).getUTCMinutes());
    }
    expect((await routineRow(weekly.id)).next_run_at).toEqual(scheduled);
  });

  it("stop keeps the routine and its history, and it never runs again", async () => {
    const owner = callers.get(nina)!;
    const runs = (await runsOf(weekly.id)).length;
    expect(await owner.stop({ id: weekly.id })).toMatchObject({ status: "stopped", nextRunAt: null });
    const [listed] = await owner.list();
    expect(listed).toMatchObject({ id: weekly.id, status: "stopped" });
    expect(listed.runs.length).toBe(runs);
    await expect(owner.resume({ id: weekly.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(owner.runNow({ id: weekly.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await db.query("UPDATE claire_routines SET next_run_at = ? WHERE id = ?", [new Date(Date.now() - MINUTE), weekly.id]);
    expect(await tick(new Date(), [nina])).toMatchObject({ done: 0 });
    expect(await runsOf(weekly.id)).toHaveLength(runs);
  });

  it("a failure is recorded and retried in the same period, then the routine moves on after 3 tries", async () => {
    const created = await callers.get(flaky)!.create({ instruction: "Check every morning who's gone quiet", timeZone: LA });
    if (!created.ok) throw new Error(created.reason);
    const due = new Date(created.routine.nextRunAt!);
    const broken = async (tenant: string) => {
      if (tenant === flaky) throw new Error("Gmail reader exploded");
      return null;
    };
    for (const [attempt, minutes] of [
      [1, 1],
      [2, 6],
    ] as const) {
      expect(await tick(new Date(due.getTime() + minutes * MINUTE), [flaky], broken)).toMatchObject({ failed: 1 });
      const runs = await runsOf(created.routine.id);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: "failed", attempts: attempt, error: "Gmail reader exploded" });
      // still due: the next tick tries this same period again
      expect(new Date((await routineRow(created.routine.id)).next_run_at).getTime()).toBe(due.getTime());
    }
    const [listed] = await callers.get(flaky)!.list();
    expect(listed.runs[0]).toMatchObject({ status: "failed", summary: null, note: "It didn't finish (try 2 of 3); JOYSTICK tries again in a few minutes." });

    expect(await tick(new Date(due.getTime() + 11 * MINUTE), [flaky], broken)).toMatchObject({ failed: 1 });
    const [third] = await runsOf(created.routine.id);
    expect(third).toMatchObject({ status: "failed", attempts: 3 });
    // out of tries: on to tomorrow at 8:00, not stuck and not run again for this period
    const tomorrow = new Date((await routineRow(created.routine.id)).next_run_at);
    expect(tomorrow.getTime()).toBeGreaterThan(due.getTime());
    expect(formatInTimeZone(tomorrow, LA, "HH:mm")).toBe("08:00");
    expect(await tick(new Date(due.getTime() + 16 * MINUTE), [flaky], broken)).toMatchObject({ failed: 0, done: 0 });
    expect(await runsOf(created.routine.id)).toHaveLength(1);
    expect((await callers.get(flaky)!.list())[0].runs[0].note).toBe("It didn't finish after 3 tries; it runs again at its next time.");

    // the next morning it reads normally: a new period, a finished run
    expect(await tick(new Date(tomorrow.getTime() + MINUTE), [flaky])).toMatchObject({ done: 1 });
    const runs = await runsOf(created.routine.id);
    expect(runs.map(run => [run.status, run.attempts])).toEqual([
      ["failed", 3],
      ["done", 1],
    ]);
    expect(runs[1].summary).toBe("You're waiting on a reply from 1 person: Elena Ruiz (4 days).");
  });

  it("a failed run that succeeds on retry is one finished run; who wrote back looks back 7 days on a first check", async () => {
    const created = await callers.get(recovers)!.create({ instruction: "Every day at 9am, check who wrote back", timeZone: LA });
    if (!created.ok) throw new Error(created.reason);
    expect(created.routine).toMatchObject({ kind: "wrote_back", cadence: "daily", localTime: "09:00" });
    const due = new Date(created.routine.nextRunAt!);
    expect(await tick(new Date(due.getTime() + MINUTE), [recovers], async () => Promise.reject(new Error("Gmail didn't answer")))).toMatchObject({ failed: 1 });
    expect(await tick(new Date(due.getTime() + 6 * MINUTE), [recovers])).toMatchObject({ done: 1 });
    const runs = await runsOf(created.routine.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "done", attempts: 2, error: null });
    expect(runs[0].summary).toMatch(/^1 person wrote back in the last 7 days: Teo Marsh \(/);
    const findings = typeof runs[0].findings_json === "string" ? JSON.parse(runs[0].findings_json) : runs[0].findings_json;
    expect(findings.items.map((item: { messageId: string }) => item.messageId)).toEqual(["r-teo"]);
    // the next check looks back only to this one: Teo's reply is older than that
    const next = new Date((await routineRow(created.routine.id)).next_run_at);
    expect(await tick(new Date(next.getTime() + MINUTE), [recovers])).toMatchObject({ done: 1 });
    const [, second] = await runsOf(created.routine.id);
    expect(second.summary).toBe("Nobody wrote back since the last check.");
  });

  it("Gmail that can't be read is a finished run that says why, not a failure loop", async () => {
    const created = await callers.get(unconnected)!.create({ instruction: "Every evening tell me who hasn't replied", timeZone: LA });
    if (!created.ok) throw new Error(created.reason);
    const due = new Date(created.routine.nextRunAt!);
    expect(await tick(new Date(due.getTime() + MINUTE), [unconnected])).toMatchObject({ done: 1, failed: 0 });
    const [run] = await runsOf(created.routine.id);
    expect(run).toMatchObject({ status: "done", attempts: 1, summary: "Not checked: Gmail isn't connected to this workspace." });
    // moved on to tomorrow evening, not retried
    expect(new Date((await routineRow(created.routine.id)).next_run_at).getTime()).toBeGreaterThan(due.getTime());

    // a workspace with no Gmail at all says so too
    const none = await callers.get(other)!.create({ instruction: "Every Friday at 4pm, who still owes me a reply", timeZone: LA });
    if (!none.ok) throw new Error(none.reason);
    expect(await callers.get(other)!.runNow({ id: none.routine.id })).toMatchObject({ status: "done", summary: "Not checked: No Gmail is connected to this workspace." });
  });
});
