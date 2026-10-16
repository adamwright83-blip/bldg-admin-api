import { describe, expect, it } from "vitest";
import { conversationHistoryForModel, looksUnfinished, replyDecision } from "./claireTurn";
import { createDatabaseConversationStateStore, createMemoryConversationStateStore } from "./conversationStateStore";

const owner = { tenantId: "default", operatorUserId: "adam-admin", surface: "voice" as const };

describe("durable conversation state", () => {
  it("keeps state until it expires and hands back copies, never shared references", async () => {
    const store = createMemoryConversationStateStore();
    await store.save("claire-call:1", owner, { turns: 1 }, 1_000, 0);
    const loaded = await store.load<{ turns: number }>("claire-call:1", 500);
    expect(loaded?.state).toEqual({ turns: 1 });
    loaded!.state.turns = 99;
    expect((await store.load<{ turns: number }>("claire-call:1", 600))?.state).toEqual({ turns: 1 });
    expect(await store.load("claire-call:1", 1_001)).toBeNull();
  });

  it("degrades to process memory, rather than forgetting the call, when the database is unreachable", async () => {
    const store = createDatabaseConversationStateStore();
    await store.save("claire-call:2", owner, { pendingBriefing: { createdAt: 1 } }, 60_000);
    expect((await store.load<{ pendingBriefing: { createdAt: number } }>("claire-call:2"))?.state.pendingBriefing.createdAt).toBe(1);
    await store.remove("claire-call:2");
    expect(await store.load("claire-call:2")).toBeNull();
  });
});

describe("what counts as an answer to Claire's question", () => {
  it.each([
    ["Yes.", "yes", ""],
    ["Yeah, add them all", "yes", ""],
    ["Yeah, that's right.", "yes", ""],
    ["Yes, go ahead.", "yes", ""],
    ["Yep, add that.", "yes", ""],
    ["Yeah that one.", "yes", ""],
    ["Yes, and also pick up hangers", "yes", "pick up hangers"],
    ["No.", "no", ""],
    ["Nope, not now", "no", ""],
    ["Maybourne is no longer a good opportunity, so we can remove that.", "other", "Maybourne is no longer a good opportunity, so we can remove that."],
    ["What was revenue last month?", "other", "What was revenue last month?"],
  ])("%s", (utterance, decision, remainder) => {
    expect(replyDecision(utterance)).toEqual({ decision, remainder });
  });

  it("a phone thought cut off at a pause is recognized", () => {
    expect(looksUnfinished("Desired timing is.")).toBe(true);
    expect(looksUnfinished("and then I have to")).toBe(true);
    expect(looksUnfinished("Timing is 9:30am.")).toBe(false);
    expect(looksUnfinished("Yes.")).toBe(false);
  });
});


describe("speech is not automatically heard", () => {
  it("keeps generated and interrupted responses distinct from playback-confirmed responses", () => {
    const history = conversationHistoryForModel([
      { speaker: "operator", text: "Save it.", at: 1 },
      { speaker: "claire", text: "It is saved.", at: 2, delivery: "generated" },
      { speaker: "claire", text: "Here is the plan.", at: 3, delivery: "interrupted" },
      { speaker: "claire", text: "Which day?", at: 4, delivery: "confirmed_heard" },
    ]);
    expect(history.map(turn => turn.text)).toEqual(["Save it.", "[Playback unconfirmed] It is saved.", "[Playback interrupted] Here is the plan.", "Which day?"]);
  });
});
