import { describe, expect, it, vi } from "vitest";
import { acquireDeskTurnLock, saveDeskConversationState } from "./deskTurnState";
import { createMemoryConversationStateStore } from "./turn/conversationStateStore";

describe("Claire Desk turns for one conversation", () => {
  it("run one at a time, in arrival order", async () => {
    const order: string[] = [];
    const turn = async (name: string, ms: number) => {
      const release = await acquireDeskTurnLock("claire-desk:t:1:desk");
      try {
        order.push(`${name} start`);
        await new Promise(resolve => setTimeout(resolve, ms));
        order.push(`${name} end`);
      } finally {
        release();
      }
    };
    await Promise.all([turn("a", 20), turn("b", 1), turn("c", 1)]);
    expect(order).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
  });

  it("a failed turn still lets the next one run", async () => {
    const first = acquireDeskTurnLock("claire-desk:t:2:desk").then(release => {
      try { throw new Error("turn failed"); } finally { release(); }
    });
    await expect(first).rejects.toThrow("turn failed");
    const release = await acquireDeskTurnLock("claire-desk:t:2:desk");
    release();
  });

  it("keeps the newer state when another writer saved after this turn loaded", async () => {
    const store = createMemoryConversationStateStore();
    const owner = { tenantId: "t", operatorUserId: "op", surface: "text" as const };
    await store.save("k", owner, { turn: "first" }, 60_000);
    const loaded = await store.load<{ turn: string }>("k");
    await store.save("k", owner, { turn: "newer" }, 60_000);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await saveDeskConversationState(store, "k", owner, { turn: "stale" }, loaded!.version, 60_000);
    expect((await store.load<{ turn: string }>("k"))!.state).toEqual({ turn: "newer" });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const current = await store.load<{ turn: string }>("k");
    await saveDeskConversationState(store, "k", owner, { turn: "next" }, current!.version, 60_000);
    expect((await store.load<{ turn: string }>("k"))!.state).toEqual({ turn: "next" });
  });
});
