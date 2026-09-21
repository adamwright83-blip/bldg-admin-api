import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConversationSession, persistSpokenTurn, attachConversationKind, productionConversationStore } from "./ledgerService";
import { createMemoryClaireConversationStore, setClaireConversationStoreForTesting } from "./memoryStore";

beforeEach(() => {
  setClaireConversationStoreForTesting(createMemoryClaireConversationStore());
});

afterEach(() => {
  setClaireConversationStoreForTesting(null);
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

  it("can retag conversationKind when inbound enrichment resolves a real workday session", async () => {
    await createConversationSession({
      tenantId: "default",
      operatorUserId: "adam-admin",
      claireConversationId: "conv-kind",
      conversationKind: "pre_drive",
      recordingEnabled: false,
      providerCallSid: "CA-KIND",
    });
    const updated = await attachConversationKind({
      claireConversationId: "conv-kind",
      conversationKind: "morning_reconciliation",
    });
    expect(updated?.conversationKind).toBe("morning_reconciliation");
    const stored = await productionConversationStore().getSessionByClaireId("conv-kind");
    expect(stored?.conversationKind).toBe("morning_reconciliation");
  });
});
