/**
 * The 2026-10-22 evening wrap (conversation 761d48cc), replayed with its real utterances.
 *
 * Production ran b1a9ade8 with a revoked Anthropic key, so every model call failed. Five defects were
 * independent of the key and are fixed here; the sixth (dialling with a dead key at all) is the preflight.
 *  1. "Did you i have to mail 4 former customers to try to get them to order laundry pickups with me again?"
 *  2. "I sent a text message to 1 former customer" marked the four-customer item done.
 *  3. "he just now texted me back last night" was read as a "just the last one" re-query, three times.
 *  4. Three growing transcripts of one story each got the same 296-character reply.
 *  5. "Sorry, I lost that for a second" on every turn once the composer could not reach the model.
 *  6. The call was placed even though the model key was rejected.
 */
import { describe, expect, it, vi } from "vitest";
import {
  agendaQuestion,
  collapseOpenCommitments,
  interpretOpenItemReply,
  partialCount,
  spokenAction,
} from "../../dayLine/openItemLifecycle";
import { showrunnerOpening, type ShowrunnerBriefing } from "../../showrunner/showrunnerBriefing";
import { runShowrunnerTurn, type ShowrunnerCallState } from "../../showrunner/showrunnerTurn";
import { interpretTurn } from "../../turn/interpretTurn";
import { ConversationRelaySocketRuntime, extendsUtterance } from "../../voice/conversationRelayRuntime";
import { checkClaireModelHealth, claireModelDownText } from "../../claireModelHealth";
import { perceiveTurn } from "../perception/perceive";

const TITLE = "I have to mail 4 former customers to try to get them to order laundry pickups with me again.";
const FORREST = [
  "About 3 weeks ago, and he just now texted me back last night. And I picked up from him this morning, And his order is, like, 100 and 60 dollars.",
  "About 3 weeks ago, and he just now texted me back last night. And I picked up from him this morning, And his order is, like, 100 and 60 dollars. So it's a very nice order... Nice size order.",
  "About 3 weeks ago, and he just now texted me back last night. And I picked up from him this morning, And his order is, like, 100 and 60 dollars. So it's a very nice order... Nice size order. And his name is Forrest. So you will see him in my records.",
];

function briefing(): ShowrunnerBriefing {
  return {
    purpose: "evening_debrief",
    businessDate: "2026-10-22",
    weekday: "Thursday",
    objective: "Get to 50 active customers",
    weekPlan: null,
    today: [],
    tomorrow: [],
    developments: [],
    pendingDecision: null,
    adaptations: [],
    uncertain: [],
    weekToDate: { reportedOutcomes: [], planChanges: [] },
    driverDayLine: { read: "read", businessDate: "2026-10-22", stops: [], designatedMission: null, fieldBlockers: [], pendingApproval: [], omissions: [] },
    carriedOpen: collapseOpenCommitments([{ id: "c4", title: TITLE, businessDate: "2026-08-26", status: "open" }], "2026-10-22"),
  } as ShowrunnerBriefing;
}

function callState(): ShowrunnerCallState {
  return {
    purpose: "evening_debrief",
    tenantId: "default",
    canonicalOperatorId: "op",
    operatorUserId: "adam-admin",
    dayDirectorActorId: "1",
    dayDirectorActorIds: ["1"],
    timeZone: "America/Los_Angeles",
    businessDate: "2026-10-22",
    briefing: briefing(),
    captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
    replan: null,
    turns: 0,
  } as unknown as ShowrunnerCallState;
}

describe("1. the operator's own wording is spoken as an action", () => {
  it("strips the first person and the purpose clause", () => {
    expect(spokenAction(TITLE)).toBe("mail 4 former customers");
    expect(agendaQuestion(TITLE)).toBe("Did you mail 4 former customers?");
    expect(spokenAction("I need to call Dana about my invoice")).toBe("call Dana about your invoice");
    expect(agendaQuestion("Call Dana to resolve the overdue Louise follow-up")).toBe("Did you call Dana?");
  });

  it("the evening opening names the action and asks it as one yes/no", () => {
    const opening = showrunnerOpening(briefing());
    expect(opening).toContain("One thing has been open 57 days: mail 4 former customers.");
    expect(opening.endsWith("Did you mail 4 former customers?")).toBe(true);
    expect(opening).not.toMatch(/\bi have to\b|with me again|Did you i\b/i);
  });
});

