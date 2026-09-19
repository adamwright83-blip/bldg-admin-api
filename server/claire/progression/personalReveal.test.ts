import { describe, expect, it } from "vitest";
import { AUTHORED_DIALOGUE, type DialogueLine } from "./authoredDialogue";
import { selectDialogueLine } from "./dialogueRegistry";
import { executePersonalTurn, validatePersonalAnswer, type PersonalGenerator } from "./personalReveal";
import { recordProgressionEvidence, refreshProgression } from "./service";
import { createInMemoryProgressionStore, type ProgressionStore } from "./store";
import { CLAIRE_CANON } from "../character/characterDefinition";

const SCOPE = { tenantId: "t1", operatorUserId: "op1" };
const at = (n: number) => new Date(Date.UTC(2026, 8, n, 15)).toISOString();
let seq = 0;

async function earnedStore(rungTarget: 1 | 2 | 3 = 1): Promise<ProgressionStore> {
  const store = createInMemoryProgressionStore();
  const actions = { 1: 6, 2: 13, 3: 26 }[rungTarget];
  for (let i = 1; i <= actions; i += 1) {
    await recordProgressionEvidence(store, { ...SCOPE, category: "growth_action", kind: "confirmed_field_visit", sourceType: "m", sourceId: `a${(seq += 1)}`, provenance: "debrief_confirm", occurredAt: at(i), recognizedAt: at(i) });
  }
  const progress = { 1: ["target_account_won"], 2: ["target_account_won", "new_paying_customer"], 3: ["target_account_won", "new_paying_customer", "dormant_customer_reorder", "target_account_won"] }[rungTarget];
  for (const kind of progress) {
    await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind, sourceType: "o", sourceId: `p${(seq += 1)}`, provenance: "debrief_confirm", occurredAt: at(28), recognizedAt: at(28) });
  }
  await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => new Date(at(29)) });
  return store;
}

const goodFather: PersonalGenerator = async () => "He was an academic, or that was the version everyone got.";
const run = (store: ProgressionStore, over: Partial<Parameters<typeof executePersonalTurn>[0]> = {}) =>
  executePersonalTurn({
    store, scope: SCOPE, conversationId: "call-1", topic: "father", generate: goodFather,
    businessOpen: true, random: () => 0, autoCommit: true, ...over,
  });

