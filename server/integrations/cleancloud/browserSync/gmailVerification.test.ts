import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetConsumedGmailMessagesForTests,
  decryptGmailToken,
  encryptGmailToken,
  extractCleanCloudVerificationCode,
  gmailMessageText,
  waitForCleanCloudVerificationCode,
  type GmailMessage,
  type GmailReader,
} from "./gmailVerification";
import { CleanCloudAuthError, loginCleanCloud, sanitizeCleanCloudMessage } from "./cleancloudDirectSync";
import { AUTH_FAILURE_BACKOFF_MS, isAuthBackoffActive, isDirectAutoSyncEnabled } from "./cleancloudDirectScheduler";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const message = (id: string, internalDate: number, text: string, mimeType = "text/plain"): GmailMessage => ({
  id,
  internalDate,
  payload: { mimeType: "multipart/alternative", parts: [{ mimeType, body: { data: b64(text) } }] },
});
const reader = (messages: GmailMessage[]): GmailReader => ({
  listMessageIds: async () => messages.map(m => m.id),
  getMessage: async id => messages.find(m => m.id === id)!,
});

describe("CleanCloud verification code extraction", () => {
  it("reads the code from the original plain or HTML body", () => {
    expect(extractCleanCloudVerificationCode("Your CleanCloud login code is 482913. It expires soon.")).toBe("482913");
    const html = gmailMessageText({ mimeType: "text/html", body: { data: b64("<p>Code:</p><b>731204</b>") } });
    expect(extractCleanCloudVerificationCode(html)).toBe("731204");
  });
  it("refuses ambiguous bodies", () => {
    expect(extractCleanCloudVerificationCode("Order 123456 and 654321 shipped")).toBeNull();
  });
});

describe("matching a code to the current login attempt", () => {
  beforeEach(() => _resetConsumedGmailMessagesForTests());
  const started = new Date("2026-10-14T01:00:00Z");

  it("ignores emails from earlier attempts and takes the newest after this one", async () => {
    const code = await waitForCleanCloudVerificationCode({
      tenantId: "t",
      notBefore: started,
      reader: reader([
        message("old", started.getTime() - 60_000, "Your code is 111111"),
        message("new", started.getTime() + 4_000, "Your code is 222222"),
      ]),
      timeoutMs: 0,
    });
    expect(code).toBe("222222");
  });

  it("never reuses a consumed message and times out without a fresh email", async () => {
    const r = reader([message("m1", started.getTime() + 1_000, "Your code is 333333")]);
    expect(await waitForCleanCloudVerificationCode({ tenantId: "t", notBefore: started, reader: r, timeoutMs: 0 })).toBe("333333");
    await expect(
      waitForCleanCloudVerificationCode({ tenantId: "t", notBefore: started, reader: r, timeoutMs: 0 })
    ).rejects.toThrow("No CleanCloud verification email arrived in time");
  });

  it("requires a Gmail connection", async () => {
    await expect(
      waitForCleanCloudVerificationCode({ tenantId: "t", notBefore: started, reader: null, timeoutMs: 0 })
    ).rejects.toThrow("not connected");
  });
});

describe("CleanCloud login with email verification", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.CLEANCLOUD_USERNAME = "ops@example.invalid";
    process.env.CLEANCLOUD_PASSWORD = "not-a-real-password";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  function fakeCleanCloud(responses: Array<{ body: unknown; cookie?: string }>) {
    const calls: Array<{ body: URLSearchParams; cookie: string | undefined }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      calls.push({ body: new URLSearchParams(String(init.body)), cookie: headers.Cookie });
      const next = responses[calls.length - 1]!;
      return new Response(JSON.stringify(next.body), {
        status: 200,
        headers: next.cookie ? { "set-cookie": next.cookie } : {},
      });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("submits the Gmail code in the same session and returns that session", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const { fetchImpl, calls } = fakeCleanCloud([
      { body: { doEmailConfirm: true }, cookie: "PHPSESSID=abc; Path=/" },
      { body: { login: "1" }, cookie: "remember=xyz; Path=/" },
    ]);
    const session = await loginCleanCloud({
      tenantId: "default",
      fetchImpl,
      waitForCode: async ({ notBefore }) => {
        expect(notBefore).toBeInstanceOf(Date);
        return "908172";
      },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body.has("emailCodeEntered")).toBe(false);
    expect(calls[1]!.body.get("emailCodeEntered")).toBe("908172");
    expect(calls[1]!.cookie).toBe("PHPSESSID=abc");
    expect(session.cookieHeader).toBe("PHPSESSID=abc; remember=xyz");
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toMatch(/908172|not-a-real-password/);
  });

  it("raises an auth error, without the code, when CleanCloud rejects it", async () => {
    const { fetchImpl } = fakeCleanCloud([
      { body: { doEmailConfirm: true } },
      { body: { error: "Code 908172 is incorrect" } },
    ]);
    const error = await loginCleanCloud({ tenantId: "default", fetchImpl, waitForCode: async () => "908172" }).catch(e => e);
    expect(error).toBeInstanceOf(CleanCloudAuthError);
    expect(error.message).not.toContain("908172");
  });

  it("stops at authenticator 2FA and at an unavailable code", async () => {
    const twoFA = fakeCleanCloud([{ body: { twoFA: true } }]);
    await expect(loginCleanCloud({ tenantId: "default", fetchImpl: twoFA.fetchImpl })).rejects.toBeInstanceOf(CleanCloudAuthError);
    const noCode = fakeCleanCloud([{ body: { doEmailConfirm: true } }]);
    await expect(
      loginCleanCloud({ tenantId: "default", fetchImpl: noCode.fetchImpl, waitForCode: async () => { throw new Error("No CleanCloud verification email arrived in time"); } })
    ).rejects.toBeInstanceOf(CleanCloudAuthError);
    expect(noCode.fetchImpl).toBeDefined();
  });

  it("sanitizes six-digit values from recorded messages", () => {
    expect(sanitizeCleanCloudMessage("bad code 123456")).toBe("bad code ******");
  });
});

describe("automatic retry controls", () => {
  it("pauses automatic attempts after an authentication failure", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(isAuthBackoffActive({ outcome: "direct_auth_failed", createdAt: new Date(now.getTime() - 60_000) }, now)).toBe(true);
    expect(isAuthBackoffActive({ outcome: "direct_auth_failed", createdAt: new Date(now.getTime() - AUTH_FAILURE_BACKOFF_MS - 1) }, now)).toBe(false);
    expect(isAuthBackoffActive({ outcome: "direct_sync_failed", createdAt: now }, now)).toBe(false);
    expect(isAuthBackoffActive(null, now)).toBe(false);
  });
  it("keeps automatic sync off until explicitly enabled", () => {
    const prior = process.env.JAWBREAKER_DIRECT_AUTO_SYNC;
    delete process.env.JAWBREAKER_DIRECT_AUTO_SYNC;
    expect(isDirectAutoSyncEnabled()).toBe(false);
    process.env.JAWBREAKER_DIRECT_AUTO_SYNC = "1";
    expect(isDirectAutoSyncEnabled()).toBe(true);
    if (prior == null) delete process.env.JAWBREAKER_DIRECT_AUTO_SYNC;
    else process.env.JAWBREAKER_DIRECT_AUTO_SYNC = prior;
  });
  it("encrypts stored refresh tokens", () => {
    process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";
    const sealed = encryptGmailToken("1//refresh-token");
    expect(sealed).not.toContain("refresh-token");
    expect(decryptGmailToken(sealed)).toBe("1//refresh-token");
  });
});
