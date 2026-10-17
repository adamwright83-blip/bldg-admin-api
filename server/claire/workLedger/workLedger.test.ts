import { describe, expect, it } from "vitest";
import { validateWorkLedgerPlan, groundedInOperatorWords, type WorkLedgerPlanInput } from "./workLedgerPlanner";
import { applyWorkLedgerPlan, speakVerifiedLedgerChanges } from "./workLedgerApply";
import { cleanLedgerReply, runWorkLedgerTurn, workLedgerPromptSection } from "./workLedgerTurn";
import { createFakeDayLine } from "./workLedgerTestDayLine";
import { daphneRelationshipEventFor } from "./workLedgerSignals";
import { describePriorCalls } from "./callContinuity";
import type { ClaireTurnState } from "../turn/claireTurn";

const TODAY = "2026-10-15";
const TOMORROW = "2026-10-16";
const clock = { today: TODAY, tomorrow: TOMORROW, localTime: "5:31 PM", timeZone: "America/Los_Angeles" };

function planInput(overrides: Partial<WorkLedgerPlanInput> = {}): WorkLedgerPlanInput {
  return {
    tenantId: "default",
    utterance: "I have 3 dry cleaning orders. I need to see if those have been charged yet. If not, I need to charge them. I need to deliver 2 of them tonight.",
    transcript: [],
    dayLine: [],
    held: [],
    clock,
    sessionKind: "pre_drive",
    callFacts: [],
    ...overrides,
  };
}

const EMPTY_RAW = {
  workChanged: true,
  endCall: false,
  held: [],
  edits: [],
  completeIds: [],
  confirmIds: [],
  removeIds: [],
  reply: "",
  operatorSignal: { kind: "none" as const, about: "", quote: "" },
};

function heldItem(overrides: Record<string, string | boolean> = {}) {
  return {
    ref: "new-1",
    title: "Deliver 2 dry cleaning orders tonight",
    day: "today" as "today" | "tomorrow" | "date",
    date: "",
    timing: "tonight",
    executionType: "none" as const,
    detail: "",
    quote: "I need to deliver 2 of them tonight.",
    save: false,
    ...overrides,
  };
}

/** An invoke stub that returns one canned plan per call, in order. */
function scriptedInvoke(plans: unknown[]) {
  let index = 0;
  const calls: string[] = [];
  const invoke = (async (params: { messages: Array<{ content: unknown }> }) => {
    calls.push(String(params.messages.at(-1)?.content ?? ""));
    const plan = plans[Math.min(index, plans.length - 1)];
    index += 1;
    return { id: "x", created: 0, model: "stub", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(plan) }, finish_reason: "tool_use" }] };
  }) as never;
  return { invoke, calls };
}

