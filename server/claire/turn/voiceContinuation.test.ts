import { describe, expect, it, vi } from "vitest";
import { CONTINUATION_MAX_HOLDS, observationUtteranceForBrain, runClaireTurn, shouldHoldForContinuation, type ClaireTurnDeps, type ClaireTurnState } from "./claireTurn";
import { CONTINUATION_GRACE_SECONDS, preDriveConversationTwiML } from "../claireTwilio";

const NOW = new Date("2026-09-19T17:00:00Z");
const turnDeps = (): ClaireTurnDeps => ({
  now: () => NOW, timeZone: () => "America/Los_Angeles",
  business: { now: () => NOW, timeZone: () => "America/Los_Angeles", plan: async () => null, runQuery: vi.fn() as never },
  commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
  followUp: vi.fn(async () => "Reply.") as never,
  extractModel: null, loadExisting: async () => [],
  commit: vi.fn(async (parsed: { items: Array<{ kind: string; existing: unknown; title?: string; businessDate?: string }> }) => ({
    added: parsed.items.filter(item => item.kind === "new_work" && !item.existing),
    completed: parsed.items.filter(item => item.kind === "completed"),
    failed: [],
    commitmentIds: parsed.items.map((_, index) => `c-${index}`),
    receipts: parsed.items.map((item, index) => ({
      claimedState: item.kind === "completed" ? ("completed" as const) : ("created" as const),
      entityId: `c-${index}`,
      statement: item.title ?? "item",
    })),
  })) as never, campaign: async () => null,
  vocabulary: async () => [], accounts: async () => [], accountHistory: vi.fn() as never, commitFollowUp: vi.fn() as never,
  dayWork: vi.fn() as never, unpaid: vi.fn() as never, searchMemory: vi.fn(async () => []) as never,
  memoryBetween: vi.fn(async () => []) as never, encyclopedia: null, watchBoard: undefined, doctrineTurn: undefined,
});
const base = { tenantId: "default", operatorUserId: "op", dayDirectorActorId: "1", surface: "voice" as const, conversationKey: "claire-call:c", brief: "Two stops today.", context: { businessDate: "2026-09-19", actorId: "op", macroGoalKnown: false, blockers: [], relevantTimeline: [], clock: { localTime: "10:02 AM", weekday: "Saturday", businessDate: "2026-09-19", timeZone: "America/Los_Angeles" } } as never };

async function speak(fragments: string[], state: ClaireTurnState = {}) {
  const held: boolean[] = [];
  for (const fragment of fragments) {
    const result = await runClaireTurn({ ...base, utterance: fragment, state }, turnDeps());
    held.push(Boolean(result.listenOnly));
    if (!result.listenOnly) return { held, final: result, state, answeredAt: "fragment" as const };
  }
  const pending = state.pendingFragment ?? "";
  state.pendingFragment = null;
  state.fragmentHolds = 0;
  const final = await runClaireTurn({ ...base, utterance: pending, state, allowFragmentWait: false }, turnDeps());
  return { held, final, state, answeredAt: "grace" as const };
}
const operatorHistory = (state: ClaireTurnState) => (state.history ?? []).filter(h => h.speaker === "operator").map(h => h.text);

