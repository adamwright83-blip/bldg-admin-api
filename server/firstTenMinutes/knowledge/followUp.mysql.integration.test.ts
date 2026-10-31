import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * An approved follow-up on real MySQL and a stand-in Gmail: prepared for the owner, sent only as approved, once, from
 * their own Gmail; held when the person has written back; never to anyone else; without send permission, nothing is
 * tried. Local disposable database only; the Gmail is a local HTTP server, never Google.
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
const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");
type Stored = { id: string; threadId: string; internalDate: string; payload: { mimeType: string; headers: Array<{ name: string; value: string }>; body: { data: string } } };
const message = (id: string, thread: string, from: string, to: string, days: number, subject: string, text: string): Stored => ({
  id,
  threadId: thread,
  internalDate: String(now - days * 86_400_000),
  payload: { mimeType: "text/plain", headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }], body: { data: b64(text) } },
});

describe.skipIf(!allowed)("an approved follow-up, on MySQL and a stand-in Gmail", () => {
  let db: mysql.Connection;
  let gmail: http.Server;
  let mail: Stored[] = [];
  const sends: string[] = [];
  const keys: string[] = [];
  const previousOrigin = process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;

  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
    gmail = http.createServer((req, res) => {
      const requested = new URL(req.url ?? "/", "http://gmail.local");
      const json = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (req.method === "POST" && requested.pathname === "/gmail.googleapis.com/gmail/v1/users/me/messages/send") {
        let body = "";
        req.on("data", chunk => (body += chunk));
        req.on("end", () => {
          sends.push(Buffer.from(JSON.parse(body).raw, "base64url").toString("utf8"));
          json(200, { id: `g-follow-${sends.length}`, threadId: "th-elena", labelIds: ["SENT"] });
        });
        return;
      }
      if (requested.pathname === "/gmail.googleapis.com/gmail/v1/users/me/messages") {
        const sent = /(^|\s)in:sent\b/.test(requested.searchParams.get("q") ?? "");
        return json(200, { messages: mail.filter(item => item.payload.headers[0].value.includes(NINA) === sent).map(item => ({ id: item.id, threadId: item.threadId })) });
      }
      const one = requested.pathname.match(/^\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^/]+)$/);
      const found = one ? mail.find(item => item.id === one[1]) : null;
      return found ? json(200, found) : json(404, {});
    });
    await new Promise<void>(resolve => gmail.listen(0, "127.0.0.1", resolve));
    process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = `http://127.0.0.1:${(gmail.address() as AddressInfo).port}`;
  }, 60_000);
  afterAll(async () => {
    if (keys.length) await db.query("DELETE FROM gmail_sends WHERE send_key IN (?)", [keys]);
    if (previousOrigin === undefined) delete process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN;
    else process.env.JOYSTICK_FIRST_TEN_PROVIDER_ORIGIN = previousOrigin;
    await new Promise(resolve => gmail?.close(resolve));
    await db?.end();
  });

  async function workspace(scopes: string[]) {
    const { startJourney } = await import("../journeys");
    const { saveConnection } = await import("../store");
    const tenant = `df_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const journey = (await startJourney({ requestId: randomUUID(), kind: "own" })).journey;
    await db.query("UPDATE first_ten_journeys SET tenant_id = ? WHERE id = ?", [tenant, journey.id]);
    await saveConnection({
      journeyId: journey.id,
      provider: "google",
      accountLabel: NINA,
      accountSubject: "sub-nina",
      accessToken: "token",
      refreshToken: null,
      accessExpiresAt: new Date(now + 3_600_000),
      grantedScopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", ...scopes],
    });
    return tenant;
  }

  it("prepares it, sends exactly what was approved once, and holds it once they've written back", async () => {
    const { clearAwaitingRepliesCache } = await import("./awaitingReplies");
    const { prepareFollowUp, sendFollowUp, followUpKey, FOLLOW_UP_ACTOR } = await import("./followUp");
    mail = [message("s-elena", "th-elena", `Nina Vale <${NINA}>`, "Elena Ruiz <elena@larkspurhotel.example>", 4, "Re: Friday flowers?", "Is that still something you're looking for?")];
    clearAwaitingRepliesCache();
    const tenant = await workspace(["https://www.googleapis.com/auth/gmail.send"]);
    keys.push(followUpKey(tenant, "s-elena"));

    const draft = await prepareFollowUp(tenant, "s-elena", "America/Los_Angeles");
    expect(draft).toMatchObject({ canSend: true, sendFrom: NINA, alreadySent: null, mail: { to: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" }, subject: "Re: Friday flowers?" } });
    expect(draft.mail.body).toMatch(/^Hi Elena,\n\nFollowing up on my note from \w+ \d+ \w+ about "Re: Friday flowers\?". Did you have a chance to look\?\n$/);
    expect(draft.composeUrl).toContain("mail.google.com");
    expect(sends).toHaveLength(0);

    // never to anyone else
    await expect(sendFollowUp({ tenantId: tenant, approverOpenId: "owner-1", messageId: "s-elena", mail: { ...draft.mail, to: { name: null, address: "someone@else.example" } } })).rejects.toThrow(
      /no one else/
    );
    expect(sends).toHaveLength(0);

    // the owner edits it, approves, and it goes once
    const approved = { ...draft.mail, body: "Hi Elena, just checking Friday flowers still suit the hotel?" };
    const sent = await sendFollowUp({ tenantId: tenant, approverOpenId: "owner-1", messageId: "s-elena", mail: approved });
    expect(sent).toMatchObject({ status: "sent", already: false });
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatch(/^To: "Elena Ruiz" <elena@larkspurhotel\.example>\r$/m);
    // the body goes base64 (Content-Transfer-Encoding): exactly the approved words
    const body = Buffer.from(sends[0].split("\r\n\r\n").slice(1).join("").replace(/\r\n/g, ""), "base64").toString("utf8");
    expect(body).toBe("Hi Elena, just checking Friday flowers still suit the hotel?");
    const [ledger] = await db.query<mysql.RowDataPacket[]>("SELECT actor, status, approved_by, recipient FROM gmail_sends WHERE send_key = ?", [followUpKey(tenant, "s-elena")]);
    expect(ledger[0]).toMatchObject({ actor: FOLLOW_UP_ACTOR, status: "sent", approved_by: "operator:owner-1", recipient: "elena@larkspurhotel.example" });
    // pressed again: already sent, nothing new goes
    expect(await sendFollowUp({ tenantId: tenant, approverOpenId: "owner-1", messageId: "s-elena", mail: approved })).toMatchObject({ status: "sent", already: true });
    expect(sends).toHaveLength(1);
    expect((await prepareFollowUp(tenant, "s-elena", "America/Los_Angeles")).alreadySent).not.toBeNull();

    // another workspace: Elena writes back before the owner approves, so nothing goes
    const second = await workspace(["https://www.googleapis.com/auth/gmail.send"]);
    keys.push(followUpKey(second, "s-elena"));
    clearAwaitingRepliesCache();
    const ready = await prepareFollowUp(second, "s-elena", "America/Los_Angeles");
    mail.push(message("r-elena", "th-elena", "Elena Ruiz <elena@larkspurhotel.example>", NINA, 0, "Re: Friday flowers?", "Yes please."));
    expect(await sendFollowUp({ tenantId: second, approverOpenId: "owner-2", messageId: "s-elena", mail: ready.mail })).toEqual({ status: "replied" });
    expect(sends).toHaveLength(1);
  });

  it("without Gmail's permission to send, tries nothing and hands over the exact message for Gmail", async () => {
    const { clearAwaitingRepliesCache } = await import("./awaitingReplies");
    const { prepareFollowUp, sendFollowUp, followUpKey } = await import("./followUp");
    mail = [message("s-teo", "th-teo", `Nina Vale <${NINA}>`, "Teo Marsh <teo@marsh.example>", 5, "Standing order", "Shall I keep the Friday order going?")];
    clearAwaitingRepliesCache();
    const tenant = await workspace([]);
    keys.push(followUpKey(tenant, "s-teo"));
    const draft = await prepareFollowUp(tenant, "s-teo", "America/Los_Angeles");
    expect(draft.canSend).toBe(false);
    const before = sends.length;
    const result = await sendFollowUp({ tenantId: tenant, approverOpenId: "owner-3", messageId: "s-teo", mail: draft.mail });
    expect(result.status).toBe("needs_permission");
    expect(result.status === "needs_permission" && new URL(result.composeUrl).searchParams.get("to")).toBe("teo@marsh.example");
    expect(sends.length).toBe(before);
  });
});