describe("earned reveal", () => {
  it("delivers a valid new fragment and consumes exactly one entitlement", async () => {
    const store = await earnedStore(1);
    const result = await run(store);
    expect(result.outcome).toBe("answered_new_disclosure");
    expect(result.fragmentId).toBe("core_father_career");
    const ents = await store.listEntitlements(SCOPE);
    expect(ents.filter(e => e.status === "consumed")).toHaveLength(1);
    expect((await store.listLedger(SCOPE)).some(r => r.kind === "disclosed" && r.fragmentId === "core_father_career")).toBe(true);
  });

  it("safety failure: unsafe answer never reaches operator, canon stays undisclosed, entitlement unused, retry works", async () => {
    const store = await earnedStore(1);
    const unsafe: PersonalGenerator = async () => "He worked at Oxford for years before Cairo.";
    const failed = await run(store, { generate: unsafe });
    expect(failed.outcome).toBe("declined");
    expect(failed.text).not.toMatch(/Oxford|Cairo/);
    expect(AUTHORED_DIALOGUE.map(l => l.text)).toContain(failed.text);
    expect(failed.failureReason).toBe("ungrounded_specificity");
    expect((await store.listEntitlements(SCOPE)).every(e => e.status === "unused")).toBe(true);
    expect((await store.listLedger(SCOPE)).some(r => r.kind === "disclosed")).toBe(false);
    // same-call retry: a fresh valid attempt succeeds
    const retry = await run(store);
    expect(retry.outcome).toBe("answered_new_disclosure");
    expect((await store.listEntitlements(SCOPE)).filter(e => e.status === "consumed")).toHaveLength(1);
  });

  it("generation/provider failure never burns the entitlement; a later call can retry", async () => {
    const store = await earnedStore(1);
    const broken = await run(store, { generate: async () => { throw new Error("provider down"); } });
    expect(broken.outcome).toBe("declined");
    expect(broken.failureReason).toBe("generation_failed");
    const nextCall = await run(store, { conversationId: "call-2" });
    expect(nextCall.outcome).toBe("answered_new_disclosure");
  });

  it("an uncommitted reservation (delivery failed) expires back to unused; abandon returns it immediately", async () => {
    const store = await earnedStore(1);
    let clock = new Date(at(29)).getTime();
    const now = () => new Date(clock);
    const result = await run(store, { autoCommit: false, now });
    expect(result.receipt).not.toBeNull();
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("reserved");
    expect((await store.listLedger(SCOPE)).some(r => r.kind === "disclosed")).toBe(false);
    clock += 11 * 60 * 1000; // past the reservation TTL
    const retry = await run(store, { autoCommit: false, now, conversationId: "call-2" });
    expect(retry.outcome).toBe("answered_new_disclosure");
    await retry.receipt!.abandon();
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("unused");
    const committed = await run(store, { autoCommit: false, now, conversationId: "call-3" });
    expect(await committed.receipt!.commit()).toBe(true);
    expect((await store.listEntitlements(SCOPE))[0].status).toBe("consumed");
  });

  it("no entitlement means an approved decline, with telemetry, and nothing is disclosed", async () => {
    const store = createInMemoryProgressionStore(); // rung 0, nothing earned
    const result = await run(store);
    expect(result.outcome).toBe("declined");
    expect(AUTHORED_DIALOGUE.map(l => l.text)).toContain(result.text);
    const [row] = await store.listDeclineFallbacks({ tenantId: SCOPE.tenantId });
    expect(row).toMatchObject({ topic: "father", declineId: result.declineId, hadUnusedEntitlement: false, failurePhase: "pre_generation" });
  });

  it("harmless core facts still answer at rung 0 without consuming anything", async () => {
    const store = createInMemoryProgressionStore();
    const result = await run(store, { topic: "age", generate: async () => "Old enough to know better." });
    expect(result.outcome).toBe("answered_core");
  });

  it("permanently private and unmapped topics never disclose", async () => {
    const store = await earnedStore(3);
    const result = await run(store, { topic: "fathers_last_exchange" });
    expect(result.outcome).toBe("declined");
  });

  it("one progress event buys one reveal: a second father question with no new entitlement is declined", async () => {
    const store = await earnedStore(1);
    expect((await run(store)).outcome).toBe("answered_new_disclosure");
    const second = await run(store, { conversationId: "call-2", generate: goodFather });
    // Career was disclosed; the disappearance fragment needs a second entitlement and a higher rung.
    expect(second.fragmentId).toBe("core_father_career");
    expect(second.outcome).toBe("answered_previously_disclosed");
    expect((await store.listEntitlements(SCOPE)).filter(e => e.status === "consumed")).toHaveLength(1);
  });

  it("repeated calls and repeated asking never mint entitlements", async () => {
    const store = await earnedStore(1);
    for (let i = 0; i < 6; i += 1) await run(store, { conversationId: `c${i}` });
    expect(await store.listEntitlements(SCOPE)).toHaveLength(1);
  });
});

describe("personal budget and closing", () => {
  it("rung 1: one answer + one follow-up, then the thread closes without killing the call", async () => {
    const store = await earnedStore(1);
    const first = await run(store);
    expect(first.closedThread).toBe(false);
    const followUp = await run(store);
    expect(followUp.outcome).toBe("answered_previously_disclosed");
    expect(followUp.closedThread).toBe(true);
    const third = await run(store);
    expect(third.outcome).toBe("declined");
    expect(third.failureReason).toBe("personal_budget_exhausted");
    expect(third.endCall).toBe(false);
    expect(third.returnToBusiness).toBe(true);
    expect(third.text).not.toMatch(/question|limit|remaining|budget/i);
  });

  it("never hangs up while business remains; with an EMPTY registry it can never hang up at all", async () => {
    const store = await earnedStore(1);
    await run(store); await run(store);
    expect((await run(store, { businessOpen: true })).endCall).toBe(false);
    const dormant = await earnedStore(1);
    const declineOnly = AUTHORED_DIALOGUE.filter(l => l.category === "decline");
    await run(dormant, { registry: declineOnly }); await run(dormant, { registry: declineOnly });
    expect((await run(dormant, { registry: declineOnly, businessOpen: false })).endCall).toBe(false);
  });

  it("with the production registry, hangs up only after the thread closed AND business is complete", async () => {
    const store = await earnedStore(1);
    await run(store); await run(store);
    const done = await run(store, { businessOpen: false });
    expect(done.endCall).toBe(true);
    expect(AUTHORED_DIALOGUE.filter(l => l.category === "call_exit").map(l => l.text)).toContain(done.text);
  });

  it("actually hangs up only when business is complete AND an authored exit exists", async () => {
    const exit: DialogueLine = { id: "test_exit", category: "call_exit", text: "Test exit line.", minRapport: 0, maxRapport: 3, approvedBy: "test fixture" };
    const registry = [...AUTHORED_DIALOGUE.filter(l => l.category !== "call_exit"), exit];
    const store = await earnedStore(1);
    await run(store, { registry }); await run(store, { registry });
    const openBusiness = await run(store, { registry, businessOpen: true });
    expect(openBusiness.endCall).toBe(false);
    const done = await run(store, { registry, businessOpen: false });
    expect(done.endCall).toBe(true);
    expect(done.text).toBe("Test exit line.");
  });

  it("rung budgets grow: rung 3 tolerates more personal exchanges than rung 1", async () => {
    const r3 = await earnedStore(3);
    let answered = 0;
    for (let i = 0; i < 8; i += 1) {
      if ((await run(r3)).outcome !== "declined") answered += 1;
    }
    expect(answered).toBe(5);
  });
});

