import { describe, expect, it } from "vitest";
import { recordConfirmedVisitEvidence } from "./evidenceSources";
import { buildPersonalDisclosureGuidance, executePersonalTurn } from "./personalReveal";
import { deriveTopicHistory, loadPersonalProgressionContext, refreshProgression } from "./service";
import { createInMemoryProgressionStore } from "./store";
import { deriveMomentStance, momentStanceGuidance } from "./momentStance";
import { CLAIRE_CANON } from "../character/characterDefinition";

const SCOPE = { tenantId: "t1", operatorUserId: "op1" };
const NOW = () => new Date(Date.UTC(2026, 9, 30, 15));
const day = (n: number) => new Date(Date.UTC(2026, 8, n, 15));

async function effortOnlyStore() {
  const store = createInMemoryProgressionStore();
  for (let i = 1; i <= 6; i += 1) await recordConfirmedVisitEvidence({ ...SCOPE, missionId: i, outcome: "lost", occurredAt: day(i) }, store, NOW);
  await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
  return store;
}
const ask = (store: ReturnType<typeof createInMemoryProgressionStore>, conversationId: string) =>
  executePersonalTurn({ store, scope: SCOPE, conversationId, topic: "father", businessOpen: true, random: () => 0, generate: async () => { throw new Error("no answer authorised"); }, now: NOW });

describe("personal-topic history is durable, derived, and not a currency", () => {
  it("derives ask/refusal counts from the existing ledger across conversations", async () => {
    const store = await effortOnlyStore();
    await ask(store, "call-1");
    await ask(store, "call-2");
    await ask(store, "call-3");
    const context = await loadPersonalProgressionContext(store, SCOPE, "call-4", NOW);
    expect(context.topicHistory.father).toMatchObject({ askCount: 3, refusalCount: 3 });
    expect(context.topicHistory.father?.lastRefusedAt).toBeTruthy();
    expect(context.priorRefusedTopics).toContain("father"); // the old boolean is still derivable
  });

  it("repeated asking changes neither rapport, rung, entitlements, evidence, nor the decision", async () => {
    const store = await effortOnlyStore();
    const before = { grant: await store.getGrant(SCOPE), evidence: (await store.listEvidence(SCOPE)).length, entitlements: (await store.listEntitlements(SCOPE)).length };
    const outcomes: string[] = [];
    for (let i = 1; i <= 6; i += 1) outcomes.push((await ask(store, `call-${i}`)).outcome);
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(outcomes.every(outcome => outcome === "declined")).toBe(true);
    expect(await store.getGrant(SCOPE)).toEqual(before.grant);
    expect((await store.listEvidence(SCOPE)).length).toBe(before.evidence);
    expect((await store.listEntitlements(SCOPE)).length).toBe(before.entitlements);
    expect(before.grant?.personalRung).toBe(0);
  });

  it("later presentation can tell repeated asking apart while permission is unchanged", () => {
    const fragment = CLAIRE_CANON.find(f => f.accessClass === "core" && f.fact)!;
    const plan = { kind: "answer", basis: "core", fragment, needsEntitlement: false, isFollowUpOnDisclosedSubject: false, previouslyRefusedTopic: true, closesThreadAfter: false } as const;
    const first = buildPersonalDisclosureGuidance({ fragment, plan, rapportBand: 1, rung: 0, previouslyRefusedTopic: true, topicHistory: { askCount: 1, refusalCount: 1 } });
    const fifth = buildPersonalDisclosureGuidance({ fragment, plan, rapportBand: 1, rung: 0, previouslyRefusedTopic: true, topicHistory: { askCount: 5, refusalCount: 5 } });
    expect(fifth).not.toBe(first);
    expect(fifth).toMatch(/Repetition earns nothing/);
    expect(fifth).toMatch(new RegExp(`ONLY personal fact you may draw on: "${fragment.fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });

  it("derivation is pure over the ledger", () => {
    expect(deriveTopicHistory([])).toEqual({});
  });
});

describe("current-moment stance is presentation only", () => {
  it("does not mutate progression state", async () => {
    const store = await effortOnlyStore();
    const snapshot = JSON.stringify({ grant: await store.getGrant(SCOPE), evidence: await store.listEvidence(SCOPE), ledger: await store.listLedger(SCOPE), entitlements: await store.listEntitlements(SCOPE) });
    for (const stance of [deriveMomentStance({ urgentBusinessOpen: true, businessAgendaFinished: false, difficultVerifiedDay: true, sharedSetback: true, boundaryPushesThisCall: 5 }), deriveMomentStance({ urgentBusinessOpen: false, businessAgendaFinished: true, difficultVerifiedDay: false, sharedSetback: false, boundaryPushesThisCall: 0 })]) {
      momentStanceGuidance(stance);
    }
    expect(JSON.stringify({ grant: await store.getGrant(SCOPE), evidence: await store.listEvidence(SCOPE), ledger: await store.listLedger(SCOPE), entitlements: await store.listEntitlements(SCOPE) })).toBe(snapshot);
  });

  it("maps real context to a bounded tone, and never speaks of levels, unlocks, trust, or scores", () => {
    const signals = { urgentBusinessOpen: false, businessAgendaFinished: false, difficultVerifiedDay: false, sharedSetback: false, boundaryPushesThisCall: 0 };
    expect(deriveMomentStance(signals)).toBe("neutral");
    expect(deriveMomentStance({ ...signals, urgentBusinessOpen: true })).toBe("brisk");
    expect(deriveMomentStance({ ...signals, difficultVerifiedDay: true })).toBe("soft");
    expect(deriveMomentStance({ ...signals, boundaryPushesThisCall: 3 })).toBe("firm");
    for (const stance of ["brisk", "soft", "firm", "amused", "familiar"] as const) {
      const text = momentStanceGuidance(stance)!;
      expect(text).not.toMatch(/\b(level|unlock|trust|score|points?|xp|hearts?|affection|rung|band)\b/i);
      expect(text).toMatch(/not what is true or what you may say/);
    }
  });
});