describe("2. one of four is progress, never done", () => {
  it("reads the count against the item", () => {
    expect(partialCount(TITLE, "I sent a text message to 1 former customer at Century Park East.")).toEqual({ done: 1, of: 4, noun: "customer" });
    expect(interpretOpenItemReply("I sent a text message to 1 former customer at Century Park East.", "2026-10-22", TITLE)).toMatchObject({ kind: "progress", done: 1, of: 4 });
    expect(interpretOpenItemReply("I mailed all four, done", "2026-10-22", TITLE).kind).toBe("done");
    expect(interpretOpenItemReply("yes", "2026-10-22", TITLE).kind).toBe("done");
  });

  it("the call keeps it open and writes nothing", async () => {
    const invoke = vi.fn();
    const complete = vi.fn();
    const cancel = vi.fn();
    const turn = await runShowrunnerTurn({
      state: callState(),
      history: [],
      utterance: "I sent a text message to 1 former customer at Century Park East.",
      sourceEventId: "e1",
      conversationKey: "claire-call:761d48cc",
      invoke: invoke as never,
      openItem: { complete, cancel, move: vi.fn(), readState: vi.fn() } as never,
    });
    expect(turn.speak).toBe("That's 1 of 4, so I'm keeping it open for the other 3. How did the rest of the day go?");
    expect(complete).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(turn.state.openItemHandled).toBe(true);
  });
});

describe("3. a story with time words is not a re-query", () => {
  it("Forrest's story is not a parameter change; 'just the last one' still is", () => {
    for (const text of FORREST) expect(interpretTurn(text).queryParameterChange).toBe(false);
    expect(interpretTurn("just the last one").queryParameterChange).toBe(true);
    expect(interpretTurn("only the most recent, not the five").queryParameterChange).toBe(true);
  });

  it("Brain V2 perception no longer routes the story to the revenue query", () => {
    for (const text of FORREST) {
      const perceived = perceiveTurn({ rawText: text, completeness: "complete" });
      expect(perceived.businessIntent).not.toBe("query_requery");
    }
  });
});

describe("4. a transcript that only grew is not answered again with the same words", () => {
  it("recognises the extension", () => {
    expect(extendsUtterance(FORREST[0]!, FORREST[1]!)).toBe(true);
    expect(extendsUtterance(FORREST[1]!, FORREST[2]!)).toBe(true);
    expect(extendsUtterance(FORREST[2]!, "And I also did Thomas today.")).toBe(false);
  });

  it("speaks once for three growing prompts with the identical reply, and again when the reply changes", async () => {
    const sent: Array<{ type: string; token?: string }> = [];
    const replies = ["Same reply.", "Same reply.", "Same reply.", "Different reply."];
    const runtime = new ConversationRelaySocketRuntime({
      identity: { conversationId: "761d48cc", tenantId: "default", operatorUserId: "adam-admin" } as never,
      token: "t",
      send: message => sent.push(message as never),
      loadOpening: async () => ({ text: "", queued: false }),
      noteCallSid: async () => undefined,
      runTurn: async () => ({ speak: replies.shift()!, endCall: false }) as never,
      markIntentionalEnd: async () => undefined,
    });
    for (const text of [...FORREST, "And I also did Thomas today."]) runtime.accept({ type: "prompt", voicePrompt: text, last: true });
    await runtime.idle();
    expect(sent.filter(m => m.type === "text").map(m => m.token)).toEqual(["Same reply.", "Different reply."]);
  });
});

describe("5. a composer that cannot reach the model does not loop", () => {
  it("asks once, then ends honestly", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("Anthropic authentication failed (401). Check ANTHROPIC_API_KEY is valid and not revoked.");
    });
    const state = { ...callState(), openItemHandled: true } as ShowrunnerCallState;
    const first = await runShowrunnerTurn({ state, history: [], utterance: "And I also did Thomas today.", sourceEventId: "e1", conversationKey: "k", invoke: invoke as never });
    expect(first.speak).toBe("Sorry, I lost that for a second. Could you say it again?");
    expect(first.end).toBe(false);
    const second = await runShowrunnerTurn({ state: first.state, history: [], utterance: "Tomorrow I will try some of the stops you're recommending.", sourceEventId: "e2", conversationKey: "k", invoke: invoke as never });
    expect(second.end).toBe(true);
    expect(second.speak).toMatch(/planning side is down/);
    expect(second.speak).not.toMatch(/lost that/);
  });
});

describe("6. a rejected model key is caught before dialling", () => {
  it("auth failure is unhealthy; overload is not", async () => {
    const rejected = await checkClaireModelHealth({
      tenantId: "default",
      invoke: (async () => {
        throw new Error("Anthropic authentication failed (401). Check ANTHROPIC_API_KEY is valid and not revoked.");
      }) as never,
    });
    expect(rejected).toMatchObject({ ok: false, reason: "authentication_failed" });
    const overloaded = await checkClaireModelHealth({
      tenantId: "default",
      invoke: (async () => {
        throw new Error("Anthropic is overloaded (529). Retry later.");
      }) as never,
    });
    expect(overloaded).toEqual({ ok: true });
    expect(claireModelDownText("evening_debrief")).toMatch(/skipped your evening wrap.*ANTHROPIC_API_KEY/);
  });
});