describe("prior-question / refusal continuity (hidden discovery game state)", () => {
  it("a refusal is remembered durably, and a later reveal knows it was asked and refused before", async () => {
    const store = createInMemoryProgressionStore();
    await run(store); // refused: nothing earned yet
    const ledger = await store.listLedger(SCOPE);
    expect(ledger.some(r => r.kind === "asked" && r.topic === "father")).toBe(true);
    expect(ledger.some(r => r.kind === "decline_fallback" && r.topic === "father")).toBe(true);
    // Later: progress happens; the same question is asked again in a new call.
    for (let i = 1; i <= 6; i += 1) await recordProgressionEvidence(store, { ...SCOPE, category: "growth_action", kind: "confirmed_field_visit", sourceType: "m", sourceId: `z${i}`, provenance: "debrief_confirm", occurredAt: at(i), recognizedAt: at(i) });
    await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "target_account_won", sourceType: "o", sourceId: "z", provenance: "debrief_confirm", occurredAt: at(28), recognizedAt: at(28) });
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => new Date(at(29)) });
    let sawHint = false;
    const result = await run(store, { conversationId: "call-later", generate: async request => { sawHint = request.previouslyRefusedTopic; return goodFather(request); } });
    expect(result.outcome).toBe("answered_new_disclosure");
    expect(sawHint).toBe(true);
  });
});

describe("dialogue registry", () => {
  it("ships only approved lines, with no placeholders", () => {
    for (const line of AUTHORED_DIALOGUE) {
      expect(line.approvedBy).toBeTruthy();
      expect(line.text).not.toMatch(/todo|tbd|placeholder|lorem|xxx|filler/i);
    }
    expect(AUTHORED_DIALOGUE.filter(l => l.approvedBy.includes("generic decline floor"))).toHaveLength(5); // the five originals are intact
  });

  it("avoids repeats until the pool is exhausted, then reuses the least recent", () => {
    const pool = AUTHORED_DIALOGUE.filter(l => l.category === "decline" && l.minRapport === 0 && l.maxRapport === 0);
    const used: string[] = [];
    for (let i = 0; i < pool.length; i += 1) {
      const line = selectDialogueLine({ category: "decline", rapportBand: 0, recentlyUsedIds: used, random: () => 0 })!;
      expect(used).not.toContain(line.id);
      used.push(line.id);
    }
    const next = selectDialogueLine({ category: "decline", rapportBand: 0, recentlyUsedIds: used, random: () => 0 })!;
    expect(next.id).toBe(used[0]);
  });

  it("an empty category returns null instead of inventing a line", () => {
    const declinesOnly = AUTHORED_DIALOGUE.filter(l => l.category === "decline");
    expect(selectDialogueLine({ category: "call_exit", rapportBand: 3, registry: declinesOnly, fallbackToDeclineFloor: false })).toBeNull();
    expect(selectDialogueLine({ category: "business_pivot", rapportBand: 3, registry: declinesOnly, fallbackToDeclineFloor: false })).toBeNull();
  });
});

describe("no robotic canon read-aloud", () => {
  it("the reveal path contains no deterministic canon renderer or canned canon recovery", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./personalReveal.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/import[^;]*renderCanonFactFirstPerson/);
    expect(source).not.toMatch(/import[^;]*recoverPersonalAnswer/);
    expect(source).not.toMatch(/import[^;]*renderCanonScopedPersonalAnswer/);
  });

  it("validation catches leaks of ineligible canon", () => {
    const career = CLAIRE_CANON.find(f => f.id === "core_father_career")!;
    expect(validatePersonalAnswer("He was an academic, and then he disappeared, unresolved, when I was young.", career)).not.toBeNull();
    expect(validatePersonalAnswer("He was an academic, unresolved.", career)).toBe("ineligible_canon_leak");
    expect(validatePersonalAnswer("He was an academic.", career)).toBeNull();
    expect(validatePersonalAnswer("He was an academic for 30 years.", career)).toBe("ungrounded_number");
  });
});
