import { describe, expect, it, vi } from "vitest";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import type { ClaireDriveContext } from "../contextAssembler";
import { buildClaireClock, CLAIRE_BUSINESS_TIME_ZONE } from "../contextAssembler";
import { AUTHORED_DIALOGUE } from "./authoredDialogue";
import { commitPendingDisclosuresForConversation, recordProgressionEvidence, refreshProgression } from "./service";
import { createInMemoryProgressionStore } from "./store";

const context = {
  businessDate: "2026-09-18",
  actorId: "op-1",
  clock: buildClaireClock(new Date("2026-09-18T20:00:00Z"), CLAIRE_BUSINESS_TIME_ZONE),
  macroGoalKnown: false,
  blockers: [],
  relevantTimeline: [],
  mission: null,
} as unknown as ClaireDriveContext;

const SCOPE = { tenantId: "tenant-1", operatorUserId: "op-1" };
const at = (n: number) => new Date(Date.UTC(2026, 7, n, 15));

async function earned() {
  const store = createInMemoryProgressionStore();
  for (let i = 1; i <= 6; i += 1) {
    await recordProgressionEvidence(store, { ...SCOPE, category: "growth_action", kind: "confirmed_field_visit", sourceType: "m", sourceId: `a${i}`, provenance: "debrief_confirm", occurredAt: at(i), recognizedAt: at(i) });
  }
  await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "target_account_won", sourceType: "m", sourceId: "w", provenance: "debrief_confirm", occurredAt: new Date(Date.UTC(2026, 9, 10, 15)), recognizedAt: new Date(Date.UTC(2026, 9, 10, 15)) });
  await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => new Date(Date.UTC(2026, 9, 11, 15)) });
  return store;
}

describe("live personal path (answerClairePreDriveFollowUp)", () => {
  it("earned + asked: the model sees ONLY the bounded fragment, and the reveal commits only at the delivery boundary", async () => {
    const store = await earned();
    const invokeText = vi.fn().mockResolvedValueOnce("He was an academic, on paper.").mockResolvedValueOnce("ENTAILED");
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What happened with your father?", brief: "b", context, conversationId: "call-1" },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: store }
    );
    expect(reply).toBe("He was an academic, on paper.");
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system).toContain("intelligence work");
    expect(system).not.toMatch(/disappeared/i); // the higher-rung fragment is not in the prompt
    expect(system).not.toMatch(/six-year/i);
    // Reserved, not yet consumed: delivery has not been confirmed.
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("reserved");
    expect(await commitPendingDisclosuresForConversation(store, { tenantId: "tenant-1", conversationId: "call-1" })).toBe(1);
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("consumed");
  });

  it("a personal question with nothing earned never calls the model and answers from an approved line", async () => {
    const invokeText = vi.fn();
    const reply = await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What happened with your father?", brief: "b", context, conversationId: "call-2" },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: createInMemoryProgressionStore() }
    );
    expect(invokeText).not.toHaveBeenCalled();
    expect(AUTHORED_DIALOGUE.map(l => l.text)).toContain(reply);
  });

  it("non-personal turns can never volunteer gated biography, even for a fully earned operator", async () => {
    const store = await earned();
    const invokeText = vi.fn().mockResolvedValue("Two commercial stops today.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "What should I say about pricing?", brief: "b", context, conversationId: "call-3" },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined), progressionStore: store }
    );
    const system = invokeText.mock.calls[0][0].messages[0].content as string;
    expect(system).not.toMatch(/intelligence work|disappeared|six-year|internationally mobile/i);
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("unused");
  });
});
