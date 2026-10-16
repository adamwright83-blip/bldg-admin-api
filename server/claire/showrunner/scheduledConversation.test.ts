import { describe, expect, it, vi } from "vitest";
import { runScheduledClaireTurn } from "./scheduledConversation";
import { type ShowrunnerCallState } from "./showrunnerTurn";
import { type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";
import { safeClaireBrainV3Fallback, type ClaireBrainV3Interpretation } from "../turn/brainV3";
import { parseBriefingDeterministically } from "../briefing/deterministicBriefing";
import { briefingClock } from "../briefing/briefingTiming";

const now = new Date("2026-10-16T00:30:00Z");
const clock = briefingClock(now, "America/Los_Angeles");
function fixture(purpose: "morning_readiness" | "evening_debrief") {
  const showrunner: ShowrunnerCallState = {
    purpose, tenantId: "t", canonicalOperatorId: "op", operatorUserId: "u", dayDirectorActorId: "1", dayDirectorActorIds: ["1"],
    timeZone: "America/Los_Angeles", businessDate: clock.today, turns: 0, replan: null,
    briefing: { purpose, businessDate: clock.today, weekday: "Thursday", objective: "x", weekPlan: null, today: [], tomorrow: [], developments: [], pendingDecision: null, adaptations: [], uncertain: [], weekToDate: { reportedOutcomes: [], planChanges: [] } },
    captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
  };
  let semantic: ClaireBrainV3Interpretation = { ...safeClaireBrainV3Fallback(), act: "narration" };
  const commit = vi.fn(async (parsed: ReturnType<typeof parseBriefingDeterministically>) => ({ added: parsed.items, completed: [], failed: [],
    commitmentIds: parsed.items.map((_, i) => `c-${i}`), receipts: parsed.items.map((item, i) => ({ claimedState: "created" as const, entityId: `c-${i}`, statement: item.title })) }));
  const turn: Partial<ClaireTurnDeps> = { now: () => now, timeZone: () => "America/Los_Angeles", brainV3: async () => semantic,
    business: { plan: async () => null }, commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
    followUp: async () => "Still here.", extractModel: async input => ({ ...parseBriefingDeterministically(input.utterance, clock), source: "model" }),
    commit: commit as never, loadExisting: async () => [], vocabulary: async () => [], accounts: async () => [], campaign: async () => null,
    searchMemory: async () => [], memoryBetween: async () => [], encyclopedia: null, watchBoard: undefined, doctrineTurn: undefined,
  };
  const record = vi.fn(async () => undefined);
  const invoke = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify({ speak: "Got it.", operatorIsDone: false, missionUpdates: [], developments: [], readinessNeeds: [], planEdits: [] }) } }] }));
  const state: ClaireTurnState & { showrunner: ShowrunnerCallState } = { showrunner };
  const run = (utterance: string) => runScheduledClaireTurn({ tenantId: "t", operatorUserId: "u", dayDirectorActorId: "1",
    surface: "voice", utterance, state, conversationKey: "scheduled-test", allowFragmentWait: false },
    { turn, showrunner: { invoke: invoke as never, record, now } });
  return { state, run, commit, record, invoke, interpret: (value: Partial<ClaireBrainV3Interpretation>) => { semantic = { ...safeClaireBrainV3Fallback(), ...value }; } };
}

for (const purpose of ["morning_readiness", "evening_debrief"] as const) describe(`${purpose} shared conversation`, () => {
  it("keeps work across narrative turns and commits only after approval, including after serialization", async () => {
    const f = fixture(purpose);
    await f.run("I'm at Lugos Lavanderia, our processing center.");
    f.interpret({ act: "work_commitment", workDisposition: "propose" });
    await f.run("I have to deliver two dry cleaning orders tonight.");
    expect(f.state.pendingBriefing?.parsed.items).toHaveLength(1);
    expect(f.commit).not.toHaveBeenCalled();
    f.interpret({ act: "narration" });
    await f.run("It's been a long day.");
    Object.assign(f.state, JSON.parse(JSON.stringify(f.state)));
    f.interpret({ act: "confirmation", target: "pending_briefing", workDisposition: "commit", dayLineDisposition: "accept" });
    const result = await f.run("Yes.");
    expect(f.commit).toHaveBeenCalledOnce();
    expect(result.speak).toContain("dry cleaning");
    expect(f.state.history?.filter(h => h.speaker === "operator").map(h => h.text)).toEqual([
      "I'm at Lugos Lavanderia, our processing center.", "I have to deliver two dry cleaning orders tonight.", "It's been a long day.", "Yes.",
    ]);
    expect(f.state.pendingBriefing).toBeNull();
  });

  it("keeps accepted speech after the scheduled recorder fails without claiming a save", async () => {
    const f = fixture(purpose);
    f.record.mockRejectedValue(new Error("database unavailable"));
    const result = await f.run("The customer wants to meet Thursday.");
    expect(f.state.history?.some(h => h.speaker === "operator" && h.text === "The customer wants to meet Thursday.")).toBe(true);
    expect(result.speak).toMatch(/couldn't save/);
    expect(f.state.showrunner.captured.developments).toEqual([]);
    expect(result.endCall).not.toBe(true);
  });
});
