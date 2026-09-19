import { describe, expect, it } from "vitest";
import { evaluateProgression, EMPTY_GRANT } from "./evaluate";
import { PROGRESSION_POLICY, type ProgressionPolicy } from "./policy";
import { recordProgressionEvidence, refreshProgression } from "./service";
import { createInMemoryProgressionStore } from "./store";
import { validateEvidenceInput, type ProgressionEvidence } from "./evidence";

const SCOPE = { tenantId: "t1", operatorUserId: "op1" };
const day = (n: number) => new Date(Date.UTC(2026, 8, n, 15)).toISOString();
/** Business results must occur on/after the progress epoch (2026-09-19) to qualify. */
const oct = (n: number) => new Date(Date.UTC(2026, 9, n, 15)).toISOString();

let seq = 0;
async function addActions(store: ReturnType<typeof createInMemoryProgressionStore>, days: number[]) {
  for (const d of days) {
    await recordProgressionEvidence(store, {
      ...SCOPE, category: "growth_action", kind: "confirmed_field_visit",
      sourceType: "commercial_mission", sourceId: `m${(seq += 1)}`, provenance: "debrief_confirm",
      occurredAt: day(d), recognizedAt: day(d),
    });
  }
}
async function addProgress(store: ReturnType<typeof createInMemoryProgressionStore>, kind: string, id: string, d: number, recognizedDay = d) {
  return recordProgressionEvidence(store, {
    ...SCOPE, category: "business_progress", kind, sourceType: "order", sourceId: id,
    provenance: "cleancloud_import", occurredAt: oct(d), recognizedAt: oct(recognizedDay),
  });
}
const NOW = () => new Date(Date.UTC(2026, 9, 30));

describe("two currencies", () => {
  it("chat/call volume is never story currency", () => {
    for (const kind of ["call_completed", "chat_turn", "mission_accepted", "path_chosen", "opened_app"]) {
      expect(validateEvidenceInput({ category: "growth_action", kind, occurredAt: day(1), recognizedAt: day(1) }).ok).toBe(false);
      expect(validateEvidenceInput({ category: "business_progress", kind, occurredAt: day(1), recognizedAt: day(1) }).ok).toBe(false);
    }
  });

  it("a hundred completed calls with no growth work unlock nothing", async () => {
    const store = createInMemoryProgressionStore();
    for (let i = 0; i < 100; i += 1) {
      const result = await recordProgressionEvidence(store, {
        ...SCOPE, category: "growth_action", kind: "call_completed", sourceType: "call", sourceId: `c${i}`,
        provenance: "twilio", occurredAt: day(1 + (i % 25)),
      });
      expect(result.ok).toBe(false);
    }
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.grant.rapportBand).toBe(0);
    expect(snap.grant.personalRung).toBe(0);
  });

  it("recognizedAt cannot precede occurredAt", () => {
    expect(validateEvidenceInput({ category: "growth_action", kind: "confirmed_field_visit", occurredAt: day(5), recognizedAt: day(4) }).ok).toBe(false);
  });
});

describe("rapport bands", () => {
  it("advance on verified action volume and distinct days only", async () => {
    const store = createInMemoryProgressionStore();
    await addActions(store, [1, 1, 1, 1]); // 4 actions, 1 day
    expect((await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW })).grant.rapportBand).toBe(0);
    await addActions(store, [2]);
    expect((await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW })).grant.rapportBand).toBe(1);
  });

  it("effort alone never opens biography, even at max rapport", async () => {
    const store = createInMemoryProgressionStore();
    await addActions(store, Array.from({ length: 30 }, (_, i) => i + 1));
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.grant.rapportBand).toBe(3);
    expect(snap.grant.personalRung).toBe(0);
    expect(snap.mintedEntitlementIds).toHaveLength(0);
  });
});

