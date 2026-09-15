import { beforeEach, describe, expect, it } from "vitest";
import { createConversationSession, persistSpokenTurn, productionConversationStore } from "./ledgerService";
import { createMemoryClaireConversationStore, setClaireConversationStoreForTesting } from "./memoryStore";

beforeEach(() => {
  setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
});

describe("the call ledger keeps every real turn", () => {
  it("two separate 'yes' replies on different turns are both kept; a retry of the same turn is not duplicated", async () => {
    await createConversationSession({
      tenantId: "default",
      operatorUserId: "adam-admin",
      claireConversationId: "conv-yes-yes",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-YES",
    });
    const first = await persistSpokenTurn({ callSid: "CA-YES", speaker: "OPERATOR", text: "yes", turnKey: 3 });
    const retry = await persistSpokenTurn({ callSid: "CA-YES", speaker: "OPERATOR", text: "yes", turnKey: 3 });
    const second = await persistSpokenTurn({ callSid: "CA-YES", speaker: "OPERATOR", text: "yes", turnKey: 5 });
    expect(retry?.id).toBe(first?.id);
    expect(second?.id).not.toBe(first?.id);
    const turns = await productionConversationStore().listTurns(first!.sessionId);
    expect(turns.map(turn => turn.text)).toEqual(["yes", "yes"]);
  });
});