describe("work ledger validation — the server's half of the contract", () => {
  it("keeps grounded work and gives held items stable server refs", () => {
    const plan = validateWorkLedgerPlan({ ...EMPTY_RAW, held: [heldItem({ save: true })] }, planInput(), 1);
    expect(plan.held).toHaveLength(1);
    expect(plan.held[0]!.ref).toBe("w1");
    expect(plan.saveRefs).toEqual(["w1"]);
    expect(plan.held[0]!.businessDate).toBe(TODAY);
    expect(plan.nextRef).toBe(2);
  });

  it("refuses a quote the operator never said", () => {
    const plan = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ title: "Call Greystar about renewal", quote: "Call Greystar about the renewal contract" })] },
      planInput(),
      1
    );
    expect(plan.held).toEqual([]);
    expect(plan.refused.join(" ")).toMatch(/not in the operator's words/);
  });

  it("refuses tomorrow when nobody said tomorrow (dates inside ad copy are not work dates)", () => {
    const plan = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ day: "tomorrow" })] },
      planInput(),
      1
    );
    expect(plan.held).toEqual([]);
    expect(plan.refused.join(" ")).toMatch(/tomorrow without the operator saying tomorrow/);
  });

  it("accepts tomorrow when the operator placed it there", () => {
    const plan = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ title: "Deliver third dry cleaning order", day: "tomorrow", quote: "And 1 of them tomorrow morning.", timing: "tomorrow morning" })] },
      planInput({
        utterance: "And 1 of them tomorrow morning.",
        transcript: [{ speaker: "operator", text: "I have 3 dry cleaning orders. I need to deliver 2 of them tonight." }],
      }),
      1
    );
    expect(plan.held[0]!.businessDate).toBe(TOMORROW);
  });

  it("refuses edits, completions and removals of ids that are not on the Day Line", () => {
    const plan = validateWorkLedgerPlan(
      {
        ...EMPTY_RAW,
        edits: [{ id: "ghost", title: "Something", executionType: "challenge", detail: "", timing: "", moveTo: "", date: "" }],
        completeIds: ["ghost"],
        removeIds: [{ id: "ghost", reason: "" }],
        confirmIds: ["ghost"],
      },
      planInput(),
      1
    );
    expect(plan.edits).toEqual([]);
    expect(plan.completeIds).toEqual([]);
    expect(plan.removeIds).toEqual([]);
    expect(plan.confirmIds).toEqual([]);
    expect(plan.refused).toHaveLength(4);
  });

  it("drops the reply on non-work turns so the conversational pipeline answers", () => {
    const plan = validateWorkLedgerPlan({ ...EMPTY_RAW, workChanged: false, reply: "We did 41 orders." }, planInput(), 1);
    expect(plan.reply).toBe("");
  });

  it("only records a signal grounded in the newest utterance", () => {
    const echo = validateWorkLedgerPlan(
      { ...EMPTY_RAW, operatorSignal: { kind: "declined_topic", about: "the Louise follow-up", quote: "I don't wanna talk about it." } },
      planInput({ utterance: "I'm at Lugos Lavanderia.", transcript: [{ speaker: "operator", text: "I don't wanna talk about it." }] }),
      1
    );
    expect(echo.operatorSignal.kind).toBe("none");
    const fresh = validateWorkLedgerPlan(
      { ...EMPTY_RAW, operatorSignal: { kind: "declined_topic", about: "the Louise follow-up", quote: "I don't wanna talk about it." } },
      planInput({ utterance: "I don't wanna talk about it. It's 05:30PM." }),
      1
    );
    expect(fresh.operatorSignal.kind).toBe("declined_topic");
  });

  it("grounding tolerates plurals and ASR punctuation", () => {
    expect(groundedInOperatorWords("Build landing page that matches the Instagram ads", "create a landing page that match the instagram ad", 0.6)).toBe(true);
  });
});

