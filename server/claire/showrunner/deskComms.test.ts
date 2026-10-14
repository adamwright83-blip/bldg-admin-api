import { describe, expect, it, vi } from "vitest";
import { runShowrunnerTurn, type ShowrunnerCallState } from "./showrunnerTurn";
import { spokenTime, windowForTime } from "./deskPlanEdits";

const briefingItem = (id: string, title: string) => ({ id, title, objective: null, status: "open" as const, window: "Morning", note: null });
const desk = (over: Partial<ShowrunnerCallState> = {}): ShowrunnerCallState => ({
  purpose: "desk_planning",
  tenantId: "t", canonicalOperatorId: "op", operatorUserId: "u", dayDirectorActorId: "1", dayDirectorActorIds: ["1"],
  timeZone: "America/Los_Angeles", businessDate: "2026-10-14",
  briefing: {
    purpose: "desk_planning", businessDate: "2026-10-14", weekday: "Wednesday", objective: "maximize sales in Silver Lake", weekPlan: null,
    today: [], tomorrow: [briefingItem("c1", "Call lapsed customers"), briefingItem("c2", "Louise follow-up")],
    developments: [],
    pendingDecision: { proposalId: "p", revision: "r", summary: "s", items: [{ id: "d1", date: "2026-10-15", title: "Win back lapsed Silver Lake customers", window: null }] },
    adaptations: [], uncertain: [], weekToDate: { reportedOutcomes: [], planChanges: [] },
  },
  captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
  replan: null, turns: 0,
  ...over,
});
const model = (json: object) => (async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] })) as never;
const base = { speak: "Got it.", operatorIsDone: false, missionUpdates: [], developments: [], readinessNeeds: [], planEdits: [] };
const UTTER = "Claire, actually, move those calls to 10 tomorrow. I'm not sure about the Louise follow-up. And remind me to bring the customer list.";

describe("OPEN COMMS desk planning", () => {
  it("the example utterance: retime asks for approval of exactly that item, the hold is not cancelled, the reminder is saved", async () => {
    const record = vi.fn(async () => undefined);
    const deskReplan = vi.fn(async (_s: ShowrunnerCallState, edits: unknown[]) => ({
      proposalId: "p2", revision: "r2", itemIds: ["2026-10-15:retime:c1:10:00"],
      summary: "Call lapsed customers moves to tomorrow at 10 AM. Louise follow-up is already on your Day Line, so it stays there for now.",
      edits,
    }));
    const out = await runShowrunnerTurn({
      state: desk(), history: [], utterance: UTTER, sourceEventId: "e1", conversationKey: "k",
      invoke: model({
        ...base,
        readinessNeeds: ["the customer list"],
        planEdits: [
          { itemId: "c1", action: "retime", date: "", time: "10:00", window: "morning", operatorWords: "move those calls to 10 tomorrow" },
          { itemId: "c2", action: "hold", date: "", time: "", window: "none", operatorWords: "not sure about the Louise follow-up" },
          { itemId: "invented", action: "retime", date: "", time: "10:00", window: "morning", operatorWords: "x" },
          { itemId: "c1", action: "retime", date: "", time: "25:99", window: "none", operatorWords: "bad time" },
        ],
      }),
      record, deskReplan,
    });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ preparation: ["the customer list"] }));
    const edits = deskReplan.mock.calls[0]![1] as Array<{ itemId: string }>;
    expect(edits.map(e => e.itemId)).toEqual(["c1", "c2"]);
    expect(out.speak).toMatch(/Want me to lock that in\?$/);
    expect(out.state.replan).toMatchObject({ proposalId: "p2", approved: false, itemIds: ["2026-10-15:retime:c1:10:00"] });
    expect(out.saved).toEqual(["Reminder saved: the customer list"]);
  });

  it("an ambiguous reply never approves; a plain yes approves only the asked scope", async () => {
    const approve = vi.fn(async () => "1 approved item(s) added and verified in the Day Line: Call lapsed customers.");
    const asked = desk({ turns: 1, replan: { proposalId: "p2", revision: "r2", summary: "s", approved: false, askedTurn: 1, itemIds: ["x"] } });
    for (const u of ["Yes, but make it 11", "maybe", "Yes?"]) {
      const out = await runShowrunnerTurn({ state: asked, history: [], utterance: u, sourceEventId: "e", conversationKey: "k",
        invoke: model(base), record: async () => undefined, approve, deskReplan: async () => null });
      expect(out.state.replan?.approved).toBe(false);
    }
    expect(approve).not.toHaveBeenCalled();
    const yes = await runShowrunnerTurn({ state: asked, history: [], utterance: "Yes, lock it in.", sourceEventId: "e", conversationKey: "k",
      invoke: model(base), record: async () => undefined, approve });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(yes.saved?.[0]).toContain("verified in the Day Line");
    expect(yes.end).toBe(false);
  });

  it("a failed approval write is reported as unchanged, never as done", async () => {
    const asked = desk({ turns: 1, replan: { proposalId: "p2", revision: "r2", summary: "s", approved: false, askedTurn: 1, itemIds: ["x"] } });
    const out = await runShowrunnerTurn({ state: asked, history: [], utterance: "Yes", sourceEventId: "e", conversationKey: "k",
      invoke: model(base), record: async () => undefined, approve: async () => null });
    expect(out.speak).toMatch(/couldn't save that approval/);
    expect(out.saved ?? []).toEqual([]);
  });

  it("when the turn cannot be saved nothing is replanned or reported saved", async () => {
    const deskReplan = vi.fn();
    const out = await runShowrunnerTurn({ state: desk(), history: [], utterance: UTTER, sourceEventId: "e", conversationKey: "k",
      invoke: model({ ...base, readinessNeeds: ["the customer list"], planEdits: [{ itemId: "c1", action: "retime", date: "", time: "10:00", window: "morning", operatorWords: "10" }] }),
      record: async () => { throw new Error("db down"); }, deskReplan: deskReplan as never });
    expect(deskReplan).not.toHaveBeenCalled();
    expect(out.saved ?? []).toEqual([]);
    expect(out.speak).toMatch(/couldn't save that/);
  });

  it("phone calls ignore plan edits", async () => {
    const deskReplan = vi.fn();
    await runShowrunnerTurn({ state: desk({ purpose: "evening_debrief" }), history: [], utterance: "move it", sourceEventId: "e", conversationKey: "k",
      invoke: model({ ...base, planEdits: [{ itemId: "c1", action: "retime", date: "", time: "10:00", window: "morning", operatorWords: "10" }] }),
      record: async () => undefined, deskReplan: deskReplan as never, replan: async () => null });
    expect(deskReplan).not.toHaveBeenCalled();
  });

  it("times read back plainly", () => {
    expect(spokenTime("10:00")).toBe("10 AM");
    expect(spokenTime("14:30")).toBe("2:30 PM");
    expect(windowForTime("10:00", "none")).toBe("morning");
    expect(windowForTime("18:00", "none")).toBe("evening");
  });
});
