import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * "Who am I waiting to hear back from?" on real MySQL and a stand-in Gmail: the workspace's own provisioned journey,
 * its own Google connection (stored as the onboarding stored it), the real Gmail reader over HTTP, and nobody else's
 * workspace. Local disposable database only; the Gmail is a local HTTP server, never Google.
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

const NINA = "nina@wildrootflowers.example";
const now = Date.now();
const daysAgo = (days: number) => String(now - days * 86_400_000);
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
  // answered, but outside the bounded inbox sample (Gmail filed it under another tab): asked about directly
  message("s-ana", "th-ana", `Nina Vale <${NINA}>`, "Ana Ortiz <ana@studio.example>", 5, "Wreaths", "Could you use twelve wreaths in December?"),
  message("r-ana", "th-ana", "Ana Ortiz <ana@studio.example>", NINA, 2, "Re: Wreaths", "Yes, twelve."),
  // answered in the same conversation by someone else at the hotel, also outside the sample
  message("s-max", "th-max", `Nina Vale <${NINA}>`, "Max Pell <max@grandhotel.example>", 5, "Lobby arrangement", "Shall I bring the lobby arrangement Monday?"),
  message("r-desk", "th-max", "Front Desk <frontdesk@grandhotel.example>", NINA, 1, "Re: Lobby arrangement", "Monday works, Max is away."),
  // twelve older questions, every one answered outside the sample: they rank above Elena, and once Gmail confirms
  // they were answered, the people below them (Elena) must move up rather than the list coming back empty
  ...Array.from({ length: 12 }, (_, i) => [
    message(`s-old-${i}`, `th-old-${i}`, `Nina Vale <${NINA}>`, `Client ${i} <client${i}@old.example>`, 10 + i, `Order ${i}`, "Could you confirm the order?"),
    message(`r-old-${i}`, `th-old-${i}`, `Client ${i} <client${i}@old.example>`, NINA, 8 + i, `Re: Order ${i}`, "Confirmed."),
  ]).flat(),
];
/** replies the bounded inbox read never sees: only a question about that person or conversation finds them */
const OUTSIDE_SAMPLE = new Set(["r-ana", "r-desk", ...Array.from({ length: 12 }, (_, i) => `r-old-${i}`)]);

describe.skipIf(!allowed)("who the owner is waiting to hear back from, on MySQL and a stand-in Gmail", () => {
  let db: mysql.Connection;
  let gmail: http.Server;
  const queries: string[] = [];
  const tenant = `df_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const previousOrigin = process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;

  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
    gmail = http.createServer((req, res) => {
      const requested = new URL(req.url ?? "/", "http://gmail.local");
      const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (requested.pathname === "/gmail.googleapis.com/gmail/v1/users/me/messages") {
        const q = requested.searchParams.get("q") ?? "";
        queries.push(q);
        const sent = /(^|\s)in:sent\b/.test(q);
        const from = q.match(/(?:^|\s)from:(\S+)/)?.[1] ?? null;
        const found = MAIL.filter(item => item.payload.headers[0].value.includes(NINA) === sent)
          .filter(item => (from ? item.payload.headers[0].value.includes(from) : !OUTSIDE_SAMPLE.has(item.id)));
        return json(200, { messages: found.map(item => ({ id: item.id, threadId: item.threadId })) });
      }
      const thread = requested.pathname.match(/^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/threads\/([^/]+)$/);
      if (thread) {
        queries.push(`thread:${thread[1]}`);
        const messages = MAIL.filter(item => item.threadId === thread[1]);
        return messages.length ? json(200, { id: thread[1], messages }) : json(404, {});
      }
      const one = requested.pathname.match(/^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
      const found = one ? MAIL.find(item => item.id === one[1]) : null;
      return found ? json(200, found) : json(404, {});
    });
    await new Promise<void>(resolve => gmail.listen(0, "127.0.0.1", resolve));
    process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = `http://127.0.0.1:${(gmail.address() as AddressInfo).port}`;
  }, 60_000);
  afterAll(async () => {
    if (previousOrigin === undefined) delete process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;
    else process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = previousOrigin;
    await new Promise(resolve => gmail?.close(resolve));
    await db?.end();
  });

  it("reads the owner's own Sent folder: Elena still owes an answer, Teo already wrote back, and no other workspace sees it", async () => {
    const { startJourney } = await import("../journeys");
    const { saveConnection } = await import("../store");
    const { readAwaitingReplies, clearAwaitingRepliesCache, cachedAwaitingReplies } = await import("./awaitingReplies");
    clearAwaitingRepliesCache();
    const journey = (await startJourney({ requestId: randomUUID(), kind: "own" })).journey;
    await db.query("UPDATE first_ten_journeys SET tenant_id = ? WHERE id = ?", [tenant, journey.id]);

    // provisioned, but Gmail not connected yet: it says so instead of guessing
    expect(await readAwaitingReplies(tenant)).toMatchObject({ items: [], unavailable: "Gmail isn't connected to this workspace." });
    expect(cachedAwaitingReplies(tenant)).toBeNull();

    await saveConnection({
      journeyId: journey.id,
      provider: "google",
      accountLabel: NINA,
      accountSubject: "sub-nina",
      accessToken: "token",
      refreshToken: null,
      accessExpiresAt: new Date(now + 3_600_000),
      grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"],
    });
    const awaiting = (await readAwaitingReplies(tenant))!;
    expect(awaiting.unavailable).toBeNull();
    expect(awaiting.account).toBe(NINA);
    expect(awaiting.items.map(item => [item.person.name, item.person.address, item.waitingDays, item.asked, item.messageId])).toEqual([
      ["Elena Ruiz", "elena@larkspurhotel.example", 4, true, "s-elena"],
    ]);
    expect(awaiting.items[0].url).toContain("th-elena");
    // Ana and the hotel answered outside the sample: Gmail was asked about each candidate directly, so neither is listed
    expect(queries.some(q => q.startsWith("from:ana@studio.example -in:sent"))).toBe(true);
    expect(queries).toContain("thread:th-max");
    // it asked Gmail for the recent window only, Sent and people's mail separately
    expect(queries.some(q => /^in:sent after:\d+$/.test(q))).toBe(true);
    expect(queries.some(q => q.startsWith("-in:sent -in:chats -category:promotions") && /after:\d+$/.test(q))).toBe(true);

    // a second look within minutes comes from the cache, not Gmail
    const asked = queries.length;
    expect((await readAwaitingReplies(tenant))!.items).toHaveLength(1);
    expect(queries.length).toBe(asked);
    expect(cachedAwaitingReplies(tenant)?.items[0].person.address).toBe("elena@larkspurhotel.example");

    // another workspace has no journey of its own: nothing, not Nina's mail
    expect(await readAwaitingReplies(`df_${randomUUID().replace(/-/g, "").slice(0, 24)}`)).toBeNull();
  });
});