describe("natural pauses inside long speech are never answered mid-thought", () => {
  it("Slice 0 turns 6+8: provider fragments stitch before Claire reasons, and she answers once", async () => {
    const pieces = [
      "Well, tomorrow's a Saturday. So the people I would need to speak to won't be in",
      "So perhaps the best utilization of my time is completing an assignment Russell gave me, which is creating a static image advertisement for Instagram using the software called Zeely.ai.",
      "Zeely is spelled z-e-e-l-y dot a-i and you can put that on the dayline.",
    ];
    const { held, final, state, answeredAt } = await speak(pieces);
    expect(held).toEqual([true, true, true]);
    expect(answeredAt).toBe("grace");
    expect(final.listenOnly).toBeFalsy();
    expect(operatorHistory(state)).toEqual([pieces.join(" ")]);
    expect(state.providerFragments?.join(" ")).toContain("won't be in");
  });

  it("Slice 0 turn 10: does not answer at 'When you hear me say'", async () => {
    const pieces = [
      "No, because you just parroted everything I said and repeated it back to me instead of summarizing it. You should only put things on the dayline that you summarize. When you hear me say",
      "30 words, you summarize it into like six words.",
    ];
    const { held, state } = await speak(pieces);
    expect(held).toEqual([true, true]);
    expect(operatorHistory(state)[0]).toContain("six words");
  });

  it("Slice 0 turn 14: trailing 'I don't need any of that on the dayline' is kept", async () => {
    const pieces = [
      "Well, Sunday, I'm just going to go to church and rest all day. And if I have any more Instagram advertisement related work to do, then I will do that on Sunday as well, and I'm going to try to vacuum my bedroom floor",
      "and maybe go on a hike and I don't need any of that on the dayline.",
    ];
    const { held, state } = await speak(pieces);
    expect(held).toEqual([true, true]);
    expect(operatorHistory(state)[0]).toMatch(/hike and I don't need any of that on the dayline\.$/);
  });

  it("a long thought that ends on a question is answered at once", async () => {
    const { held, answeredAt } = await speak(["Not yet, I just have to say Claire. I'm smiling right now. That was really good. Do you have plans this weekend?"]);
    expect(held).toEqual([false]);
    expect(answeredAt).toBe("fragment");
  });
});

describe("normal short answers get no added dead air", () => {
  it.each(["Yes.", "No thanks.", "That's fine.", "What should I lead with at The Louise?", "Do you have plans this weekend?"])(
    "%s is answered immediately", async utterance => {
      expect(shouldHoldForContinuation(utterance)).toBe(false);
      const result = await runClaireTurn({ ...base, utterance, state: {} }, turnDeps());
      expect(result.listenOnly).toBeFalsy();
    }
  );
  it("a clear yes/no to something Claire is holding decides at once, even when a little longer", () => {
    expect(shouldHoldForContinuation("yes please add that one to the day line", { awaitingReply: true })).toBe(false);
    expect(shouldHoldForContinuation("yes please add that one to the day line", { awaitingReply: false })).toBe(true);
  });
});

describe("safety valves", () => {
  it("a rambling speaker is not held forever", async () => {
    const state: ClaireTurnState = {};
    let last = { listenOnly: true } as { listenOnly?: boolean; assembledUtterance?: string; thoughtCompleteness?: string };
    const pieces: string[] = [];
    for (let i = 0; i <= CONTINUATION_MAX_HOLDS; i += 1) {
      const piece = `and then there was another thing I wanted to say number ${i}`;
      pieces.push(piece);
      last = await runClaireTurn({ ...base, utterance: piece, state }, turnDeps());
    }
    expect(last.listenOnly).toBeFalsy();
    expect(last.thoughtCompleteness).toBe("forced_flush");
    expect(last.assembledUtterance).toBe(pieces.join(" "));
  });
});

describe("unfinished thoughts stay held across a quiet gather", () => {
  it("does not answer a fragment that still ends mid-thought", async () => {
    const state: ClaireTurnState = {};
    const first = await runClaireTurn(
      { ...base, utterance: "He was my most recent order for", state },
      turnDeps()
    );
    expect(first.listenOnly).toBe(true);
    const quiet = await runClaireTurn(
      { ...base, utterance: "", state, allowFragmentWait: true },
      turnDeps()
    );
    expect(quiet.listenOnly).toBe(true);
    expect(state.pendingFragment).toMatch(/for$/i);
  });
});

describe("V1 and V2 reason over the same assembled utterance", () => {
  it("a fragment held once is not a V2 reasoning turn", async () => {
    const state: ClaireTurnState = {};
    const held = await runClaireTurn({ ...base, utterance: "Desired timing is", state }, turnDeps());
    expect(held.listenOnly).toBe(true);
    expect(held.assembledUtterance).toBe("Desired timing is");
    expect(held.thoughtCompleteness).toBe("incomplete");
    expect(observationUtteranceForBrain(held).observe).toBe(false);
  });

  it("a naturally completed thought feeds V1 and V2 the same assembled text", async () => {
    const state: ClaireTurnState = {};
    const first = await runClaireTurn({ ...base, utterance: "Desired timing is", state }, turnDeps());
    expect(first.listenOnly).toBe(true);
    const second = await runClaireTurn(
      { ...base, utterance: "next Tuesday morning?", state },
      turnDeps()
    );
    expect(second.listenOnly).toBeFalsy();
    expect(second.assembledUtterance).toBe("Desired timing is next Tuesday morning?");
    const observation = observationUtteranceForBrain(second);
    expect(observation.observe).toBe(true);
    expect(observation.assembledText).toBe(second.assembledUtterance);
    expect(observation.completeness).toBe("complete");
  });

  it("a forced flush after CONTINUATION_MAX_HOLDS feeds V1 and V2 the same assembled text", async () => {
    const state: ClaireTurnState = {};
    const pieces: string[] = [];
    let last = await runClaireTurn({ ...base, utterance: "and then I kept going with more detail", state }, turnDeps());
    pieces.push("and then I kept going with more detail");
    for (let i = 0; i < CONTINUATION_MAX_HOLDS; i += 1) {
      const piece = `and then there was another thing I wanted to say number ${i}`;
      pieces.push(piece);
      last = await runClaireTurn({ ...base, utterance: piece, state }, turnDeps());
    }
    expect(last.listenOnly).toBeFalsy();
    expect(last.thoughtCompleteness).toBe("forced_flush");
    expect(last.assembledUtterance).toBe(pieces.join(" "));
    const observation = observationUtteranceForBrain(last);
    expect(observation.observe).toBe(true);
    expect(observation.assembledText).toBe(last.assembledUtterance);
    expect(observation.completeness).toBe("forced_flush");
  });

  it("an empty provider webhook is never a V2 semantic turn", async () => {
    const empty = await runClaireTurn({ ...base, utterance: "", state: {} }, turnDeps());
    expect(observationUtteranceForBrain(empty).observe).toBe(false);
    const quietHold = await runClaireTurn(
      { ...base, utterance: "", state: { pendingFragment: "He was my most recent order for", fragmentHolds: 1 } },
      turnDeps()
    );
    expect(quietHold.listenOnly).toBe(true);
    expect(observationUtteranceForBrain(quietHold).observe).toBe(false);
  });
});

describe("the listen-only re-gather is silent and short", () => {
  it("has no <Say>, uses the continuation grace as its start-of-speech timeout, and keeps auto endpointing", () => {
    const xml = preDriveConversationTwiML({ text: "", token: "t", listenOnly: true });
    expect(xml).not.toContain("<Say");
    expect(xml).toContain(`timeout="${CONTINUATION_GRACE_SECONDS}"`);
    expect(xml).toContain('speechTimeout="auto"');
    expect(CONTINUATION_GRACE_SECONDS).toBeLessThanOrEqual(3);
  });
});
