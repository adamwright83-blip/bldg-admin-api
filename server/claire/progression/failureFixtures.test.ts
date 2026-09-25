import { describe, expect, it } from "vitest";
import { hasUnresolvedIgnoredBoundary, deriveClaireRelationshipDimensions } from "../character/tierEngine";
import type { ClaireRelationshipEvent } from "../character/types";
import { recordConfirmedVisitEvidence } from "./evidenceSources";
import { evaluateProgression } from "./evaluate";
import { groupCustomerOrderTruth, mergeCustomerOrderTruth } from "../../geography/customerOrderTruth";
import { deriveProgressFromOrderTruth } from "./paidOrderProgress";
import { executePersonalTurn } from "./personalReveal";
import { recordProgressionEvidence, refreshProgression } from "./service";
import { createInMemoryProgressionStore } from "./store";
import { lintFailureDayLanguage } from "./toneLint";

const SCOPE = { tenantId: "t1", operatorUserId: "op1" };
const day = (n: number, hour = 15) => new Date(Date.UTC(2026, 8, n, hour));
const NOW = () => new Date(Date.UTC(2026, 9, 30, 15));
const oct = (n: number, hour = 15) => new Date(Date.UTC(2026, 9, n, hour));

/** Canonical order truth for one native paid order (identified by phone). */
function truthProgress(orders: Array<{ id: number; phone: string; slug: string | null; at: Date }>) {
  const records = mergeCustomerOrderTruth({
    native: orders.map(o => ({
      id: o.id, status: "completed", createdAt: o.at, firstName: "R", lastName: String(o.id), phone: o.phone,
      email: null, address: "1 Main St", unit: "1", buildingSlug: o.slug, bldgUserId: null, paid: true,
      stripePaymentIntentId: `pi_test_${o.id}`, total: "30",
    })),
  });
  return deriveProgressFromOrderTruth(groupCustomerOrderTruth("t1", records));
}

describe("failure-day tone (generated language, not just state)", () => {
  it("the acceptable Claire line passes every lint", () => {
    const line = "Six buildings, six no's. You still walked into six buildings. The Louise — real no, or come-back-later?";
    expect(lintFailureDayLanguage(line)).toEqual({ passes: true, violations: [] });
  });

  it.each([
    ["Don't be discouraged. Rejection is part of growth and I'm proud of you for pushing through.", ["consolation", "motivation"]],
    ["I'm disappointed. You let me down.", ["disappointment", "shame_or_pressure"]],
    ["Maybe you don't want this badly enough.", ["shame_or_pressure"]],
    ["That sounds like fear of rejection. Your mindset matters here.", ["diagnosis_or_coaching"]],
    ["I respect you less after that.", ["lowered_regard"]],
    ["Six no's. Anyway, my father disappeared, unresolved, when I was young.", ["volunteered_biography"]],
  ])("rejects: %s", (text, categories) => {
    const result = lintFailureDayLanguage(text);
    expect(result.passes).toBe(false);
    for (const category of categories) expect(result.violations.map(v => v.category)).toContain(category);
  });
});

describe("fixture: full effort, bad result", () => {
  it("six visits, six losses: action credited, rapport advances, no biography, nothing regresses", async () => {
    const store = createInMemoryProgressionStore();
    for (let i = 1; i <= 6; i += 1) {
      await recordConfirmedVisitEvidence({ ...SCOPE, missionId: i, outcome: "lost", occurredAt: day(i) }, store, NOW);
    }
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.counts.growthActions).toBe(6);
    expect(snap.grant.rapportBand).toBe(1); // >=3 actions across >=2 days
    expect(snap.grant.personalRung).toBe(0); // losses are not business progress
    expect(snap.counts.progressEvents).toBe(0);
    expect(await store.listEntitlements(SCOPE)).toHaveLength(0);
    // A loss is not representable as negative evidence at all.
    const evidence = await store.listEvidence(SCOPE);
    expect(evidence.every(item => item.category === "growth_action")).toBe(true);
  });

  it("with no entitlement Claire declines from an approved line and volunteers nothing", async () => {
    const store = createInMemoryProgressionStore();
    for (let i = 1; i <= 6; i += 1) await recordConfirmedVisitEvidence({ ...SCOPE, missionId: i, outcome: "lost", occurredAt: day(i) }, store, NOW);
    const result = await executePersonalTurn({
      store, scope: SCOPE, conversationId: "c1", topic: "father", businessOpen: true,
      generate: async () => { throw new Error("must not be called"); }, random: () => 0,
    });
    expect(result.outcome).toBe("declined");
    expect(lintFailureDayLanguage(result.text).passes).toBe(true);
  });
});

