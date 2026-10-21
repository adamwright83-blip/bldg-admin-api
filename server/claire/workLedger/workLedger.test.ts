import { describe, expect, it } from "vitest";
import { validateWorkLedgerPlan, groundedInOperatorWords, isClaireWorkLedgerEnabled, type WorkLedgerPlanInput } from "./workLedgerPlanner";
import { applyWorkLedgerPlan, speakVerifiedLedgerChanges } from "./workLedgerApply";
import { cleanLedgerReply, isExplicitClosureAuthorization, isExplicitSaveRequest, isPlainClosureDecline, runWorkLedgerTurn, workLedgerPromptSection } from "./workLedgerTurn";
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
    unchanged: false,
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

  it("saves a new stated obligation the model held without the operator asking", () => {
    const plan = validateWorkLedgerPlan({ ...EMPTY_RAW, held: [heldItem({ save: false })] }, planInput(), 1);
    expect(plan.saveRefs).toEqual(["w1"]);
    const held = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ save: false })] },
      planInput({ utterance: "I need to deliver 2 of them tonight. Hold those for now." }),
      1
    );
    expect(held.saveRefs).toEqual([]);
    const tentative = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ title: "Swing by Sunset Towers", quote: "I might swing by Sunset Towers", save: false })] },
      planInput({ utterance: "I might swing by Sunset Towers later." }),
      1
    );
    expect(tentative.saveRefs).toEqual([]);
  });

  it("keeps held work the model marks unchanged without it being rewritten", () => {
    const held = [{ ref: "w1", title: "Deliver 2 dry cleaning orders tonight", businessDate: TODAY, timing: "tonight", executionType: null, detail: "", quote: "I need to deliver 2 of them tonight." }];
    const plan = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ ref: "w1", unchanged: true, title: "", quote: "", timing: "", save: true })] },
      planInput({ held, utterance: "Put the deliveries on the line now." }),
      2
    );
    expect(plan.held).toEqual(held);
    expect(plan.saveRefs).toEqual(["w1"]);
    expect(plan.refused).toEqual([]);
  });

  it("keeps the previous version of held work when its rewrite is refused", () => {
    const held = [{ ref: "w1", title: "Deliver 2 dry cleaning orders tonight", businessDate: TODAY, timing: "tonight", executionType: null, detail: "", quote: "I need to deliver 2 of them tonight." }];
    const plan = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ ref: "w1", title: "Call Greystar", quote: "Call Greystar about the renewal" })] },
      planInput({ held }),
      2
    );
    expect(plan.held).toEqual(held);
    expect(plan.saveRefs).toEqual([]);
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

  it("says 'a challenge' for any remote objective and echoes 'marketing challenge' only when the operator said it", async () => {
    const run = async (operatorWords: string) => {
      const dayLine = createFakeDayLine();
      const plan = validateWorkLedgerPlan(
        { ...EMPTY_RAW, held: [heldItem({ ref: "new-1", title: "Text the dormant customers", quote: "I need to text the dormant customers.", executionType: "challenge", timing: "", save: true })] },
        planInput({ utterance: operatorWords, transcript: [{ speaker: "operator", text: "I need to text the dormant customers." }] }),
        1
      );
      const applied = await applyWorkLedgerPlan({
        plan,
        dayLine: [],
        target: { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam-admin", conversationKey: "k" },
        clock: { today: TODAY, minutesNow: 17 * 60 + 31 },
        deps: dayLine.deps.apply,
        operatorWords,
      });
      return speakVerifiedLedgerChanges(applied, TODAY);
    };
    expect(await run("Yes, text the dormant customers.")).toBe("On today's line: text the dormant customers as a challenge.");
    expect(await run("Put that on the record as a marketing challenge.")).toBe("On today's line: text the dormant customers as a marketing challenge.");
  });

  it("keeps the operator's own words for a time said without am/pm", async () => {
    const dayLine = createFakeDayLine();
    const plan = validateWorkLedgerPlan(
      { ...EMPTY_RAW, held: [heldItem({ title: "Opus pickup", quote: "I've got the Opus pickup at 11", timing: "at 11", save: true })] },
      planInput({ utterance: "I've got the Opus pickup at 11" }),
      1
    );
    await applyWorkLedgerPlan({
      plan, dayLine: [],
      target: { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam-admin", conversationKey: "k" },
      clock: { today: TODAY, minutesNow: 18 * 60 },
      deps: dayLine.deps.apply,
    });
    expect(dayLine.open()[0]!.scheduleLabel).toBe("at 11");
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
    // Moved in place: same item, same id, now tomorrow; nothing cancelled, no copy left behind.
    expect(rows.find(row => row.id === "c")).toMatchObject({ businessDate: TOMORROW });
    expect(rows.find(row => row.id === "c")!.cancelled).toBeFalsy();
    expect(rows.filter(row => /louise/i.test(row.title) && !row.cancelled).map(row => row.id)).toEqual(["c"]);
    expect(rows.find(row => row.id === "d")!.cancelled).toBe(true);
    expect(rows.find(row => row.id === "e")!.executionType).toBe("challenge");
    const speech = speakVerifiedLedgerChanges(applied, TODAY);
    expect(speech).toContain("Marked done: deliver Jim's towels to Opus.");
    expect(speech).toContain("Now it reads: pick up from KITH TREATS at 10, on today's line.");
    expect(speech).toContain("Moved call Louise about the contract to tomorrow's line.");
    expect(speech).toContain("Create Laundry Farm landing page is on today's line as a challenge.");
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

  it("reloads work moved beyond tomorrow before accepting a later correction", async () => {
    const dayLine = createFakeDayLine([{ id: "louise", title: "Call Louise", businessDate: "2026-10-19" }]);
    const state: ClaireTurnState = JSON.parse(JSON.stringify({ workLedger: {
      version: 1, held: [], savedIds: ["louise"], nextRef: 2,
      lastSaved: [{ id: "louise", title: "Call Louise", businessDate: "2026-10-19", executionType: null }],
    } }));
    const { invoke, calls } = scriptedInvoke([{ ...EMPTY_RAW, completeIds: ["louise"] }]);
    const deps = { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" as const }) };
    const outcome = await runWorkLedgerTurn({ ...target, utterance: "I finished the Louise call early.", state }, deps);
    expect(calls[0]).toContain("id=louise day=2026-10-19");
    expect(outcome.handled).toBe(true);
    // Completion waits for the operator's explicit yes (release review 2026-10-17).
    expect(dayLine.writes).toEqual([]);
    const confirmed = await runWorkLedgerTurn({ ...target, utterance: "Yes.", state }, deps);
    expect(confirmed.handled).toBe(true);
    expect(dayLine.rows.get("louise")?.status).toBe("completed");
    expect(dayLine.writes).toEqual(["complete Call Louise"]);
  });

  it("never completes or removes Day Line work on the model's reading alone: Claire asks, and only an explicit yes applies it", async () => {
    const dayLine = createFakeDayLine([
      { id: "van", title: "Van inspection", businessDate: TODAY },
      { id: "flyers", title: "Print flyers", businessDate: TODAY },
    ]);
    const state: ClaireTurnState = { history: [] };
    const { invoke, calls } = scriptedInvoke([
      { ...EMPTY_RAW, completeIds: ["van"], removeIds: [{ id: "flyers", reason: "operator dropped it" }], reply: "Done, I marked the van inspection complete and removed the flyers." },
    ]);
    const deps = { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" as const }) };
    const asked = await runWorkLedgerTurn({ ...target, utterance: "The van thing is sorted and forget the flyers.", state }, deps);
    expect(asked.handled && asked.result.speak).toBe(
      'Before I change your Day Line: should I mark "Van inspection" done and take "Print flyers" off your Day Line? Say yes to confirm.'
    );
    expect(dayLine.writes).toEqual([]);
    expect(dayLine.open().map(row => row.title).sort()).toEqual(["Print flyers", "Van inspection"]);

    const confirmed = await runWorkLedgerTurn({ ...target, utterance: "Yes, go ahead.", state }, deps);
    expect(calls).toHaveLength(1); // the yes applies what was asked; it is not re-planned
    expect(dayLine.writes.sort()).toEqual(["complete Van inspection", "remove Print flyers"]);
    expect(confirmed.handled && confirmed.result.kind).toBe("briefing_saved");
    expect(state.workLedger?.pendingClosure ?? null).toBeNull();
  });

  it("a plain no leaves the Day Line untouched", async () => {
    const dayLine = createFakeDayLine([{ id: "van", title: "Van inspection", businessDate: TODAY }]);
    const state: ClaireTurnState = { history: [] };
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, completeIds: ["van"] }]);
    const deps = { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" as const }) };
    await runWorkLedgerTurn({ ...target, utterance: "Van's handled I think.", state }, deps);
    const declined = await runWorkLedgerTurn({ ...target, utterance: "No.", state }, deps);
    expect(declined.handled && declined.result.speak).toBe("Okay, I left your Day Line as it was.");
    expect(dayLine.writes).toEqual([]);
    expect(dayLine.rows.get("van")?.status).toBe("open");
  });

  it("a qualified answer is not authorization: the pending change is dropped and the turn is planned normally", async () => {
    const dayLine = createFakeDayLine([{ id: "van", title: "Van inspection", businessDate: TODAY }]);
    const state: ClaireTurnState = { history: [] };
    const { invoke, calls } = scriptedInvoke([{ ...EMPTY_RAW, completeIds: ["van"] }, { ...EMPTY_RAW, workChanged: false }]);
    const deps = { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" as const }) };
    await runWorkLedgerTurn({ ...target, utterance: "Van's handled I think.", state }, deps);
    await runWorkLedgerTurn({ ...target, utterance: "Yes but not the van, the oil change.", state }, deps);
    expect(calls).toHaveLength(2);
    expect(dayLine.writes).toEqual([]);
    expect(state.workLedger?.pendingClosure ?? null).toBeNull();
  });

  it("a stated obligation still saves at once while a closure in the same turn waits for a yes", async () => {
    const dayLine = createFakeDayLine([{ id: "van", title: "Van inspection", businessDate: TODAY }]);
    const state: ClaireTurnState = { history: [] };
    const { invoke } = scriptedInvoke([
      { ...EMPTY_RAW, completeIds: ["van"], held: [heldItem({ save: true, quote: "I need to deliver 2 of them tonight." })] },
    ]);
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "Van inspection's done. I need to deliver 2 of them tonight.", state },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(dayLine.writes).toEqual([`create ${TODAY} Deliver 2 dry cleaning orders tonight`]);
    expect(dayLine.rows.get("van")?.status).toBe("open");
    expect(outcome.handled && outcome.result.speak).toContain('should I mark "Van inspection" done?');
  });

  it("recognizes only a short unqualified yes as closure authorization", () => {
    for (const yes of ["Yes.", "yeah", "Yep, do it", "Correct.", "Go ahead", "Yes please", "That's right", "Sure, confirm it"]) {
      expect(isExplicitClosureAuthorization(yes), yes).toBe(true);
    }
    for (const not of ["ok", "I guess", "yes but not the van", "Yes, actually wait", "no", "Yes I'll tell you which ones are finished after lunch today okay", "maybe"]) {
      expect(isExplicitClosureAuthorization(not), not).toBe(false);
    }
    expect(isPlainClosureDecline("No.")).toBe(true);
    expect(isPlainClosureDecline("Leave it")).toBe(true);
    expect(isPlainClosureDecline("No, the oil change is done")).toBe(false);
  });

  it("the ledger is opt-in: a model key alone never turns it on", () => {
    const key = process.env.ANTHROPIC_API_KEY;
    expect(isClaireWorkLedgerEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isClaireWorkLedgerEnabled({ CLAIRE_WORK_LEDGER: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isClaireWorkLedgerEnabled({ CLAIRE_WORK_LEDGER: "yes" } as NodeJS.ProcessEnv)).toBe(false);
    // With the flag, it still needs a key (ENV is read at import; the test env has none unless set).
    expect(isClaireWorkLedgerEnabled({ CLAIRE_WORK_LEDGER: "1" } as NodeJS.ProcessEnv)).toBe(Boolean(key?.trim()));
  });

  it("does not tell the operator nothing was saved when only details were added", async () => {
    const dayLine = createFakeDayLine([{ id: "landing", title: "Build Laundry Farm landing page", businessDate: "2026-10-15" }]);
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, edits: [{ id: "landing", title: "", executionType: "unchanged", detail: "Offer: skip laundry this week on us", timing: "", moveTo: "", date: "" }] }]);
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "The ad says skip laundry this week on us, the landing page has to match it.", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(outcome.handled && outcome.result.speak).toBe("Got it, noted on the line.");
    expect(dayLine.rows.get("landing")?.detailNote).toBe("Offer: skip laundry this week on us");
  });

  it("reads back held work when the operator corrects it before saving", async () => {
    const dayLine = createFakeDayLine();
    const state: ClaireTurnState = { history: [], workLedger: { version: 1, savedIds: [], nextRef: 2, held: [
      { ref: "w1", title: "Deliver third dry cleaning order", businessDate: TOMORROW, timing: "tomorrow morning", executionType: null, detail: "", quote: "And 1 of them tomorrow morning." },
    ] } };
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, held: [heldItem({ ref: "w1", title: "Deliver third dry cleaning order", day: "tomorrow", timing: "tomorrow afternoon", quote: "change the one delivery tomorrow to tomorrow afternoon" })] }]);
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "Change the one delivery tomorrow to tomorrow afternoon. Show me the corrected plan; do not save it yet.", state },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(outcome.handled && outcome.result.speak).toBe("Holding, not on the line yet. Tomorrow: deliver third dry cleaning order tomorrow afternoon.");
    expect(dayLine.writes).toEqual([]);
  });

  it("saves held work when the operator explicitly says to, even if the plan forgot", async () => {
    const dayLine = createFakeDayLine();
    const held = [
      { ref: "w1", title: "Deliver 2 dry cleaning orders tonight", businessDate: TODAY, timing: "tonight", executionType: null, detail: "", quote: "I need to deliver 2 of them tonight." },
      { ref: "w2", title: "Maybe swing by Sunset Towers", businessDate: TODAY, timing: "", executionType: null, detail: "", quote: "maybe swing by Sunset Towers" },
    ];
    const state: ClaireTurnState = { history: [], workLedger: { version: 1, savedIds: [], nextRef: 3, held } };
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, held: held.map(item => heldItem({ ref: item.ref, title: item.title, quote: item.quote, timing: item.timing })), reply: "They're yours to action." }]);
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "Yes, save that corrected dry-cleaning work to the Day Line now.", state },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(outcome.handled).toBe(true);
    expect(dayLine.open().map(row => row.title)).toEqual(["Deliver 2 dry cleaning orders tonight"]);
    expect(state.workLedger?.held.map(item => item.ref)).toEqual(["w2"]);
  });

  it("recognizes an explicit save and never a hold as one", () => {
    expect(isExplicitSaveRequest("Yes, save that corrected dry-cleaning work to the Day Line now.")).toBe(true);
    expect(isExplicitSaveRequest("Okay now put the Opus pickups on for tomorrow afternoon.")).toBe(false);
    expect(isExplicitSaveRequest("Put them on the line.")).toBe(true);
    expect(isExplicitSaveRequest("Keep the orders separate; don't save those yet.")).toBe(false);
    expect(isExplicitSaveRequest("Show me the corrected plan; do not save it yet.")).toBe(false);
  });

  it("makes one attempt on the fallback model when the primary planner fails", async () => {
    const dayLine = createFakeDayLine();
    const models: string[] = [];
    const invoke = (async (params: { model: string }) => {
      models.push(params.model);
      if (models.length === 1) throw new Error("timed out");
      return { id: "x", created: 0, model: "stub", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify({ ...EMPTY_RAW, held: [heldItem({ save: true })] }) }, finish_reason: "tool_use" }] };
    }) as never;
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "I need to deliver 2 of them tonight.", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
    );
    expect(models).toEqual(["claude-sonnet-5-5", "claude-haiku-5-5"]);
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
    expect(cleanLedgerReply("Got it — charge on arrival.")).toBe("");
    expect(cleanLedgerReply("I'll text Louise now.")).toBe("");
    expect(cleanLedgerReply("That one's yours to charge when it comes in.")).toBe("That one's yours to charge when it comes in.");
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

