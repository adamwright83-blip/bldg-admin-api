/**
 * The 2026-10-23 morning call (conversation f7b1344f), replayed with its real utterances.
 *
 *  1. "I have 3 pickups … 2 pickups due by 10AM, and then 1 pickup … at 10AM or at noon": captured as two
 *     commitments for today, then held behind "Want me to lock that in?" as "Follow up: Two pickups…".
 *     They now land on the Day Line as the operator's own instruction and are read back.
 *  2. "Since yesterday: Visit three locations in person tomorrow… (2026-10-21)": a two-day-old note with
 *     an ISO date. Only yesterday's reports about today or later are spoken, with a day word.
 *  3. "Did you drop off thomas hartmanns order in Hollywood. Then write 5 notes…?" answered "Yes": one
 *     question about two jobs. It is now asked as "Did you do both: …".
 */
import { describe, expect, it, vi } from "vitest";
import { agendaQuestion } from "../../dayLine/openItemLifecycle";
import { sinceYesterdayLine } from "../../showrunner/showrunnerBriefing";
import { landReportedCommitments, reportedWorkTitle, speakLandedWork } from "../../showrunner/reportedWork";
import { runShowrunnerTurn, type ShowrunnerCallState } from "../../showrunner/showrunnerTurn";

const UTTERANCE =
  "I actually do. I I need printed collateral, so I will have to finalize it on my computer, and then I will have to go to Staples. And then, also, forgot to mention this. I have 3 pickups. I have 1 uh, 2 pickups due by 10AM, and then I have 1 pickup that I can pick up right at 10AM as well or at noon or something. I forgot, but it doesn't matter.";

// The two developments the model captured on the real call (daphne_observations, 2026-10-23 14:32Z).
const CAPTURED = [
  { kind: "commitment", who: "", what: "Two pickups due by 10 AM", date: "2026-10-23", time: "10:00", window: "morning", place: "", operatorWords: "I have 1, 2 pickups due by 10AM" },
  { kind: "commitment", who: "", what: "One pickup at 10 AM or around noon", date: "2026-10-23", time: "", window: "morning", place: "", operatorWords: "I have 1 pickup that I can pick up right at 10AM as well or at noon or something" },
] as const;

function callState(): ShowrunnerCallState {
  return {
    purpose: "morning_readiness",
    tenantId: "default",
    canonicalOperatorId: "op",
    operatorUserId: "adam-admin",
    dayDirectorActorId: "1",
    dayDirectorActorIds: ["1"],
    timeZone: "America/Los_Angeles",
    businessDate: "2026-10-23",
    briefing: {
      purpose: "morning_readiness", businessDate: "2026-10-23", weekday: "Friday", objective: "Get to 50 active customers", weekPlan: null,
      today: [], tomorrow: [], developments: [], pendingDecision: null, adaptations: [], uncertain: [], weekToDate: { reportedOutcomes: [], planChanges: [] },
      driverDayLine: { read: "read", businessDate: "2026-10-23", stops: [], designatedMission: null, fieldBlockers: [], pendingApproval: [], omissions: [] },
    },
    captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
    replan: null,
    turns: 2,
    openItemHandled: true,
  } as unknown as ShowrunnerCallState;
}

function dayLine() {
  const rows: Array<{ id: string; title: string; status: string; businessDate: string; promptKey: string; admission: any }> = [];
  const accept = vi.fn(async (input: any) => {
    const existing = rows.find(r => r.promptKey === input.proposal.promptKey);
    if (existing) return { stored: existing, created: false };
    const row = { id: `c${rows.length + 1}`, title: input.proposal.title, status: "open", businessDate: input.businessDate, promptKey: input.proposal.promptKey, admission: input.admission };
    rows.push(row);
    return { stored: row, created: true };
  });
  const readState = vi.fn(async (input: any) => ({ commitments: rows.filter(r => r.businessDate === input.businessDate) }));
  return { rows, accept, readState };
}

async function turn(line: ReturnType<typeof dayLine>, state = callState()) {
  const replan = vi.fn(async () => ({ proposalId: "p", revision: "r", summary: "Here's the revised plan: …" }));
  const result = await runShowrunnerTurn({
    state,
    history: [],
    utterance: UTTERANCE,
    sourceEventId: "e6",
    conversationKey: "claire-call:f7b1344f",
    invoke: vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({
        speak: "Got it: finalize the collateral, then Staples. Do the two 10 AM pickups first.",
        operatorIsDone: false,
        missionUpdates: [],
        developments: CAPTURED,
        readinessNeeds: [],
        planEdits: [],
      }) } }],
    })) as never,
    record: vi.fn(async () => undefined) as never,
    salesHold: vi.fn(async () => null) as never,
    replan: replan as never,
    landReported: (input => landReportedCommitments({ ...input, deps: { accept: line.accept as never, readState: line.readState as never } })) as never,
  });
  return { result, replan };
}

