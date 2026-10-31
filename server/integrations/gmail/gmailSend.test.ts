import { describe, expect, it } from "vitest";
import {
  GMAIL_SEND_SCOPE,
  SendRefused,
  approvalDigest,
  checkSend,
  rawMessage,
  sendApprovedEmail,
  type GmailSendAccess,
  type SendLedger,
  type SendRecord,
} from "./gmailSend";

const READ = "https://www.googleapis.com/auth/gmail.readonly";
const MAIL = {
  to: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
  subject: "Re: Friday flowers?",
  body: "Hi Elena — we now have a weekly Friday delivery.\nIs that still something you're looking for?",
};

function memoryLedger(): SendLedger & { rows: Map<string, SendRecord> } {
  const rows = new Map<string, SendRecord>();
  return {
    rows,
    async find(key) {
      const row = rows.get(key);
      return row ? { ...row } : null;
    },
    async claim(record) {
      if (rows.has(record.key)) return false;
      rows.set(record.key, { ...record });
      return true;
    },
    async retry(key, from, message, at) {
      const row = rows.get(key);
      if (!row || row.status !== from) return false;
      rows.set(key, { ...row, ...message, status: "sending", attempts: row.attempts + 1, lastAttemptAt: at, failure: null });
      return true;
    },
    async settle(key, outcome) {
      const row = rows.get(key)!;
      if (row.status === "sent" && outcome.status !== "sent") return;
      rows.set(key, { ...row, ...outcome });
    },
  };
}

type Call = { method: string; url: string; body: string | null; token: string };
type Filed = { id: string; rfc822: string; joystick?: string };
/**
 * Gmail, played: `send` answers each POST in turn; the Sent folder holds whatever was sent plus `sentFolder`.
 * `rewriteId`: Gmail gives each message sent through the API its own Message-ID (JOYSTICK's survives in its header).
 * `searchLags`: Gmail's search doesn't show anything yet; the Sent label, read directly, does.
 */
function gmail(
  options: {
    send?: Array<"ok" | "lost" | "accepted_then_lost" | 400 | 401 | 403 | 503>;
    sentFolder?: () => Filed[];
    lookup?: number;
    rewriteId?: boolean;
    searchLags?: boolean;
  } = {}
) {
  const calls: Call[] = [];
  const sends = [...(options.send ?? ["ok"])];
  const folder: Filed[] = [];
  const file = (raw: string) => {
    const own = raw.match(/^Message-ID: (.+)$/m)![1].trim();
    const joystick = raw.match(/^X-Joystick-Send: (.+)$/m)?.[1].trim();
    folder.push({ id: `g-${folder.length + 1}`, rfc822: options.rewriteId ? `<CAgmail${folder.length + 1}@mail.gmail.com>` : own, joystick });
  };
  const everything = () => [...folder, ...(options.sentFolder?.() ?? [])];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? "GET", url: String(url), body: (init?.body as string) ?? null, token: String((init?.headers as Record<string, string>).authorization) };
    calls.push(call);
    if (call.method === "POST") {
      const answer = sends.shift() ?? "ok";
      const raw = Buffer.from(JSON.parse(call.body!).raw, "base64url").toString("utf8");
      if (answer === "lost") throw new Error("socket hang up");
      if (answer === "accepted_then_lost") {
        file(raw);
        throw new Error("socket hang up");
      }
      if (typeof answer === "number") return new Response("{}", { status: answer });
      file(raw);
      return Response.json({ id: `g-${folder.length}`, threadId: "t-1", labelIds: ["SENT"] });
    }
    if (options.lookup) return new Response("{}", { status: options.lookup });
    const at = new URL(call.url);
    const one = at.pathname.match(/\/messages\/([^/]+)$/);
    if (one) {
      const item = everything().find(candidate => candidate.id === decodeURIComponent(one[1]));
      if (!item) return new Response("{}", { status: 404 });
      const headers = [{ name: "Message-ID", value: item.rfc822 }, ...(item.joystick ? [{ name: "X-Joystick-Send", value: item.joystick }] : [])];
      return Response.json({ id: item.id, threadId: "t-1", payload: { headers } });
    }
    if (at.searchParams.get("labelIds") === "SENT") return Response.json({ messages: everything().reverse().map(item => ({ id: item.id, threadId: "t-1" })) });
    const wanted = at.searchParams.get("q")?.match(/rfc822msgid:(\S+)/)?.[1];
    const found = options.searchLags ? [] : everything().filter(item => item.rfc822.replace(/^<|>$/g, "") === wanted);
    return Response.json({ messages: found.map(item => ({ id: item.id, threadId: "t-1" })) });
  }) as typeof fetch;
  return { calls, posts: () => calls.filter(call => call.method === "POST"), fetch: fetcher };
}