describe("ledger safety before CLAIRE_WORK_LEDGER turns on", () => {
  const target = { tenantId: "default", operatorUserId: "adam-admin", dayDirectorActorId: "1", conversationKey: "claire-desk:t", surface: "text" as const, timeZone: "America/Los_Angeles", sessionKind: "desk" };
  const now = () => new Date("2026-10-16T00:31:30Z");
  const capture = (overrides: Partial<{ corrections: unknown[]; readbackVerified: boolean; status: string }> = {}) => {
    const calls: Array<Record<string, unknown>> = [];
    const record = async (input: Record<string, unknown>) => {
      calls.push(input);
      return { status: "persisted", readbackVerified: true, corrections: [{ key: "address_as" }], observationIds: ["o1"], ...overrides } as never;
    };
    return { calls, record };
  };

  it("a work turn the ledger answers still reaches Daphne, once, and reads back a saved preference", async () => {
    const dayLine = createFakeDayLine();
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, held: [heldItem({ save: true })] }]);
    const daphne = capture();
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "I need to deliver 2 of them tonight, and stop calling me boss.", state: { history: [], claireTurnCount: 4 } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }), recordDaphneTurn: daphne.record as never }
    );
    expect(outcome.handled).toBe(true);
    if (!outcome.handled) return;
    expect(dayLine.open()).toHaveLength(1);
    expect(daphne.calls).toEqual([
      expect.objectContaining({ utterance: "I need to deliver 2 of them tonight, and stop calling me boss.", conversationKey: "claire-desk:t", turnId: "claire-desk:t:5", completed: true }),
    ]);
    expect(outcome.result.speak).toMatch(/I'll remember that preference\.$/);
  });

  it("uses the caller's turn id, and never treats an unfinished thought as a durable preference", async () => {
    const dayLine = createFakeDayLine();
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, held: [heldItem({ save: true })] }]);
    const daphne = capture({ corrections: [] });
    await runWorkLedgerTurn(
      { ...target, utterance: "I need to deliver 2 of them tonight.", state: { history: [] }, sourceEventId: "voice:call-1:7", inputComplete: false },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }), recordDaphneTurn: daphne.record as never }
    );
    expect(daphne.calls[0]).toMatchObject({ turnId: "voice:call-1:7", completed: false });
  });

  it("does not speak a preference as saved when the read-back failed", async () => {
    const dayLine = createFakeDayLine();
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, held: [heldItem({ save: true })] }]);
    const daphne = capture({ readbackVerified: false, status: "readback_failed" });
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "I need to deliver 2 of them tonight, and keep it short.", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }), recordDaphneTurn: daphne.record as never }
    );
    expect(outcome.handled && outcome.result.speak).toMatch(/couldn't save it for next time\.$/);
  });

  it("leaves ordinary conversation to Claire's own Daphne step", async () => {
    const dayLine = createFakeDayLine();
    const { invoke } = scriptedInvoke([{ ...EMPTY_RAW, workChanged: false }]);
    const daphne = capture();
    const outcome = await runWorkLedgerTurn(
      { ...target, utterance: "How many orders this week?", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }), recordDaphneTurn: daphne.record as never }
    );
    expect(outcome.handled).toBe(false);
    expect(daphne.calls).toEqual([]);
  });

  it("a fresh conversation sees open work up to two weeks out, not just today and tomorrow", async () => {
    const dayLine = createFakeDayLine([
      { id: "friday", title: "Pitch The Louise", businessDate: "2026-10-23" },
      { id: "done-later", title: "Old note", businessDate: "2026-10-22", status: "completed" },
      { id: "far", title: "Too far out", businessDate: "2026-11-05" },
    ]);
    const { invoke, calls } = scriptedInvoke([{ ...EMPTY_RAW, workChanged: false }]);
    await runWorkLedgerTurn(
      { ...target, utterance: "Move Friday's Louise pitch to Monday.", state: { history: [] } },
      { now, planner: { invoke }, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }), recordDaphneTurn: capture().record as never }
    );
    expect(calls[0]).toContain("Pitch The Louise");
    expect(calls[0]).not.toContain("Old note");
    expect(calls[0]).not.toContain("Too far out");
  });

  it("a move keeps the same item and refuses when the item changed underneath", async () => {
    const dayLine = createFakeDayLine([{ id: "c", title: "Call Louise about the contract", businessDate: TODAY, detailNote: "Ask about the 2nd floor" } as never]);
    const items = [{ id: "c", title: "Call Louise about the contract", businessDate: TODAY, status: "open" as const, executionType: null, detail: "Ask about the 2nd floor", sourceText: null, scheduleLabel: null, savedThisConversation: false }];
    const input = planInput({ utterance: "Move the Louise call to tomorrow.", dayLine: items });
    const plan = validateWorkLedgerPlan({ ...EMPTY_RAW, edits: [{ id: "c", title: "", executionType: "unchanged", detail: "", timing: "", moveTo: "tomorrow", date: "" }] }, input, 1);
    const applied = await applyWorkLedgerPlan({ plan, dayLine: items, target: { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam-admin", conversationKey: "k" }, clock: { today: TODAY, minutesNow: 0 }, deps: dayLine.deps.apply });
    expect(applied.failures).toEqual([]);
    expect(Array.from(dayLine.rows.values())).toHaveLength(1);
    expect(dayLine.rows.get("c")).toMatchObject({ businessDate: TOMORROW });
    expect(dayLine.writes).toEqual([`move Call Louise about the contract to ${TOMORROW}`]);

    dayLine.rows.get("c")!.businessDate = "2026-10-20";
    const again = await applyWorkLedgerPlan({ plan, dayLine: items, target: { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam-admin", conversationKey: "k" }, clock: { today: TODAY, minutesNow: 0 }, deps: dayLine.deps.apply });
    expect(again.failures[0]?.error).toMatch(/changed before it could be moved/);
    expect(again.changes).toEqual([]);
  });
});
