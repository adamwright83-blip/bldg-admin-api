import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { COLD_TEST_ID, investigatorEnv, isColdTestId, newColdTestId, readOnlyFetch } from "./coldTest";

/**
 * The cold-start harness's guards, without a database: what counts as a test id, what the read-only fetch lets
 * through, and that neither the harness nor its operator command can reach anything that sends, activates,
 * disconnects or rewrites a person's connection.
 */
describe("cold-test ids", () => {
  it("are 36 characters, say what they are, and are never a UUID", () => {
    const ids = Array.from({ length: 50 }, () => newColdTestId());
    for (const id of ids) {
      expect(id).toHaveLength(36);
      expect(id).toMatch(COLD_TEST_ID);
      expect(isColdTestId(id)).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
    expect(isColdTestId(randomUUID())).toBe(false);
  });

  it("refuse anything that only looks close", () => {
    for (const id of [
      "",
      "coldtest-",
      "coldtest-%",
      "coldtest-_",
      `coldtest-${"a".repeat(26)}`,
      `coldtest-${"a".repeat(28)}`,
      `COLDTEST-${"a".repeat(27)}`,
      `coldtest-${"g".repeat(27)}`,
      `coldtest-${"a".repeat(26)}'`,
      ` coldtest-${"a".repeat(27)}`,
      `x-coldtest-${"a".repeat(27)}`,
      null,
      undefined,
      42,
    ]) {
      expect(isColdTestId(id)).toBe(false);
    }
  });
});

describe("the read-only fetch", () => {
  const ok = () => vi.fn(async () => new Response("{}", { status: 200 }));

  it("lets reads through", async () => {
    const base = ok();
    const read = readOnlyFetch(base as unknown as typeof fetch);
    await read("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in:sent");
    await read(new URL("https://www.googleapis.com/drive/v3/files"), { method: "GET" });
    await read("https://slack.com/api/search.messages?query=x", { headers: { authorization: "Bearer x" } });
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("lets a token refresh through, and only a refresh", async () => {
    const base = ok();
    const read = readOnlyFetch(base as unknown as typeof fetch);
    await read("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: "r" }).toString() });
    await read("http://127.0.0.1:9/oauth2.googleapis.com/token", { method: "POST", body: "grant_type=refresh_token&refresh_token=r" });
    expect(base).toHaveBeenCalledTimes(2);
    await expect(read("https://oauth2.googleapis.com/token", { method: "POST", body: "grant_type=authorization_code&code=c" })).rejects.toThrow(/only reads/);
    await expect(read("https://oauth2.googleapis.com/token", { method: "POST" })).rejects.toThrow(/only reads/);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("refuses sending, changing, deleting and revoking before anything leaves the process", async () => {
    const base = ok();
    const read = readOnlyFetch(base as unknown as typeof fetch);
    const refused: Array<[string, RequestInit]> = [
      ["https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: "{}" }],
      ["https://gmail.googleapis.com/gmail/v1/users/me/messages/abc/trash", { method: "POST" }],
      ["https://gmail.googleapis.com/gmail/v1/users/me/messages/abc", { method: "DELETE" }],
      ["https://gmail.googleapis.com/gmail/v1/users/me/drafts", { method: "POST", body: "{}" }],
      ["https://www.googleapis.com/drive/v3/files/abc", { method: "PATCH", body: "{}" }],
      ["https://www.googleapis.com/drive/v3/files/abc", { method: "DELETE" }],
      ["https://sheets.googleapis.com/v4/spreadsheets/abc/values/A1", { method: "PUT", body: "{}" }],
      ["https://www.googleapis.com/calendar/v3/calendars/primary/events/abc", { method: "DELETE" }],
      ["https://oauth2.googleapis.com/revoke", { method: "POST", body: "token=t" }],
      ["https://slack.com/api/chat.postMessage", { method: "POST", body: "{}" }],
    ];
    for (const [url, init] of refused) await expect(read(url, init)).rejects.toThrow(/only reads/);
    await expect(read(new Request("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", body: "{}" }))).rejects.toThrow(/only reads/);
    expect(base).not.toHaveBeenCalled();
  });
});

describe("choosing the investigator model", () => {
  it("sets the model the run asked for, and nothing else", () => {
    const base = { JOYSTICK_INVESTIGATOR_MODEL: "claude", OTHER: "kept" };
    expect(investigatorEnv({}, base)).toEqual(base);
    expect(investigatorEnv({ investigator: "gemini", model: "gemini-2.5-pro" }, base)).toMatchObject({ JOYSTICK_INVESTIGATOR_MODEL: "gemini", JOYSTICK_INVESTIGATOR_GEMINI_MODEL: "gemini-2.5-pro", OTHER: "kept" });
    expect(investigatorEnv({ model: "claude-sonnet-5-5" }, base)).toMatchObject({ JOYSTICK_INVESTIGATOR_CLAUDE_MODEL: "claude-sonnet-5-5" });
    expect(investigatorEnv({ investigator: "heuristic" }, base).JOYSTICK_INVESTIGATOR_MODEL).toBe("heuristic");
    expect(base).toEqual({ JOYSTICK_INVESTIGATOR_MODEL: "claude", OTHER: "kept" });
  });
});

describe("what the harness can reach", () => {
  const sources = ["server/businessKnowledge/coldTest.ts", "scripts/onboarding-intelligence-real-account.ts", "scripts/onboarding-cold-test.sh"].map(file => readFileSync(file, "utf8"));
  it("never sends, activates, disconnects, revokes, or writes a person's connection", () => {
    for (const forbidden of [
      "sendDraft",
      "verifyDraft",
      "beginActivation",
      "sendFollowUp",
      "disconnectProvider",
      "forgetConnection",
      "revokeGoogleToken",
      "saveConnection",
      "updateAccessToken",
      "googleAccessFor",
      "keepPortrait",
      "answerFinding",
      "bindKnowledgeTenant",
      "forgetKnowledge",
      "createJourney",
      "setJourneyStage",
      "railway variable set",
      "railway up",
    ]) {
      for (const source of sources) expect(source).not.toContain(forbidden);
    }
  });
});