describe("disclosure rung and entitlements", () => {
  it("consistency + progress opens rung 1 and mints exactly one entitlement per progress event", async () => {
    const store = createInMemoryProgressionStore();
    await addActions(store, [1, 2, 3, 4, 5]);
    await addProgress(store, "first_paid_order_target_building", "o1", 6);
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.grant.personalRung).toBe(1);
    expect(snap.mintedEntitlementIds).toHaveLength(1);
    // Repeating refresh (i.e. repeated calls) mints nothing more.
    const again = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(again.mintedEntitlementIds).toHaveLength(0);
    expect(await store.listEntitlements(SCOPE)).toHaveLength(1);
  });

  it("a lucky sale without consistency creates no access and no entitlement", async () => {
    const store = createInMemoryProgressionStore();
    await addProgress(store, "new_paying_customer", "o1", 6);
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(snap.grant.personalRung).toBe(0);
    expect(snap.mintedEntitlementIds).toHaveLength(0);
  });

  it("100 growth actions with no business progress do not open a rung", async () => {
    const store = createInMemoryProgressionStore();
    await addActions(store, Array.from({ length: 100 }, (_, i) => 1 + (i % 28)));
    expect((await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW })).grant.personalRung).toBe(0);
  });

  it("rung 3 also requires disclosure safety", async () => {
    const store = createInMemoryProgressionStore();
    await addActions(store, Array.from({ length: 26 }, (_, i) => i + 1));
    for (let i = 0; i < 4; i += 1) await addProgress(store, i < 2 ? "target_account_won" : "next_meeting_scheduled", `o${i}`, 27);
    const unsafe = await refreshProgression(store, SCOPE, { disclosureSafetyOk: false, now: NOW });
    expect(unsafe.grant.personalRung).toBe(2);
    const safe = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    expect(safe.grant.personalRung).toBe(3);
  });

  it("occurredAt governs chronology; recognizedAt governs when progression may advance", () => {
    const evidence: ProgressionEvidence[] = [];
    for (let i = 1; i <= 5; i += 1) {
      evidence.push({ id: `a${i}`, category: "growth_action", kind: "confirmed_field_visit", strength: null, sourceType: "m", sourceId: `${i}`, provenance: "x", occurredAt: day(i), recognizedAt: day(i) });
    }
    // Paid order happened on the 6th but Goldline only learns of it on the 20th.
    evidence.push({ id: "p1", category: "business_progress", kind: "new_paying_customer", strength: "strong", sourceType: "o", sourceId: "1", provenance: "cleancloud_import", occurredAt: oct(6), recognizedAt: oct(20) });
    const before = evaluateProgression({ evidence, disclosureSafetyOk: true, prior: null, asOf: new Date(oct(10)) });
    expect(before.grant.personalRung).toBe(0); // not yet recognized
    const after = evaluateProgression({ evidence, disclosureSafetyOk: true, prior: null, asOf: new Date(oct(21)) });
    expect(after.grant.personalRung).toBe(1);
  });
});

describe("monotonic grants", () => {
  it("a stricter later policy never demotes an earned grant", async () => {
    const store = createInMemoryProgressionStore();
    await addActions(store, [1, 2, 3, 4, 5]);
    await addProgress(store, "target_account_won", "o1", 6);
    await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    const stricter: ProgressionPolicy = {
      ...PROGRESSION_POLICY,
      version: "stricter",
      rapport: PROGRESSION_POLICY.rapport.map(t => ({ ...t, minActions: 1000 })),
      rungs: PROGRESSION_POLICY.rungs.map(t => ({ ...t, minActions: 1000 })),
    };
    const snap = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW, policy: stricter });
    expect(snap.grant.personalRung).toBe(1);
    expect(snap.grant.rapportBand).toBe(1);
    expect(snap.grant.rungPolicyVersion).toBe(PROGRESSION_POLICY.version);
  });

  it("a dry spell does not demote, and business losses are not representable as negative evidence", async () => {
    const store = createInMemoryProgressionStore();
    await addActions(store, [1, 2, 3]);
    const first = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: NOW });
    const later = await refreshProgression(store, SCOPE, { disclosureSafetyOk: true, now: () => new Date(Date.UTC(2027, 5, 1)) });
    expect(later.grant).toEqual(first.grant);
    expect(await recordProgressionEvidence(store, { ...SCOPE, category: "business_progress", kind: "lost_the_louise", sourceType: "m", sourceId: "x", provenance: "x", occurredAt: oct(9) })).toMatchObject({ ok: false });
  });

  it("an easier future policy can advance operators", () => {
    const easier: ProgressionPolicy = { ...PROGRESSION_POLICY, version: "easier", rapport: [{ band: 1, minActions: 1, minActionDays: 1 }, ...PROGRESSION_POLICY.rapport.slice(1)] };
    const evidence: ProgressionEvidence[] = [{ id: "a", category: "growth_action", kind: "confirmed_field_visit", strength: null, sourceType: "m", sourceId: "1", provenance: "x", occurredAt: day(1), recognizedAt: day(1) }];
    expect(evaluateProgression({ evidence, disclosureSafetyOk: true, prior: EMPTY_GRANT, asOf: new Date(day(2)) }).grant.rapportBand).toBe(0);
    expect(evaluateProgression({ evidence, disclosureSafetyOk: true, prior: EMPTY_GRANT, asOf: new Date(day(2)), policy: easier }).grant.rapportBand).toBe(1);
  });
});
