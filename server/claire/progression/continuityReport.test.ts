import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildOperatorContinuityRecord,
  collectProgressionSnapshot,
  CONTINUITY_DECISION_OPTIONS,
  formatContinuityReport,
} from "./continuityReport";
import { recordConfirmedVisitEvidence } from "./evidenceSources";
import { executePersonalTurn } from "./personalReveal";
import { isClaireProgressionEnabled } from "./progressionFlag";
import { createInMemoryProgressionStore, type ProgressionStore } from "./store";

const SCOPE = { tenantId: "tenant-1", operatorUserId: "op-1" };
const oct = (n: number) => new Date(Date.UTC(2026, 9, n, 15));

afterEach(() => { delete process.env.CLAIRE_PROGRESSION; });

/** Six lost visits and one won, recorded exactly as the live debrief path records them. */
async function accumulateWhileOff(store: ProgressionStore) {
  process.env.CLAIRE_PROGRESSION = "some-other-tenant"; // tenant-1 is NOT listed => flag OFF
  expect(isClaireProgressionEnabled(SCOPE.tenantId)).toBe(false);
  for (let i = 1; i <= 6; i += 1) {
    await recordConfirmedVisitEvidence({ ...SCOPE, missionId: i, outcome: "lost", occurredAt: oct(i) }, store, () => oct(20));
  }
  await recordConfirmedVisitEvidence({ ...SCOPE, missionId: 7, outcome: "won", occurredAt: oct(7) }, store, () => oct(20));
}

describe("progression accumulated while the flag is OFF appears in the report", () => {
  it("shows dormant rapport, rung, cursor, evidence, entitlements, and that it would become active on enable", async () => {
    const store = createInMemoryProgressionStore();
    await accumulateWhileOff(store);

    const record = buildOperatorContinuityRecord({ scope: SCOPE, legacy: null, progression: await collectProgressionSnapshot(store, SCOPE) });
    const p = record.progression;
    expect(p.rapportBand).toBe(1);
    expect(p.personalRung).toBe(1);
    expect(p.rapportPolicyVersion).toBeTruthy();
    expect(p.entitlementCursor).toMatch(/^2026-10-20T.*\|/);
    expect(p.evidenceByCategoryKind).toEqual({ "growth_action/confirmed_field_visit": 7, "business_progress/target_account_won": 1 });
    expect(p.evidenceTotal).toBe(8);
    expect(p.entitlements).toEqual({ unused: 1, reserved: 0, consumed: 0 });
    expect(p.latest.evidenceOccurredAt).toBe(oct(7).toISOString());
    expect(p.latest.entitlementMintedAt).toBeTruthy();
    expect(record.dormantProgressionWouldActivate).toBe(true);
    expect(record.dormantReasons.join(" ")).toMatch(/rung 1.*unused disclosure entitlement/s);
  });

  it("the printed report says so plainly and lists the three decisions without choosing one", async () => {
    const store = createInMemoryProgressionStore();
    await accumulateWhileOff(store);
    const record = buildOperatorContinuityRecord({
      scope: SCOPE,
      legacy: { disclosureTier: 2, qualifyingInteractionCount: 9, distinctInteractionDays: 5, personalModeGenerations: 3, eligibleCanonFragmentIds: ["core_father_career"], attestedDisclosureEvents: 1 },
      progression: await collectProgressionSnapshot(store, SCOPE),
    });
    const text = formatContinuityReport([record], oct(21));
    expect(text).toContain("READ ONLY");
    expect(text).toContain("DORMANT PROGRESSION BECOMES ACTIVE");
    expect(text).toContain("legacy access / possible prior disclosures are NOT carried over");
    expect(text).toContain("rapportBand 1");
    expect(text).toContain("unused 1, reserved 0, consumed 0");
    expect(text).toContain("target_account_won=1");
    for (const option of CONTINUITY_DECISION_OPTIONS) expect(text).toContain(option.summary);
    expect(CONTINUITY_DECISION_OPTIONS.map(o => o.id)).toEqual(["preserve", "reset", "reconcile"]);
    expect(text).toContain("this report does not choose");
  });

  it("consumed entitlements and disclosed fragments from the new ledger are reported", async () => {
    const store = createInMemoryProgressionStore();
    await accumulateWhileOff(store);
    delete process.env.CLAIRE_PROGRESSION; // a test-run reveal writes the same durable rows the live path would
    await executePersonalTurn({ store, scope: SCOPE, conversationId: "call-1", topic: "father", businessOpen: true, autoCommit: true, random: () => 0, generate: async () => "He was an academic, on paper." });
    const p = (await collectProgressionSnapshot(store, SCOPE));
    expect(p.entitlements).toEqual({ unused: 0, reserved: 0, consumed: 1 });
    expect(p.disclosedFragmentIds).toEqual(["core_father_career"]);
    expect(p.ledgerEntryCount).toBeGreaterThan(0);
    expect(p.latest.entitlementConsumedAt).toBeTruthy();
    expect(buildOperatorContinuityRecord({ scope: SCOPE, legacy: null, progression: p }).dormantReasons.join(" ")).toContain("core_father_career");
  });

  it("an operator with nothing in the new tables is not flagged dormant", async () => {
    const record = buildOperatorContinuityRecord({ scope: SCOPE, legacy: null, progression: await collectProgressionSnapshot(createInMemoryProgressionStore(), SCOPE) });
    expect(record.dormantProgressionWouldActivate).toBe(false);
    expect(record.progression.evidenceTotal).toBe(0);
  });

  it("legacy-only operators are called out as not carried over", async () => {
    const record = buildOperatorContinuityRecord({
      scope: SCOPE,
      legacy: { disclosureTier: 1, qualifyingInteractionCount: 4, distinctInteractionDays: 3, personalModeGenerations: 0, eligibleCanonFragmentIds: [], attestedDisclosureEvents: 0 },
      progression: await collectProgressionSnapshot(createInMemoryProgressionStore(), SCOPE),
    });
    expect(record.legacyStateNotCarriedOver).toBe(true);
    expect(record.dormantProgressionWouldActivate).toBe(false);
  });
});

