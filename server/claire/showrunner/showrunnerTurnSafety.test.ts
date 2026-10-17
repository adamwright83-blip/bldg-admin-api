import { describe, expect, it, vi } from "vitest";
import { isUnambiguousAgreement, runShowrunnerTurn, type ShowrunnerCallState } from "./showrunnerTurn";

const state = (over: Partial<ShowrunnerCallState> = {}): ShowrunnerCallState => ({
  purpose: "evening_debrief",
  tenantId: "t", canonicalOperatorId: "op", operatorUserId: "u", dayDirectorActorId: "1", dayDirectorActorIds: ["1"],
  timeZone: "America/Los_Angeles", businessDate: "2026-10-20",
  briefing: { purpose: "evening_debrief", businessDate: "2026-10-20", weekday: "Tuesday", objective: "x", weekPlan: null, today: [], tomorrow: [], developments: [], pendingDecision: null, adaptations: [], uncertain: [], weekToDate: { reportedOutcomes: [], planChanges: [] } },
  captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
  replan: null, turns: 0,
  ...over,
});
const model = (json: object) => (async () => ({ choices: [{ message: { content: JSON.stringify(json) } }] })) as never;
const quiet = { speak: "Okay.", operatorIsDone: false, missionUpdates: [], developments: [], readinessNeeds: [] };

describe("unambiguous agreement only", () => {
  it.each(["Yes", "Yes, lock it in.", "Sure, lock it in", "Yes, go ahead and update it.", "yeah", "Yes please", "Go ahead"])("approves: %s", u =>
    expect(isUnambiguousAgreement(u)).toBe(true));
  it.each(["Yes, but not Thursday", "Yes, except Maria", "Yeah, actually move it to Friday", "Yes?", "Yes, Thursday works better", "No", "Not yet", "Sure, but only the first one", "Yes, wait"])("does not approve: %s", u =>
    expect(isUnambiguousAgreement(u)).toBe(false));

  it("a qualified yes to a pending revision does not approve it", async () => {
    const approve = vi.fn(async () => "approved");
    const s = state({ replan: { proposalId: "p", revision: "r", summary: "Thu Maria", approved: false, askedTurn: 1 }, turns: 1 });
    const out = await runShowrunnerTurn({ state: s, history: [], utterance: "Yes, but not Thursday", sourceEventId: "e", conversationKey: "k",
      invoke: model({ ...quiet, speak: "Which day works instead?" }), record: async () => undefined, approve, replan: async () => null });
    expect(approve).not.toHaveBeenCalled();
    expect(out.state.replan?.approved).toBe(false);
  });

  it("a plain yes approves exactly the pending revision", async () => {
    const approve = vi.fn(async () => "1 approved item(s) added and verified in the Day Line: Meet Maria.");
    const s = state({ replan: { proposalId: "p", revision: "r", summary: "Thu Maria", approved: false, askedTurn: 1 }, turns: 1 });
    const out = await runShowrunnerTurn({ state: s, history: [], utterance: "Yes, lock it in.", sourceEventId: "e", conversationKey: "k",
      invoke: model(quiet), record: async () => undefined, approve });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(out.speak).toContain("verified in the Day Line");
  });
});

describe("persistence before memory", () => {
  it("a failed save is retried, then reported honestly with nothing remembered or replanned", async () => {
    const record = vi.fn(async () => { throw new Error("db down"); });
    const replan = vi.fn(async () => ({ proposalId: "p", revision: "r", summary: "s" }));
    const out = await runShowrunnerTurn({ state: state(), history: [], utterance: "Maria wants to meet Thursday at 10.", sourceEventId: "e", conversationKey: "k",
      invoke: model({ ...quiet, speak: "Noted, Maria Thursday at 10.", operatorIsDone: true, developments: [{ kind: "meeting", who: "Maria", what: "meet", date: "2026-10-22", time: "10:00", window: "morning", place: "", operatorWords: "Thursday at 10" }] }),
      record, replan });
    expect(record).toHaveBeenCalledTimes(2);
    expect(out.speak).toMatch(/couldn't save that/);
    expect(out.speak).not.toMatch(/Noted/);
    expect(out.state.captured.developments).toEqual([]);
    expect(replan).not.toHaveBeenCalled();
  });

  it("a save that succeeds on retry is remembered", async () => {
    let n = 0;
    const record = vi.fn(async () => { if (n++ === 0) throw new Error("blip"); });
    const out = await runShowrunnerTurn({ state: state(), history: [], utterance: "Maria Thursday at 10.", sourceEventId: "e", conversationKey: "k",
      invoke: model({ ...quiet, developments: [{ kind: "meeting", who: "Maria", what: "meet", date: "2026-10-22", time: "10:00", window: "morning", place: "", operatorWords: "Thursday at 10" }] }),
      record, replan: async () => null });
    expect(out.state.captured.developments).toHaveLength(1);
  });
});


describe("work ledger is the only work interpreter", () => {
  it.each(["morning_readiness", "evening_debrief", "desk_planning"] as const)(
    "%s preserves the original statement without saving inferred work", async purpose => {
      const record = vi.fn(async () => undefined);
      const replan = vi.fn();
      const deskReplan = vi.fn();
      const s = state({ purpose });
      s.briefing.today = [{ id: "existing", title: "Existing work" } as never];
      const out = await runShowrunnerTurn({
        state: s, history: [], utterance: "That is advertising copy, not another task.",
        sourceEventId: "e", conversationKey: "k", workLedger: { section: null },
        invoke: model({ ...quiet, speak: "I saved the pickup for tomorrow.", operatorIsDone: true,
          missionUpdates: [{ itemId: "existing", outcome: "done" }],
          developments: [{ kind: "commitment", who: "operator", what: "Pick up tomorrow", date: "2026-10-21", time: "", window: "", place: "", operatorWords: "advertising copy" }],
          readinessNeeds: ["Prepare invented pickup"],
          planEdits: [{ itemId: "existing", action: "hold", time: "" }],
        }), record, replan, deskReplan,
      });
      expect(record).toHaveBeenCalledWith(expect.objectContaining({
        utterance: "That is advertising copy, not another task.",
        updates: [], developments: [], preparation: [],
      }));
      expect(out.state.captured).toEqual({ missionUpdates: [], developments: [], readinessNeeds: [] });
      expect(out.speak).not.toContain("I saved");
      expect(out.speak).toContain("Nothing new is confirmed saved");
      expect(replan).not.toHaveBeenCalled();
      expect(deskReplan).not.toHaveBeenCalled();
    }
  );

  it("does not approve a leftover Showrunner revision while the ledger owns work", async () => {
    const approve = vi.fn();
    const s = state({ replan: { proposalId: "p", revision: "r", summary: "stale work", approved: false, askedTurn: 1 }, turns: 1 });
    await runShowrunnerTurn({ state: s, history: [], utterance: "Yes, lock it in.",
      sourceEventId: "e", conversationKey: "k", workLedger: { section: null },
      invoke: model(quiet), record: async () => undefined, approve });
    expect(approve).not.toHaveBeenCalled();
  });
});