function access(scopes = [GMAIL_SEND_SCOPE, READ]): GmailSendAccess & { renewals: number } {
  const state = { renewals: 0 };
  return {
    accountEmail: "owner@first-ten.example",
    grantedScopes: scopes,
    get renewals() {
      return state.renewals;
    },
    async token(renew) {
      if (renew) state.renewals += 1;
      return state.renewals ? `renewed-${state.renewals}` : "token-1";
    },
  };
}

const approval = (mail = MAIL) => ({ digest: approvalDigest(mail), approvedBy: "first_ten_journey:j1", approvedAt: new Date("2026-10-31T17:00:00Z") });
const send = (deps: { ledger: SendLedger; fetch: typeof fetch; now?: () => Date }, overrides: Partial<Parameters<typeof sendApprovedEmail>[0]> = {}) =>
  sendApprovedEmail({ key: "first_ten:j1", actor: "first_ten_onboarding", mail: MAIL, approval: approval(), access: access(), ...overrides }, deps);

describe("sending from the person's own Gmail", () => {
  it("sends the approved message once, from their account, and records Google's id; a retry or replay never sends again", async () => {
    const ledger = memoryLedger();
    const google = gmail();
    const first = await send({ ledger, fetch: google.fetch });
    expect(first).toMatchObject({ status: "sent", gmailMessageId: "g-1", gmailThreadId: "t-1", already: false });
    expect(google.posts()).toHaveLength(1);
    expect(google.posts()[0].url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const raw = Buffer.from(JSON.parse(google.posts()[0].body!).raw, "base64url").toString("utf8");
    expect(raw).toMatch(/^From: owner@first-ten\.example\r$/m);
    expect(raw).toMatch(/^To: "Elena Ruiz" <elena@larkspurhotel\.example>\r$/m);
    expect(raw).toMatch(/^Subject: Re: Friday flowers\?\r$/m);
    const body = raw.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe(MAIL.body.replace(/\n/g, "\r\n"));
    expect(ledger.rows.get("first_ten:j1")).toMatchObject({ status: "sent", gmailMessageId: "g-1", attempts: 1, recipient: MAIL.to.address });

    const again = await send({ ledger, fetch: google.fetch });
    expect(again).toMatchObject({ status: "sent", gmailMessageId: "g-1", already: true });
    expect(google.posts()).toHaveLength(1);
  });

  it("sends only the message that was approved, and nothing is recorded otherwise", async () => {
    const ledger = memoryLedger();
    const google = gmail();
    await expect(send({ ledger, fetch: google.fetch }, { approval: approval({ ...MAIL, body: "something else" }) })).rejects.toBeInstanceOf(SendRefused);
    await expect(send({ ledger, fetch: google.fetch }, { approval: approval({ ...MAIL, to: { ...MAIL.to, address: "someone@else.example" } }) })).rejects.toBeInstanceOf(SendRefused);
    expect(google.calls).toHaveLength(0);
    expect(ledger.rows.size).toBe(0);
  });

  it("can't be made to add a header or a recipient", () => {
    const raw = Buffer.from(
      rawMessage({ from: "owner@first-ten.example", mail: { ...MAIL, subject: "Hi\r\nBcc: spy@example.com", to: { name: 'Elena"\r\nCc: x@y.z', address: MAIL.to.address } }, messageId: "<m@gojoystick.com>", date: new Date() }),
      "base64url"
    ).toString("utf8");
    const headers = raw.split("\r\n\r\n")[0];
    expect(headers).not.toMatch(/^(Bcc|Cc):/im);
    expect(() => rawMessage({ from: "owner@first-ten.example", mail: { ...MAIL, to: { name: null, address: "a@b.c\r\nBcc: d@e.f" } }, messageId: "<m@x>", date: new Date() })).toThrow(SendRefused);
  });

  it("asks for permission instead of trying, when the account hasn't allowed sending", async () => {
    const ledger = memoryLedger();
    const google = gmail();
    expect(await send({ ledger, fetch: google.fetch }, { access: access([READ]) })).toEqual({ status: "needs_permission" });
    expect(google.calls).toHaveLength(0);
    expect(ledger.rows.size).toBe(0);
  });

  it("a refusal from Google sends nothing and can be tried again; a refused permission asks for it", async () => {
    const ledger = memoryLedger();
    const google = gmail({ send: [400, 403, "ok"] });
    expect(await send({ ledger, fetch: google.fetch })).toMatchObject({ status: "failed" });
    expect(ledger.rows.get("first_ten:j1")?.status).toBe("failed");
    expect(await send({ ledger, fetch: google.fetch })).toEqual({ status: "needs_permission" });
    expect(await send({ ledger, fetch: google.fetch })).toMatchObject({ status: "sent", already: false });
    expect(ledger.rows.get("first_ten:j1")).toMatchObject({ status: "sent", attempts: 3 });
  });

  it("renews an expired token once, before anything is sent", async () => {
    const ledger = memoryLedger();
    const google = gmail({ send: [401, "ok"] });
    const account = access();
    expect(await send({ ledger, fetch: google.fetch }, { access: account })).toMatchObject({ status: "sent" });
    expect(account.renewals).toBe(1);
    expect(google.posts().map(call => call.token)).toEqual(["Bearer token-1", "Bearer renewed-1"]);
  });

  it("a lost answer is never claimed as sent: it is settled from the Sent folder by the message's own id", async () => {
    const ledger = memoryLedger();
    const google = gmail({ send: ["accepted_then_lost"] });
    // the immediate look finds it: sent, with the Sent folder's id
    expect(await send({ ledger, fetch: google.fetch })).toMatchObject({ status: "sent", gmailMessageId: "g-1" });
    expect(google.posts()).toHaveLength(1);

    const lost = memoryLedger();
    let now = new Date("2026-10-31T17:00:00Z");
    const nowFn = () => now;
    const nothing = gmail({ send: ["lost", "ok"] });
    expect(await send({ ledger: lost, fetch: nothing.fetch, now: nowFn })).toEqual({ status: "sending" });
    expect(lost.rows.get("first_ten:j1")?.status).toBe("unknown");
    // asked again straight away: not tried again while the Sent folder may not show it yet
    now = new Date("2026-10-31T17:01:00Z");
    expect(await send({ ledger: lost, fetch: nothing.fetch, now: nowFn })).toEqual({ status: "sending" });
    expect(nothing.posts()).toHaveLength(1);
    // long enough, and still not in Sent: that doesn't prove it didn't go, so JOYSTICK doesn't send it again by itself,
    // however long it has been
    for (const later of ["2026-10-31T17:05:00Z", "2026-11-01T17:00:00Z"]) {
      now = new Date(later);
      expect(await send({ ledger: lost, fetch: nothing.fetch, now: nowFn })).toEqual({ status: "sending" });
    }
    expect(nothing.posts()).toHaveLength(1);
    // the person, told it may already have gone, chooses to send it again: with the same Message-ID
    expect(await send({ ledger: lost, fetch: nothing.fetch, now: nowFn }, { resendUnconfirmed: true })).toMatchObject({ status: "sent" });
    const ids = nothing.posts().map(call => Buffer.from(JSON.parse(call.body!).raw, "base64url").toString("utf8").match(/^Message-ID: (.+)$/m)![1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(lost.rows.get("first_ten:j1")?.attempts).toBe(2);
  });

  it("the person's choice to send again still waits for the Sent folder to have had its chance", async () => {
    const ledger = memoryLedger();
    let now = new Date("2026-10-31T17:00:00Z");
    const google = gmail({ send: ["lost", "ok"] });
    expect(await send({ ledger, fetch: google.fetch, now: () => now })).toEqual({ status: "sending" });
    now = new Date("2026-10-31T17:01:30Z");
    expect(await send({ ledger, fetch: google.fetch, now: () => now }, { resendUnconfirmed: true })).toEqual({ status: "sending" });
    expect(google.posts()).toHaveLength(1);
  });

  it("a lost answer is found in Sent even when search lags and Gmail gave it its own Message-ID, and is never resent", async () => {
    const ledger = memoryLedger();
    let now = new Date("2026-10-31T17:00:00Z");
    const google = gmail({ send: ["accepted_then_lost", "ok"], rewriteId: true, searchLags: true });
    // the immediate look reads Sent directly and recognises it by JOYSTICK's own header
    expect(await send({ ledger, fetch: google.fetch, now: () => now })).toMatchObject({ status: "sent", gmailMessageId: "g-1", already: false });
    now = new Date("2026-10-31T17:05:00Z");
    expect(await send({ ledger, fetch: google.fetch, now: () => now }, { resendUnconfirmed: true })).toMatchObject({ status: "sent", already: true });
    expect(google.posts()).toHaveLength(1);
    const raw = Buffer.from(JSON.parse(google.posts()[0].body!).raw, "base64url").toString("utf8");
    expect(raw.match(/^X-Joystick-Send: (.+)$/m)?.[1]).toBe(raw.match(/^Message-ID: (.+)$/m)?.[1]);
  });

  it("without the Sent folder to look in, a lost answer stays unconfirmed and is never sent again", async () => {
    const ledger = memoryLedger();
    let now = new Date("2026-10-31T17:00:00Z");
    const google = gmail({ send: ["lost"] });
    const sendOnly = access([GMAIL_SEND_SCOPE]);
    expect(await send({ ledger, fetch: google.fetch, now: () => now }, { access: sendOnly })).toEqual({ status: "sending" });
    now = new Date("2026-10-31T18:00:00Z");
    expect(await send({ ledger, fetch: google.fetch, now: () => now }, { access: sendOnly })).toEqual({ status: "sending" });
    expect(await checkSend({ key: "first_ten:j1", access: sendOnly }, { ledger, fetch: google.fetch, now: () => now })).toEqual({ status: "sending" });
    expect(google.posts()).toHaveLength(1);
  });

  it("a Sent folder that can't be read proves nothing: a lost answer is never sent again on it (#779 review)", async () => {
    const ledger = memoryLedger();
    let now = new Date("2026-10-31T17:00:00Z");
    const google = gmail({ send: ["lost", "ok"], lookup: 503 });
    expect(await send({ ledger, fetch: google.fetch, now: () => now })).toEqual({ status: "sending" });
    for (const later of ["2026-10-31T17:05:00Z", "2026-10-31T19:00:00Z", "2026-11-01T17:00:00Z"]) {
      now = new Date(later);
      expect(await send({ ledger, fetch: google.fetch, now: () => now }, { resendUnconfirmed: true })).toEqual({ status: "sending" });
    }
    expect(google.posts()).toHaveLength(1);
  });

  it("two clicks at once send one message", async () => {
    const ledger = memoryLedger();
    const google = gmail({ send: ["ok", "ok"] });
    const [a, b] = await Promise.all([send({ ledger, fetch: google.fetch }), send({ ledger, fetch: google.fetch })]);
    expect(google.posts()).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual(["sending", "sent"]);
  });
});