describe("work ledger execution — readback before speech", () => {
  it("creates, reads back, and speaks only what the Day Line shows", async () => {
    const dayLine = createFakeDayLine();
    const plan = validateWorkLedgerPlan(
      {
        ...EMPTY_RAW,
        held: [
          heldItem({ ref: "new-1", title: "Check whether 3 dry cleaning orders were charged and charge any that weren't", quote: "I have 3 dry cleaning orders. I need to see if those have been charged yet. If not, I need to charge them.", timing: "", save: true }),
          heldItem({ ref: "new-2", save: true }),
        ],
      },
      planInput(),
      1
    );
    const applied = await applyWorkLedgerPlan({
      plan,
      dayLine: [],
      target: { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam-admin", conversationKey: "k" },
      clock: { today: TODAY, minutesNow: 17 * 60 + 31 },
      deps: dayLine.deps.apply,
    });
    expect(applied.failures).toEqual([]);
    expect(applied.savedRefs).toEqual(["w1", "w2"]);
    expect(dayLine.open()).toHaveLength(2);
    expect(speakVerifiedLedgerChanges(applied, TODAY)).toBe(
      "On today's line: check whether 3 dry cleaning orders were charged and charge any that weren't and deliver 2 dry cleaning orders tonight."
    );
  });

  it("never claims a save the store did not confirm", async () => {
    const dayLine = createFakeDayLine();
    const plan = validateWorkLedgerPlan({ ...EMPTY_RAW, held: [heldItem({ save: true })] }, planInput(), 1);
    const applied = await applyWorkLedgerPlan({
      plan,
      dayLine: [],
      target: { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam-admin", conversationKey: "k" },
      clock: { today: TODAY, minutesNow: 0 },
      deps: { ...dayLine.deps.apply, commit: async () => { throw new Error("Database not available"); } },
    });
    expect(applied.changes).toEqual([]);
    expect(applied.savedRefs).toEqual([]);
    expect(speakVerifiedLedgerChanges(applied, TODAY)).toBe(
      "I couldn't verify the save for deliver 2 dry cleaning orders tonight, so nothing changed there. Want me to try again?"
    );
  });

  it("retitles, reclassifies, completes, moves and removes existing items", async () => {
    const dayLine = createFakeDayLine([
      { id: "a", title: "Pick up from Coast at 10", businessDate: TODAY, sourceText: "pick up from Coast at 10" },
      { id: "b", title: "Deliver Jim's towels to Opus", businessDate: TODAY },
      { id: "c", title: "Call Louise about the contract", businessDate: TODAY },
      { id: "d", title: "It for today", businessDate: TODAY },
      { id: "e", title: "Create Laundry Farm landing page", businessDate: TODAY },
    ]);
    const before = (await dayLine.deps.readState({ tenantId: "default", actorId: "1", businessDate: TODAY } as never)).commitments;
    const items = before.map(row => ({
      id: row.id, title: row.title, businessDate: row.businessDate, status: "open" as const, executionType: null,
      detail: null, sourceText: row.sourceText, scheduleLabel: null, savedThisConversation: true,
    }));
    const input = planInput({
      utterance: "It's KITH TREATS, not Coast. I delivered Jim's towels. Move the Louise call to tomorrow. The landing page is a marketing challenge.",
      dayLine: items,
    });
    const plan = validateWorkLedgerPlan(
      {
        ...EMPTY_RAW,
        edits: [
          { id: "a", title: "Pick up from KITH TREATS at 10", executionType: "unchanged", detail: "", timing: "", moveTo: "", date: "" },
          { id: "c", title: "", executionType: "unchanged", detail: "", timing: "", moveTo: "tomorrow", date: "" },
          { id: "e", title: "", executionType: "challenge", detail: "", timing: "", moveTo: "", date: "" },
        ],
        completeIds: ["b"],
        removeIds: [{ id: "d", reason: "sentence fragment saved by mistake" }],
      },
      input,
      1
    );
    expect(plan.refused).toEqual([]);
    const applied = await applyWorkLedgerPlan({
      plan,
      dayLine: items,
      target: { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam-admin", conversationKey: "k" },
      clock: { today: TODAY, minutesNow: 0 },
      deps: dayLine.deps.apply,
    });
    expect(applied.failures).toEqual([]);
    const rows = Array.from(dayLine.rows.values());
    expect(rows.find(row => row.id === "a")!.title).toBe("Pick up from KITH TREATS at 10");
    expect(rows.find(row => row.id === "b")!.status).toBe("completed");
    expect(rows.find(row => row.id === "c")!.cancelled).toBe(true);
    expect(rows.filter(row => /louise/i.test(row.title) && !row.cancelled).map(row => row.businessDate)).toEqual([TOMORROW]);
    expect(rows.find(row => row.id === "d")!.cancelled).toBe(true);
    expect(rows.find(row => row.id === "e")!.executionType).toBe("challenge");
    const speech = speakVerifiedLedgerChanges(applied, TODAY);
    expect(speech).toContain("Marked done: deliver Jim's towels to Opus.");
    expect(speech).toContain("Now it reads: pick up from KITH TREATS at 10, on today's line.");
    expect(speech).toContain("Moved call Louise about the contract to tomorrow's line.");
    expect(speech).toContain("Create Laundry Farm landing page is on today's line as a marketing challenge.");
    expect(speech).toContain(`Took "It for today" off the line.`);
    expect(applied.receipts.map(receipt => receipt.claimedState).sort()).toEqual(["completed", "removed", "updated", "updated", "updated"]);
  });
});

describe("one turn through the ledger", () => {
  const target = { tenantId: "default", operatorUserId: "adam-admin", dayDirectorActorId: "1", conversationKey: "claire-call:t", surface: "voice" as const, timeZone: "America/Los_Angeles", sessionKind: "pre_drive" };
  const now = () => new Date("2026-10-16T00:31:30Z");

  it("hands ordinary conversation back without writing anything", async () => {
    const dayLine = createFakeDayLine();
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, workChanged: false }]);
    const state: ClaireTurnState = { history: [] };
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "How many orders did we do this week?", state },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(outcome.handled).toBe(false);
    expect(dayLine.writes).toEqual([]);
    expect(state.history).toEqual([]);
  });

  it("saves, holds the rest, strips self-reported writes from the reply, and remembers the turn", async () => {
    const dayLine = createFakeDayLine();
    const { invoke, calls } = scriptedInvoke([
      {
        ...EMPTY_RAW,
        held: [heldItem({ save: true }), heldItem({ ref: "new-2", title: "Maybe swing by Sunset Towers", quote: "maybe swing by Sunset Towers" })],
        reply: "I've added that to your line. Want the Sunset stop on there too?",
      },
    ]);
    const state: ClaireTurnState = { history: [] };
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "I need to deliver 2 of them tonight, and maybe swing by Sunset Towers.", state },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(outcome.handled).toBe(true);
    if (!outcome.handled) return;
    expect(outcome.result.speak).toBe("On today's line: deliver 2 dry cleaning orders tonight. Want the Sunset stop on there too?");
    expect(outcome.result.mutationReceipts?.map(receipt => receipt.claimedState)).toEqual(["created"]);
    expect(state.workLedger?.held.map(item => item.title)).toEqual(["Maybe swing by Sunset Towers"]);
    expect(state.history?.map(entry => entry.speaker)).toEqual(["operator", "claire"]);
    expect(calls[0]).toContain("NEWEST OPERATOR UTTERANCE");
  });

  it("hands back a 'work' turn that changes nothing instead of saying an empty 'Got it.'", async () => {
    const dayLine = createFakeDayLine();
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, workChanged: true, reply: "Got it." }]);
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "And charge the Opus order when it comes in.", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(outcome.handled).toBe(false);
    expect(dayLine.writes).toEqual([]);
  });

  it("asks the planner once more when it returns an empty work plan", async () => {
    const dayLine = createFakeDayLine();
    const { invoke, calls } = scriptedInvoke([{ ...EMPTY_RAW, workChanged: true }, { ...EMPTY_RAW, held: [heldItem({ save: true })] }]);
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "I need to deliver 2 of them tonight.", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(calls).toHaveLength(2);
    expect(outcome.handled).toBe(true);
    expect(dayLine.open()).toHaveLength(1);
  });

  it("falls back to the conversational pipeline when the planner is unavailable", async () => {
    const dayLine = createFakeDayLine();
    const invoke = (async () => { throw new Error("overloaded"); }) as never;
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "I need to deliver 2 of them tonight.", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(outcome).toEqual({ handled: false, reason: "planner_unavailable" });
    expect(dayLine.writes).toEqual([]);
  });

  it("gives the conversational model the verified work, declined topics and call facts", async () => {
    const dayLine = createFakeDayLine();
    const { invoke } = scriptedInvoke([
      { ...EMPTY_RAW, workChanged: false, operatorSignal: { kind: "declined_topic", about: "the Louise follow-up", quote: "I don't wanna talk about it." } },
    ]);
    const state: ClaireTurnState = { history: [] };
    const recorded: string[] = [];
    await runWorkLedgerTurn(
      { ...target, utterance: "I don't wanna talk about it.", state, callFacts: ["Moments before this call, Claire called the operator for the scheduled evening debrief call."] },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async input => { recorded.push(input.signal.kind); return { status: "persisted" }; } }
    );
    expect(recorded).toEqual(["declined_topic"]);
    const section = workLedgerPromptSection(state, TODAY)!;
    expect(section).toContain("scheduled evening debrief call");
    expect(section).toContain("declined to discuss: the Louise follow-up");
  });
});

