import { describe, expect, it, vi } from "vitest";
import { FIRST_READ_DEADLINE_MS } from "../../../shared/firstTenMinutes";
import { beginFirstRead, firstReadOn, runFirstRead, viewOf } from "./firstRead";
import { firstReadHolds } from "../../../client/src/pages/firstTenMinutes/useFirstRead";

const started = new Date("2026-11-02T10:00:00Z");

describe("the first read", () => {
  it("is off unless JOYSTICK_FIRST_READ_REVEAL is on, and then never touches the database for an example journey", async () => {
    expect(firstReadOn({})).toBe(false);
    expect(firstReadOn({ JOYSTICK_FIRST_READ_REVEAL: "preview" })).toBe(false);
    expect(firstReadOn({ JOYSTICK_FIRST_READ_REVEAL: " ON " })).toBe(true);
    const journey = { id: "j1", kind: "own" } as never;
    expect(await beginFirstRead(journey, { startedAt: started, ownerName: "Sam", ownerEmail: "sam@x.example" }, {})).toBe(false);
    expect(await beginFirstRead({ id: "j2", kind: "example" } as never, { startedAt: started, ownerName: null, ownerEmail: "" }, { JOYSTICK_FIRST_READ_REVEAL: "on", GEMINI_API_KEY: "k" })).toBe(false);
    expect(await beginFirstRead(journey, { startedAt: started, ownerName: null, ownerEmail: "" }, { JOYSTICK_FIRST_READ_REVEAL: "on" })).toBe(false);
    // a Google connection made later (after Slack, at the portrait) never pays for lines nobody will see
    const on = { JOYSTICK_FIRST_READ_REVEAL: "on", GEMINI_API_KEY: "k" };
    for (const stage of ["crew", "portrait", "chapter", "first_chapter"]) {
      expect(await beginFirstRead({ id: "j3", kind: "own", stage } as never, { startedAt: started, ownerName: null, ownerEmail: "" }, on)).toBe(false);
    }
  });

  it("shows the browser only the lines, only once revealed; a run whose server went away reads as failed", () => {
    const row = { status: "revealed" as const, startedAt: started, revealJson: { lines: ["One.", "Two."], readyMs: 46_000 } };
    expect(viewOf(row, started.getTime() + 50_000)).toEqual({ status: "revealed", lines: ["One.", "Two."], elapsedMs: 50_000, deadlineMs: FIRST_READ_DEADLINE_MS });
    expect(viewOf({ ...row, status: "empty" }, started.getTime() + 50_000).lines).toEqual([]);
    expect(viewOf({ ...row, status: "running", revealJson: null }, started.getTime() + 30_000).status).toBe("running");
    expect(viewOf({ ...row, status: "running", revealJson: null }, started.getTime() + 5 * 60_000).status).toBe("failed");
  });

  it("holds the crew while the lines may still come, and while they are read; never past the deadline", () => {
    const view = (status: "off" | "running" | "revealed" | "empty" | "failed", elapsedMs: number, lines: string[] = []) => ({ status, lines, elapsedMs, deadlineMs: FIRST_READ_DEADLINE_MS });
    expect(firstReadHolds(null, false)).toBe(false);
    expect(firstReadHolds(view("off", 0), false)).toBe(false);
    expect(firstReadHolds(view("running", 30_000), false)).toBe(true);
    expect(firstReadHolds(view("running", FIRST_READ_DEADLINE_MS + 1), false)).toBe(false);
    expect(firstReadHolds(view("revealed", 48_000, ["a", "b"]), false)).toBe(true);
    expect(firstReadHolds(view("revealed", 48_000, ["a", "b"]), true)).toBe(false);
    expect(firstReadHolds(view("empty", 48_000), false)).toBe(false);
    expect(firstReadHolds(view("failed", 48_000), false)).toBe(false);
  });

  it("says nothing about a nearly empty account, and spends nothing on it", async () => {
    // Gmail and Drive answer, with nothing in them
    const google = vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes("drive") ? { files: [] } : { messages: [], resultSizeEstimate: 0 }), { status: 200 }));
    const gemini = vi.fn();
    const saved: unknown[] = [];
    const status = await runFirstRead({
      startedAt: new Date(),
      ownerName: "New Person",
      ownerEmail: "new.person@mail.example",
      access: { accessToken: "a", refreshToken: null, accessExpiresAt: new Date(Date.now() + 3_600_000), grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.readonly"], ownerEmail: "new.person@mail.example", onRefreshed: async () => undefined },
      gemini: { apiKey: "k", model: "m", fetch: gemini as unknown as typeof fetch },
      fetch: google as unknown as typeof fetch,
      save: async patch => void saved.push(patch),
    });
    expect(status).toBe("empty");
    expect(gemini).not.toHaveBeenCalled();
    expect(saved).toEqual([expect.objectContaining({ status: "empty", timingsJson: expect.objectContaining({ retrieved: expect.any(Number) }) })]);
  });
});