describe("the report is read-only", () => {
  it("collecting the snapshot calls only get/list methods: any write throws", async () => {
    const store = createInMemoryProgressionStore();
    await accumulateWhileOff(store);
    const writes = ["insertEvidence", "upsertGrantMonotonic", "insertEntitlementIfAbsent", "reserveEntitlement", "commitReservedDisclosure", "releaseReservation", "appendLedger"];
    const guarded = new Proxy(store, {
      get(target, prop, receiver) {
        if (writes.includes(String(prop))) return () => { throw new Error(`WRITE ATTEMPTED: ${String(prop)}`); };
        return Reflect.get(target, prop, receiver);
      },
    });
    const before = JSON.stringify(await Promise.all([store.listEvidence(SCOPE), store.getGrant(SCOPE), store.listEntitlements(SCOPE), store.listLedger(SCOPE)]));
    await expect(collectProgressionSnapshot(guarded, SCOPE)).resolves.toBeDefined();
    const after = JSON.stringify(await Promise.all([store.listEvidence(SCOPE), store.getGrant(SCOPE), store.listEntitlements(SCOPE), store.listLedger(SCOPE)]));
    expect(after).toBe(before);
  });

  it("neither the report module nor the script contains a write statement or the lazily-releasing loader", () => {
    for (const path of ["./continuityReport.ts", "../../../scripts/claire-progression-continuity-report.ts"]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(source).not.toMatch(/\.(insert|update|delete)\(/);
      expect(source).not.toMatch(/\.transaction\(|\.execute\(|sql`\s*(insert|update|delete|alter|drop|truncate)/i);
      expect(source).not.toMatch(/loadPersonalProgressionContext|refreshProgression|recordProgressionEvidence|appendLedger|commitReservedDisclosure|reserveEntitlement|releaseReservation/);
    }
  });
});