describe("speech hygiene", () => {
  it("removes sentences where the model narrates a write, keeps the rest", () => {
    expect(cleanLedgerReply("Reclassified as a marketing challenge. Want the ad copy in the notes?")).toBe("Want the ad copy in the notes?");
    expect(cleanLedgerReply("That's already on today's line as a marketing challenge.")).toBe("");
    expect(cleanLedgerReply("Sorry — got all of it now.")).toBe("Sorry — got all of it now.");
    expect(cleanLedgerReply("Okay, dropped the landing page.")).toBe("");
    expect(cleanLedgerReply("Got it, holding those.")).toBe("Got it, holding those.");
    expect(cleanLedgerReply("Should I add it? Say yes or no.")).toBe("Should I add it?");
  });
});

describe("Daphne signals are named for the act, with interpretation carried separately", () => {
  const at = new Date("2026-10-16T00:31:00Z");
  it("maps onto Daphne's existing relationship vocabulary", () => {
    expect(daphneRelationshipEventFor({ kind: "repeated_instruction", about: "", quote: "I just told you something." }, at)).toEqual({ eventKind: "rupture", value: "instruction_misunderstanding" });
    expect(daphneRelationshipEventFor({ kind: "complaint_about_claire", about: "Claire called and hung up", quote: "You called me and then you hung up." }, at)).toEqual({ eventKind: "rupture", value: "operator_complaint: Claire called and hung up" });
    expect(daphneRelationshipEventFor({ kind: "declined_topic", about: "the Louise follow-up", quote: "I don't wanna talk about it." }, at, "2026-10-15")?.value).toMatch(/^On 2026-10-15 the operator declined to discuss the Louise follow-up/);
    expect(daphneRelationshipEventFor({ kind: "confirmed_understanding", about: "", quote: "Yes, that's it." }, at)).toEqual({ eventKind: "repair", value: "instruction_misunderstanding" });
    expect(daphneRelationshipEventFor({ kind: "declined_topic", about: "the Louise follow-up", quote: "I don't wanna talk about it." }, at)?.eventKind).toBe("boundary");
    expect(daphneRelationshipEventFor({ kind: "stated_preference", about: "record work like this as a marketing challenge or sales mission", quote: "..." }, at)).toEqual({
      eventKind: "correction",
      value: "record work like this as a marketing challenge or sales mission",
    });
    expect(daphneRelationshipEventFor({ kind: "none", about: "", quote: "" }, at)).toBeNull();
  });
});

describe("prior-call facts", () => {
  it("tells Claire her own scheduled call just dropped", () => {
    const [fact] = describePriorCalls([
      { conversationKind: "evening_debrief", completionReason: "remote_hangup", secondsBeforeThisCall: 15, durationSeconds: 9, claireOpening: "Claire here. Hi, it's Claire for today's wrap.", operatorSpoke: false, outbound: true },
    ]);
    expect(fact).toContain("Moments before this call, Claire called the operator for the scheduled evening debrief call");
    expect(fact).toContain("ended after 9 seconds (remote hangup) before the operator said anything");
    expect(fact).toContain("Never deny making calls");
  });

  it("is honest about a call that was never placed", () => {
    const [fact] = describePriorCalls([
      { conversationKind: "morning_readiness", completionReason: "call_create_failed", secondsBeforeThisCall: 300, durationSeconds: 1, claireOpening: null, operatorSpoke: false, outbound: true },
    ]);
    expect(fact).toBe("About 5 minutes before this call, Claire tried to place the scheduled morning call but it could not be placed; the operator never heard it.");
  });
});