describe("fixture: partial completion", () => {
  it("six committed, two completed: two count, no penalty, no negative evidence for the rest", async () => {
    const store = createInMemoryProgressionStore();
    await recordConfirmedVisitEvidence({ ...SCOPE, missionId: 1, outcome: "follow_up", occurredAt: day(1) }, store, NOW);
    await recordConfirmedVisitEvidence({ ...SCOPE, missionId: 2, outcome: "follow_up", occurredAt: day(2) }, store, NOW);
    // The four undone items produce no evidence of any kind (they become operational state elsewhere).
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.counts.growthActions).toBe(2);
    expect(snap.grant.rapportBand).toBe(0);
    expect((await store.listEvidence(SCOPE)).length).toBe(2);
  });
});

describe("fixture: dry spell", () => {
  it("no work for months stalls progression, never demotes, and never yields an avoidance judgment", async () => {
    const store = createInMemoryProgressionStore();
    for (let i = 1; i <= 10; i += 1) await recordConfirmedVisitEvidence({ ...SCOPE, missionId: i, outcome: "lost", occurredAt: day(i) }, store, NOW);
    const earned = (await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW })).grant;
    const later = (await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => new Date(Date.UTC(2027, 3, 1)) })).grant;
    expect(later).toEqual(earned);
  });

  it("operator_avoidance is observational: it cannot lower reliability or affect any progression", () => {
    const events: ClaireRelationshipEvent[] = ["operator_follow_through", "operator_avoidance", "operator_avoidance"].map((eventType, i) => ({
      id: i + 1, tenantId: "t", operatorUserId: "o", characterId: "claire", eventType: eventType as ClaireRelationshipEvent["eventType"],
      summary: "", provenance: "", relatedEntityType: null, relatedEntityId: null, evidenceSource: null,
      occurredAt: day(i + 1).toISOString(), createdAt: day(i + 1).toISOString(),
    }));
    expect(deriveClaireRelationshipDimensions(events).reliability).toBe(2);
    expect(hasUnresolvedIgnoredBoundary(events)).toBe(false);
  });
});

describe("fixture: lucky result", () => {
  it("a paid order without consistency is real business movement but skips nothing", async () => {
    const store = createInMemoryProgressionStore();
    const [progress] = truthProgress([{ id: 1, phone: "310-555-0101", slug: null, at: oct(20) }]);
    await recordProgressionEvidence(store, { ...SCOPE, ...progress }, NOW);
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.counts.progressEvents).toBe(1); // the business result stays real
    expect(snap.grant.personalRung).toBe(0); // but consistency cannot be skipped
    expect(snap.mintedEntitlementIds).toHaveLength(0);
  });
});

describe("fixture: consistency plus genuine progress", () => {
  it("rung advances silently, mints one entitlement, volunteers nothing, and a later ask is answered", async () => {
    const store = createInMemoryProgressionStore();
    for (let i = 1; i <= 6; i += 1) await recordConfirmedVisitEvidence({ ...SCOPE, missionId: i, outcome: "lost", occurredAt: day(i) }, store, NOW);
    const [louise] = truthProgress([{ id: 7, phone: "310-555-0102", slug: "the-louise", at: oct(24) }]);
    expect(louise.kind).toBe("new_paying_customer");
    await recordProgressionEvidence(store, { ...SCOPE, ...louise }, NOW);
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.grant.personalRung).toBe(1);
    expect(snap.mintedEntitlementIds).toHaveLength(1);
    // Nothing was announced or volunteered: no ledger rows exist until the operator asks.
    expect(await store.listLedger(SCOPE)).toHaveLength(0);
    const answer = await executePersonalTurn({
      store, scope: SCOPE, conversationId: "later-call", topic: "father", businessOpen: true, random: () => 0,
      generate: async () => "He was an academic, on paper.",
    });
    expect(answer.outcome).toBe("answered_new_disclosure");
  });
});

describe("evaluation guards", () => {
  it("evaluateProgression never counts unrecognized events", () => {
    const ev = evaluateProgression({ evidence: [], disclosureSafetyOk: true, prior: null, asOf: NOW() });
    expect(ev.grant.personalRung).toBe(0);
  });
});
