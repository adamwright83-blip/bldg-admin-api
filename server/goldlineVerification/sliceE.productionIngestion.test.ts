import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  issueVerifiedGoldlineReceiptFromAuthoritativeMutation,
  UnsupportedGoldlineProducerError,
  UntrustedGoldlineIssuanceError,
  type AuthoritativeGoldlineMutation,
} from "./issueVerifiedGoldlineReceipt";
import {
  ingestVerifiedGoldlineOutcome,
  ingestVerifiedGoldlineOutcomeBestEffort,
} from "./ingestVerifiedGoldlineOutcome";
import {
  REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS,
  SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS,
} from "./supportedOutcomes";
import {
  evaluateEligibility,
  evaluateProductionEligibility,
  issueEligibilityAuthorizations,
  type EligibilityInput,
} from "../narratorOs/eligibility";
import {
  commitAuthorizedBeat,
  fireOffscreenIfLegal,
  recordVerifiedGoldlineOutcome,
  UntrustedGoldlineReceiptError,
} from "../narratorOs/ledger";
import { initNarratorOperator } from "../narratorOs/init";
import {
  createInMemoryNarratorStore,
  reloadInMemoryNarratorStoreFromSnapshot,
} from "../narratorOs/memoryStore";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  BEAT_IDS,
} from "../narratorOs/registry";
import {
  derivedM03ArmedTargetIds,
  unconsumedM03QualifyingCycles,
} from "../narratorOs/m03Readiness";
import {
  productionVerifiedGoldlineEvidence,
  rehydratePersistedVerifiedGoldlineReceipts,
} from "../narratorOs/verifiedGoldlinePersistence";
import {
  isVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "../narratorOs/verifiedGoldlineReceipt";
import type { NarratorSnapshot, NarratorStore } from "../narratorOs/store";

const scope = { tenantId: "t-e", operatorUserId: "op-e" };
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");

const MONDAY_MS = Date.parse("2026-09-14T12:00:00Z");
const TUESDAY_MS = Date.parse("2026-09-15T12:00:00Z");
const WEDNESDAY_MS = Date.parse("2026-09-16T12:00:00Z");
const NOW_MS = Date.parse("2026-09-21T00:00:00Z");

const NARRATOR_PRODUCTION_FILES = [
  "server/narratorOs/eligibility.ts",
  "server/narratorOs/ledger.ts",
  "server/narratorOs/init.ts",
  "server/narratorOs/drizzleStore.ts",
  "server/narratorOs/registry.ts",
  "server/narratorOs/verifiedGoldlineReceipt.ts",
  "server/narratorOs/m03Readiness.ts",
  "server/narratorOs/disclosurePolicy.ts",
  "server/narratorOs/authoredNarrativeFacts.ts",
  "server/narratorOs/index.ts",
  "server/narratorOs/brainBoundary.ts",
  "server/narratorOs/verifiedGoldlinePersistence.ts",
  "shared/narratorOs/contracts.ts",
];

function mutation(
  extra?: Partial<AuthoritativeGoldlineMutation>
): AuthoritativeGoldlineMutation {
  return {
    sourceEventId: extra?.sourceEventId ?? "src-keep-1",
    tenantId: extra?.tenantId ?? scope.tenantId,
    operatorUserId: extra?.operatorUserId ?? scope.operatorUserId,
    outcomeId: extra?.outcomeId ?? "kept_promised_send_visit_or_call",
    occurredAtMs: extra?.occurredAtMs ?? MONDAY_MS,
    targetId: extra?.targetId ?? "target-a",
    evidenceClass: extra?.evidenceClass ?? "operator_attested",
    evidenceRef: extra?.evidenceRef ?? {
      sourceType: "goldline_field_commitment",
      sourceReference: "field_commitment:src-keep-1",
      classification: "operator_attested",
    },
    sourceVerificationClass: extra?.sourceVerificationClass ?? "ATTESTED",
  };
}

async function seeded(): Promise<{
  store: ReturnType<typeof createInMemoryNarratorStore>;
  snapshot: NarratorSnapshot;
}> {
  const store = createInMemoryNarratorStore();
  const snapshot = await initNarratorOperator(store, scope);
  return { store, snapshot };
}

function evalInput(
  snapshot: NarratorSnapshot,
  extra?: Partial<EligibilityInput>
): EligibilityInput {
  return {
    registry: AUTHORED_BEATS,
    graph: AUTHORED_GRAPH,
    snapshot,
    verifiedGoldline: [],
    nowMs: NOW_MS,
    mode: "interactive",
    ...extra,
  };
}

function issueSupported(
  extra?: Partial<AuthoritativeGoldlineMutation>
): VerifiedGoldlineReceipt {
  return issueVerifiedGoldlineReceiptFromAuthoritativeMutation(mutation(extra));
}

function walkTsFiles(dir: string, into: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name.endsWith(".test.ts")) continue;
      walkTsFiles(full, into);
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) into.push(full);
  }
}