describe("1. the operator's reported pickups land on the Day Line", () => {
  it("titles them as the work, never 'Follow up: …'", () => {
    expect(CAPTURED.map(d => reportedWorkTitle(d))).toEqual(["Two pickups due by 10 AM", "One pickup at 10 AM or around noon"]);
    expect(reportedWorkTitle({ who: "Dana", what: "call", place: "" })).toBe("Call with Dana");
    expect(reportedWorkTitle({ who: "me", what: "drop off the comforter", place: "The Louise" })).toBe("Drop off the comforter at The Louise");
  });

  it("writes both as an operator instruction, reads them back, and proposes nothing", async () => {
    const line = dayLine();
    const { result, replan } = await turn(line);
    expect(line.rows.map(r => [r.title, r.businessDate])).toEqual([
      ["Two pickups due by 10 AM", "2026-10-23"],
      ["One pickup at 10 AM or around noon", "2026-10-23"],
    ]);
    expect(line.rows[0]!.admission).toMatchObject({ kind: "operator_instruction", surface: "claire_turn", operatorUserId: "adam-admin" });
    expect(result.speak).toContain("Added to today's Day Line: two pickups due by 10 AM, and one pickup at 10 AM or around noon.");
    expect(result.speak).not.toMatch(/lock that in|Follow up:/);
    expect(replan).not.toHaveBeenCalled();
    expect(result.state.replan).toBeNull();
  });

  it("the same words on the same call land once", async () => {
    const line = dayLine();
    const first = await turn(line);
    await turn(line, first.result.state);
    expect(line.rows).toHaveLength(2);
  });

  it("an unverified write is said plainly", async () => {
    const line = dayLine();
    line.accept.mockRejectedValue(new Error("Database not available"));
    const { result } = await turn(line);
    expect(result.speak).toContain("I couldn't confirm two pickups due by 10 AM, and one pickup at 10 AM or around noon on the Day Line, so add them in the app.");
    expect(result.speak).not.toContain("Added to");
  });

  it("speaks another day's line by name", () => {
    expect(speakLandedWork([{ title: "Pick up from Forrest", businessDate: "2026-10-24", verified: true }], "2026-10-23")).toBe(
      "Added to tomorrow's Day Line: pick up from Forrest."
    );
  });
});

describe("2. 'Since yesterday' is yesterday's news, in words", () => {
  const b = (developments: any[]) => ({ businessDate: "2026-10-23", developments });
  it("drops a two-day-old note and an ISO date", () => {
    const stale = { summary: "Visit three locations in person tomorrow (2026-10-21)", spoken: "Visit three locations in person tomorrow", date: "2026-10-21", reportedOn: "2026-10-21", kind: "commitment" };
    expect(sinceYesterdayLine(b([stale]))).toBe("");
  });
  it("speaks yesterday's report about today or later with a day word", () => {
    const meeting = { summary: "Dana: coffee at The Louise (2026-10-24 09:00)", spoken: "Dana: coffee at The Louise", date: "2026-10-24", reportedOn: "2026-10-22", kind: "meeting" };
    expect(sinceYesterdayLine(b([meeting]))).toBe("Since yesterday: Dana: coffee at The Louise, tomorrow.");
  });
  it("a reported commitment is on the Day Line already, so the opening does not repeat it", () => {
    expect(sinceYesterdayLine(b([{ summary: "Two pickups", spoken: "Two pickups", date: "2026-10-23", reportedOn: "2026-10-22", kind: "commitment" }]))).toBe("");
  });
});

describe("3. one question per job", () => {
  it("asks a two-job item as 'both'", () => {
    expect(agendaQuestion("drop off thomas hartmanns order in Hollywood. Then write 5 notes and mail them to customers to retain business")).toBe(
      "Did you do both: drop off thomas hartmanns order in Hollywood, and write 5 notes and mail them to customers to retain business?"
    );
    expect(agendaQuestion("Call Dana to resolve the overdue Louise follow-up")).toBe("Did you call Dana?");
  });
});
