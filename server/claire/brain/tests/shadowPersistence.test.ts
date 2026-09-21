import { describe, expect, it } from "vitest";
import { createMemoryConversationStateStore } from "../../turn/conversationStateStore";
import {
  createDurableShadowMemoryStore,
  emptyShadowMemory,
  shadowMemoryKey,
} from "../shadow/shadowMemory";

describe("durable Brain V2 shadow memory", () => {
  it("reloads V2 cognitive state through a new adapter without touching a V1 key", async () => {
    const underlying = createMemoryConversationStateStore();
    const firstProcess = createDurableShadowMemoryStore(underlying, 60_000);
    const address = {
      tenantId: "default",
      operatorUserId: "adam-admin",
      conversationKey: "claire-call:persistence",
    };
    const key = shadowMemoryKey(address);
    const memory = {
      ...emptyShadowMemory(),
      focusEntities: [
        {
          mentioned: "Dana",
          contactName: "Dana",
          accountId: 77,
          accountName: "The Louise",
        },
      ],
      unresolvedReferences: ["which Tuesday"],
      priorDecisionRefs: ["BusinessJudgmentSegment"],
      updatedAtMs: 123,
    };

    await firstProcess.save(key, memory, {
      tenantId: address.tenantId,
      operatorUserId: address.operatorUserId,
      surface: "voice",
    });

    const nextProcess = createDurableShadowMemoryStore(underlying, 60_000);
    expect(await nextProcess.load(key)).toEqual(memory);
    expect(key).toMatch(/^claire-brain-v2-shadow:/);
    expect(await underlying.load(address.conversationKey)).toBeNull();
  });

  it("honors the bounded TTL of the underlying conversation store", async () => {
    const underlying = createMemoryConversationStateStore();
    const store = createDurableShadowMemoryStore(underlying, 5);
    const key = shadowMemoryKey({
      tenantId: "default",
      operatorUserId: "adam-admin",
      conversationKey: "ttl",
    });
    await store.save(key, emptyShadowMemory(), {
      tenantId: "default",
      operatorUserId: "adam-admin",
      surface: "text",
    });
    expect((await underlying.load(key, Date.now() + 10))?.state ?? null).toBeNull();
  });
});