describe("Narrator OS Slice E — production verified Goldline ingestion", () => {
  it("1. trusted production authority can issue a supported receipt", () => {
    const receipt = issueSupported({
      sourceEventId: "evt-keep",
      outcomeId: "kept_promised_send_visit_or_call",
      evidenceClass: "authoritative_external",
      sourceVerificationClass: "VERIFIED",
      evidenceRef: {
        sourceType: "provider_message",
        sourceReference: "twilio:SM123",
        classification: "authoritative_external",
      },
    });
    expect(isVerifiedGoldlineReceipt(receipt)).toBe(true);
    expect(receipt.receiptId).toBe(`glv:${scope.tenantId}:evt-keep`);
    expect(receipt.outcomeId).toBe("kept_promised_send_visit_or_call");
    expect(receipt.verificationClass).toBe("VERIFIED");
    expect(receipt.targetRef).toEqual({
      kind: "goldline_target",
      id: "target-a",
    });
    expect(receipt.occurredAtMs).toBe(MONDAY_MS);
  });

  it("2. ordinary Narrator production code cannot issue a receipt", () => {
    const receiptSrc = readFileSync(
      resolve(REPO_ROOT, "server/narratorOs/verifiedGoldlineReceipt.ts"),
      "utf8"
    );
    expect(receiptSrc).not.toMatch(/function issue/);
    expect(receiptSrc).not.toMatch(/Object\.freeze/);
    for (const file of NARRATOR_PRODUCTION_FILES) {
      const src = readFileSync(resolve(REPO_ROOT, file), "utf8");
      expect(src).not.toMatch(
        /issueVerifiedGoldlineReceiptFromAuthoritativeMutation/
      );
      expect(src).not.toMatch(/from ["'].*goldlineVerification/);
    }
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
  });

  it("3. structurally similar unbranded object is rejected", async () => {
    const { store, snapshot } = await seeded();
    const counterfeit = {
      receiptId: "glv:t-e:fake",
      tenantId: scope.tenantId,
      operatorUserId: scope.operatorUserId,
      outcomeId: "kept_promised_send_visit_or_call",
      verificationClass: "VERIFIED",
      evidenceClass: "operator_attested",
      evidenceRef: {
        sourceType: "goldline_field_commitment",
        sourceReference: "field_commitment:fake",
        classification: "operator_attested",
      },
      targetRef: { kind: "goldline_target", id: "target-a" },
      occurredAtMs: MONDAY_MS,
    };
    expect(isVerifiedGoldlineReceipt(counterfeit)).toBe(false);
    await expect(
      recordVerifiedGoldlineOutcome({
        store,
        scope,
        receipt: counterfeit as never,
      })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);
    const production = evaluateProductionEligibility(
      evalInput(snapshot, { verifiedGoldline: [counterfeit as never] })
    );
    expect(production.outcome).toBe("NO_ELIGIBLE");
    expect(production.eligibleBeatIds).not.toContain(BEAT_IDS.M04);
  });

  it("4. cross-tenant receipt is rejected", async () => {
    const { store, snapshot } = await seeded();
    const foreign = issueSupported({ tenantId: "other-tenant" });
    expect(isVerifiedGoldlineReceipt(foreign)).toBe(true);
    await expect(
      ingestVerifiedGoldlineOutcome({ store, scope, receipt: foreign })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);
    const production = evaluateProductionEligibility(
      evalInput(snapshot, { verifiedGoldline: [foreign] })
    );
    expect(production.eligibleBeatIds).not.toContain(BEAT_IDS.M04);
  });

  it("5. cross-operator receipt is rejected", async () => {
    const { store, snapshot } = await seeded();
    const foreign = issueSupported({ operatorUserId: "other-op" });
    await expect(
      ingestVerifiedGoldlineOutcome({ store, scope, receipt: foreign })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);
    const production = evaluateProductionEligibility(
      evalInput(snapshot, { verifiedGoldline: [foreign] })
    );
    expect(production.eligibleBeatIds).not.toContain(BEAT_IDS.M04);
  });

  it("6. duplicate receipt ingestion is idempotent", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({ sourceEventId: "dup-1" });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(1);
    expect(loaded?.ledger[0]?.idempotencyKey).toBe(
      `goldline:${receipt.receiptId}`
    );
  });

  it("7. two distinct receipt IDs for the same business outcome can coexist", async () => {
    const { store } = await seeded();
    const first = issueSupported({ sourceEventId: "keep-a" });
    const second = issueSupported({ sourceEventId: "keep-b" });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: first });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: second });
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(2);
    expect(first.outcomeId).toBe(second.outcomeId);
    expect(first.receiptId).not.toBe(second.receiptId);
    expect(loaded?.ledger.map(entry => entry.idempotencyKey)).toEqual([
      `goldline:${first.receiptId}`,
      `goldline:${second.receiptId}`,
    ]);
  });

  it("8. trusted occurrence time is preserved through ingest and reload", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({ occurredAtMs: TUESDAY_MS });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    const reloadedStore = reloadInMemoryNarratorStoreFromSnapshot(loaded!);
    const reloaded = await reloadedStore.load(scope);
    const hydrated = rehydratePersistedVerifiedGoldlineReceipts(reloaded!);
    expect(hydrated).toHaveLength(1);
    expect(hydrated[0]?.occurredAtMs).toBe(TUESDAY_MS);
    expect(reloaded?.ledger[0]?.occurredAt).toBe(
      new Date(TUESDAY_MS).toISOString()
    );
  });

  it("9. opaque target identity is preserved through ingest and reload", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({ targetId: "opaque-site-9" });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const reloaded = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    const hydrated = rehydratePersistedVerifiedGoldlineReceipts(reloaded!);
    expect(hydrated[0]?.targetRef).toEqual({
      kind: "goldline_target",
      id: "opaque-site-9",
    });
  });

  it("10. source/evidence classification is preserved", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({
      evidenceClass: "authoritative_external",
      sourceVerificationClass: "VERIFIED",
      evidenceRef: {
        sourceType: "provider_call",
        sourceReference: "twilio:CA999",
        classification: "authoritative_external",
      },
    });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const reloaded = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    const hydrated = rehydratePersistedVerifiedGoldlineReceipts(reloaded!);
    expect(hydrated[0]?.evidenceClass).toBe("authoritative_external");
    expect(hydrated[0]?.evidenceRef).toEqual({
      sourceType: "provider_call",
      sourceReference: "twilio:CA999",
      classification: "authoritative_external",
    });
    expect(reloaded?.ledger[0]?.evidenceRef?.classification).toBe(
      "authoritative_external"
    );
  });

  it("11. unsupported or untrustworthy producer cannot become VERIFIED", () => {
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation(
        mutation({ outcomeId: "account_won" })
      )
    ).toThrow(UnsupportedGoldlineProducerError);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation(
        mutation({
          evidenceClass: "authoritative_external",
          sourceVerificationClass: "ATTESTED",
          evidenceRef: {
            sourceType: "journal",
            sourceReference: "journal:1",
            classification: "authoritative_external",
          },
        })
      )
    ).toThrow(UnsupportedGoldlineProducerError);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation(
        mutation({ targetId: "" })
      )
    ).toThrow(UntrustedGoldlineIssuanceError);
    expect(SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS).not.toContain(
      "leave_real_packet_or_collateral"
    );
  });

  it("12. ingestion alone does not fire an authored beat", async () => {
    const { store } = await seeded();
    const silence = issueSupported({
      sourceEventId: "silence-1",
      outcomeId: "silence_eligible_for_retry",
      occurredAtMs: MONDAY_MS,
    });
    const ret = issueSupported({
      sourceEventId: "return-1",
      outcomeId: "legitimate_second_site_visit",
      occurredAtMs: TUESDAY_MS,
    });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: silence });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: ret });
    const loaded = await store.load(scope);
    expect(
      loaded?.ledger.every(entry => entry.kind === "VERIFIED_GOLDLINE_OUTCOME")
    ).toBe(true);
    expect(
      loaded?.ledger.some(entry => entry.kind === "FIRED_AUTHORED_BEAT")
    ).toBe(false);
    expect(loaded?.narrativeState.values).toEqual({});
  });

  it("13. ingestion alone does not mutate knowledge or world truth", async () => {
    const { store, snapshot } = await seeded();
    const receipt = issueSupported();
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    expect(loaded?.knowledge).toEqual(snapshot.knowledge);
    expect(loaded?.worldTruth).toEqual(snapshot.worldTruth);
    expect(loaded?.livedBio).toEqual(snapshot.livedBio);
    expect(loaded?.narrativeState).toEqual(snapshot.narrativeState);
  });

  it("14. ingestion alone does not produce Claire speech", async () => {
    const files = [
      resolve(HERE, "issueVerifiedGoldlineReceipt.ts"),
      resolve(HERE, "ingestVerifiedGoldlineOutcome.ts"),
      resolve(HERE, "supportedOutcomes.ts"),
      resolve(REPO_ROOT, "server/narratorOs/ledger.ts"),
      resolve(REPO_ROOT, "server/narratorOs/verifiedGoldlinePersistence.ts"),
    ];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/claireTurn|speechDelivery|xaiTts|runClaireTurn/);
      expect(src).not.toMatch(/server\/claire\/brain/);
      expect(src).not.toMatch(/dramaturg/);
    }
  });

  it("15. restart/reload preserves usable verified evidence without the original array", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({
      sourceEventId: "keep-reload",
      occurredAtMs: MONDAY_MS,
    });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const before = await store.load(scope);
    const reloadedStore = reloadInMemoryNarratorStoreFromSnapshot(before!);
    const reloaded = await reloadedStore.load(scope);
    expect(reloaded).not.toBe(before);
    const production = evaluateProductionEligibility(
      evalInput(reloaded!, { verifiedGoldline: [] })
    );
    expect(production.eligibleBeatIds).toContain(BEAT_IDS.M04);
    const isolated = evaluateEligibility(
      evalInput(reloaded!, { verifiedGoldline: [] })
    );
    expect(isolated.eligibleBeatIds).not.toContain(BEAT_IDS.M04);
  });

  it("16. production eligibility cannot be satisfied by caller-only fake receipt input", async () => {
    const { snapshot } = await seeded();
    const fake = {
      receiptId: "caller-fake",
      tenantId: scope.tenantId,
      operatorUserId: scope.operatorUserId,
      outcomeId: "kept_promised_send_visit_or_call",
      verificationClass: "VERIFIED" as const,
      evidenceClass: "operator_attested" as const,
      evidenceRef: {
        sourceType: "field_visit",
        sourceReference: "visit:fake",
        classification: "operator_attested" as const,
      },
      targetRef: { kind: "goldline_target" as const, id: "target-a" },
      occurredAtMs: MONDAY_MS,
    };
    const production = evaluateProductionEligibility(
      evalInput(snapshot, { verifiedGoldline: [fake as never] })
    );
    expect(production.outcome).toBe("NO_ELIGIBLE");
    expect(production.eligibleBeatIds).not.toContain(BEAT_IDS.M04);
    expect(productionVerifiedGoldlineEvidence(snapshot, [fake]).length).toBe(0);
  });

  it("17. M03 terminal-no/reopen chronology remains intact through persisted production evidence", async () => {
    const { store } = await seeded();
    const spokenNo = issueSupported({
      sourceEventId: "no-1",
      outcomeId: "spoken_no",
      occurredAtMs: MONDAY_MS,
      targetId: "target-a",
    });
    const laterSilence = issueSupported({
      sourceEventId: "silence-after-no",
      outcomeId: "silence_eligible_for_retry",
      occurredAtMs: TUESDAY_MS,
      targetId: "target-a",
    });
    const laterReturn = issueSupported({
      sourceEventId: "return-after-no",
      outcomeId: "legitimate_second_site_visit",
      occurredAtMs: WEDNESDAY_MS,
      targetId: "target-a",
    });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: spokenNo });
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: laterSilence,
    });
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: laterReturn,
    });
    const blocked = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    const blockedEvidence = productionVerifiedGoldlineEvidence(blocked!, []);
    expect(derivedM03ArmedTargetIds(blockedEvidence, blocked!)).toEqual([]);
    expect(unconsumedM03QualifyingCycles(blockedEvidence, blocked!)).toEqual(
      []
    );
    expect(
      evaluateProductionEligibility(
        evalInput(blocked!, { verifiedGoldline: [] })
      ).eligibleBeatIds
    ).not.toContain(BEAT_IDS.M03);

    const reopen = issueSupported({
      sourceEventId: "reopen-1",
      outcomeId: "contact_reopened_after_no",
      occurredAtMs: WEDNESDAY_MS + 1,
      targetId: "target-a",
    });
    const legalReturn = issueSupported({
      sourceEventId: "return-legal",
      outcomeId: "legitimate_second_site_visit",
      occurredAtMs: WEDNESDAY_MS + 2,
      targetId: "target-a",
    });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: reopen });
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: legalReturn,
    });
    const opened = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    const openedEvidence = productionVerifiedGoldlineEvidence(opened!, []);
    expect(unconsumedM03QualifyingCycles(openedEvidence, opened!).length).toBe(
      1
    );
    expect(
      evaluateProductionEligibility(
        evalInput(opened!, { verifiedGoldline: [] })
      ).eligibleBeatIds
    ).toContain(BEAT_IDS.M03);
  });

  it("18. new user with no verified reality remains NO_ELIGIBLE", async () => {
    const { snapshot } = await seeded();
    const production = evaluateProductionEligibility(evalInput(snapshot));
    expect(production.outcome).toBe("NO_ELIGIBLE");
    expect(production.eligibleBeatIds).toEqual([]);
    expect(snapshot.ledger).toEqual([]);
  });

  it("does not fire a beat or authorize execution from ingest alone", async () => {
    const { store } = await seeded();
    const receipt = issueSupported();
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    const production = evaluateProductionEligibility(
      evalInput(loaded!, { verifiedGoldline: [] })
    );
    expect(production.eligibleBeatIds).toContain(BEAT_IDS.M04);
    const auths = issueEligibilityAuthorizations(
      production,
      evalInput(loaded!, { verifiedGoldline: [] })
    );
    expect(auths.length).toBeGreaterThan(0);
    expect(
      loaded?.ledger.some(entry => entry.kind === "FIRED_AUTHORED_BEAT")
    ).toBe(false);
    const offscreen = await fireOffscreenIfLegal({
      store,
      scope,
      eligibility: evalInput(loaded!, { verifiedGoldline: [] }),
    });
    expect(offscreen.fired).toEqual([]);
  });

  it("best-effort ingest never rolls back or throws after a failed persist", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({ sourceEventId: "best-effort-fail" });
    const failing: NarratorStore = {
      ...store,
      async appendLedger() {
        throw new Error("narrator store down");
      },
    };
    const result = await ingestVerifiedGoldlineOutcomeBestEffort({
      store: failing,
      scope,
      receipt,
    });
    expect(result.recorded).toBe(false);
    expect(result.receiptId).toBe(receipt.receiptId);
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toEqual([]);
  });

  it("does not attach the issuer to current Goldline mutation producers", () => {
    const producerRoots = [
      resolve(REPO_ROOT, "server/commercialMissions"),
      resolve(REPO_ROOT, "server/goldlineWorld"),
      resolve(REPO_ROOT, "server/spiritHumanRescue"),
      resolve(REPO_ROOT, "server/churnRadar"),
      resolve(REPO_ROOT, "server/dayDirector"),
      resolve(REPO_ROOT, "server/campaignRuns"),
      resolve(REPO_ROOT, "server/commercialPipeline"),
      resolve(REPO_ROOT, "server/field"),
      resolve(REPO_ROOT, "server/salesCalls.ts"),
    ];
    const files: string[] = [];
    for (const root of producerRoots) {
      const stat = statSync(root);
      if (stat.isDirectory()) walkTsFiles(root, files);
      else files.push(root);
    }
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/goldlineVerification/);
      expect(src).not.toMatch(
        /issueVerifiedGoldlineReceiptFromAuthoritativeMutation/
      );
    }
  });

  it("commit still requires eligibility authorization after ingest", async () => {
    const { store } = await seeded();
    const receipt = issueSupported();
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: {
          beatId: BEAT_IDS.M04,
          mode: "interactive",
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
          ledgerLength: loaded!.ledger.length,
        } as never,
        eligibility: evalInput(loaded!, { verifiedGoldline: [] }),
      })
    ).rejects.toThrow();
    expect(
      (await store.load(scope))?.ledger.some(
        entry => entry.kind === "FIRED_AUTHORED_BEAT"
      )
    ).toBe(false);
  });
});
