import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  issueVerifiedGoldlineReceiptFromAuthoritativeMutation,
  UnsupportedGoldlineProducerError,
  UntrustedGoldlineIssuanceError,
  type AuthoritativeGoldlineMutation,
} from "./issueVerifiedGoldlineReceipt";
import { claimTestGoldlineProducerCapability } from "./producerCapability.testSupport";
import {
  isAuthorizedGoldlineProducerCapability,
  isGoldlineProducerCapability,
} from "./producerCapability";
import * as producerCapabilityModule from "./producerCapability";
import { GOLDLINE_PRODUCER_CAPABILITY_BRAND } from "./producerCapabilityBrand";
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
  ConflictingGoldlineLedgerReplayError,
} from "../narratorOs/ledger";
import {
  goldlineLedgerIdempotencyKey,
  goldlineReceiptIdFromAuthoritativeIdentity,
  NARRATOR_LEDGER_IDEMPOTENCY_MAX,
} from "../narratorOs/goldlineReceiptIdentity";
import { resolveDuplicateNarratorLedgerInsert } from "../narratorOs/drizzleStore";
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
import { isLegalEligibilityGoldlineEvidence } from "../narratorOs/brainBoundary";
import {
  persistableVerifiedGoldlineReceipt,
  productionVerifiedGoldlineEvidence,
  rehydratePersistedVerifiedGoldlineReceipts,
} from "../narratorOs/verifiedGoldlinePersistence";
import {
  isRehydratedVerifiedGoldlineEvidence,
  isUpstreamIssuedVerifiedGoldlineReceipt,
  isVerifiedGoldlineReceipt,
  isVerifiedGoldlineReceiptShape,
  type VerifiedGoldlineReceipt,
} from "../narratorOs/verifiedGoldlineReceipt";
import { VERIFIED_GOLDLINE_RECEIPT_BRAND } from "../narratorOs/verifiedGoldlineReceiptBrand";
import type { NarrativeEventLedgerEntry } from "../../shared/narratorOs/contracts";
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
  "server/narratorOs/verifiedGoldlineReceiptAuthority.ts",
  "server/narratorOs/m03Readiness.ts",
  "server/narratorOs/disclosurePolicy.ts",
  "server/narratorOs/authoredNarrativeFacts.ts",
  "server/narratorOs/index.ts",
  "server/narratorOs/brainBoundary.ts",
  "server/narratorOs/verifiedGoldlinePersistence.ts",
  "server/narratorOs/goldlineReceiptIdentity.ts",
  "server/narratorOs/goldlineLedgerReplay.ts",
  "shared/narratorOs/contracts.ts",
];

const TEST_PRODUCER_A = "test-goldline-producer-a";
const TEST_PRODUCER_B = "test-goldline-producer-b";

function testProducer(namespace = TEST_PRODUCER_A) {
  return claimTestGoldlineProducerCapability({
    producerNamespace: namespace,
    allowedOutcomeIds: SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS,
    allowedEvidenceClasses: ["operator_attested", "authoritative_external"],
  });
}

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
  extra?: Partial<AuthoritativeGoldlineMutation> & {
    producerNamespace?: string;
  }
): VerifiedGoldlineReceipt {
  return issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
    producer: testProducer(extra?.producerNamespace),
    mutation: mutation(extra),
  });
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
  it("1. test-only authorized producer capability can issue a supported receipt", () => {
    const producer = testProducer();
    expect(isGoldlineProducerCapability(producer)).toBe(true);
    expect(isAuthorizedGoldlineProducerCapability(producer)).toBe(true);
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
    expect(isUpstreamIssuedVerifiedGoldlineReceipt(receipt)).toBe(true);
    expect(isRehydratedVerifiedGoldlineEvidence(receipt)).toBe(false);
    expect(receipt.receiptId).toBe(
      goldlineReceiptIdFromAuthoritativeIdentity({
        tenantId: scope.tenantId,
        operatorUserId: scope.operatorUserId,
        producerNamespace: TEST_PRODUCER_A,
        sourceEventId: "evt-keep",
      })
    );
    expect(receipt.receiptId).not.toBe(`glv:${scope.tenantId}:evt-keep`);
    expect(
      goldlineLedgerIdempotencyKey(receipt.receiptId).length
    ).toBeLessThanOrEqual(NARRATOR_LEDGER_IDEMPOTENCY_MAX);
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
      expect(src).not.toMatch(/producerCapability\.testSupport/);
      if (file.endsWith("verifiedGoldlineReceiptAuthority.ts")) {
        expect(src).toMatch(
          /from ["']\.\.\/goldlineVerification\/producerCapability["']/
        );
        continue;
      }
      expect(src).not.toMatch(/from ["'].*goldlineVerification/);
    }
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
    expect(
      "PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES" in producerCapabilityModule
    ).toBe(false);
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
    const producer = testProducer();
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer,
        mutation: mutation({ outcomeId: "account_won" }),
      })
    ).toThrow(UnsupportedGoldlineProducerError);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer,
        mutation: mutation({
          evidenceClass: "authoritative_external",
          sourceVerificationClass: "ATTESTED",
          evidenceRef: {
            sourceType: "journal",
            sourceReference: "journal:1",
            classification: "authoritative_external",
          },
        }),
      })
    ).toThrow(UnsupportedGoldlineProducerError);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer,
        mutation: mutation({ targetId: "" }),
      })
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

function drizzleShapedGoldlineRow(
  receipt: VerifiedGoldlineReceipt,
  extras?: Partial<NarrativeEventLedgerEntry>
): NarrativeEventLedgerEntry {
  const persisted = persistableVerifiedGoldlineReceipt(receipt);
  return {
    id: extras?.id ?? "row-1",
    tenantId: receipt.tenantId,
    operatorUserId: receipt.operatorUserId,
    kind: "VERIFIED_GOLDLINE_OUTCOME",
    beatId: null,
    goldlineOutcomeId: receipt.outcomeId,
    offscreen: false,
    playerVisible: false,
    evidenceRef: persisted.evidenceRef,
    occurredAt: new Date(receipt.occurredAtMs).toISOString(),
    idempotencyKey: goldlineLedgerIdempotencyKey(receipt.receiptId),
    persistedVerifiedGoldline: persisted,
    ...extras,
  };
}

describe("Narrator OS Slice E — authority, identity, and conflicting replay", () => {
  it("1. empty production registry cannot mint any supported VERIFIED receipt", () => {
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
    expect(
      "PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES" in producerCapabilityModule
    ).toBe(false);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer: undefined as never,
        mutation: mutation(),
      })
    ).toThrow(UntrustedGoldlineIssuanceError);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer: {
          producerNamespace: "imaginary-production-producer",
          allowedOutcomeIds: SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS,
          allowedEvidenceClasses: ["operator_attested"],
        } as never,
        mutation: mutation(),
      })
    ).toThrow(UntrustedGoldlineIssuanceError);
    const forgedBrand = {
      [GOLDLINE_PRODUCER_CAPABILITY_BRAND]: true as const,
      producerNamespace: "forged-production-producer",
      allowedOutcomeIds: SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS,
      allowedEvidenceClasses: ["operator_attested" as const],
    };
    expect(isGoldlineProducerCapability(forgedBrand)).toBe(true);
    expect(isAuthorizedGoldlineProducerCapability(forgedBrand)).toBe(false);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer: forgedBrand,
        mutation: mutation(),
      })
    ).toThrow(UntrustedGoldlineIssuanceError);
    for (const outcomeId of SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS) {
      expect(() =>
        issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
          producer: forgedBrand,
          mutation: mutation({ outcomeId }),
        })
      ).toThrow(UntrustedGoldlineIssuanceError);
    }
    const issuerSrc = readFileSync(
      resolve(HERE, "issueVerifiedGoldlineReceipt.ts"),
      "utf8"
    );
    const capabilitySrc = readFileSync(
      resolve(HERE, "producerCapability.ts"),
      "utf8"
    );
    expect(issuerSrc).not.toMatch(
      /export function (get|create|claim).*[Pp]roducer/
    );
    expect(capabilitySrc).not.toMatch(
      /export function (getRegistered|lookup|createProduction)/
    );
    expect(capabilitySrc).not.toMatch(
      /export const PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES/
    );
  });

  it("2. test-only authorized producer capability can issue without creating production authority", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    try {
      expect(() => testProducer()).toThrow(/not available outside tests/);
    } finally {
      vi.unstubAllEnvs();
    }
    const capability = testProducer();
    expect(isGoldlineProducerCapability(capability)).toBe(true);
    expect(isAuthorizedGoldlineProducerCapability(capability)).toBe(true);
    const receipt = issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
      producer: capability,
      mutation: mutation({ sourceEventId: "test-only-src" }),
    });
    expect(isVerifiedGoldlineReceipt(receipt)).toBe(true);
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
    expect(
      "PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES" in producerCapabilityModule
    ).toBe(false);
  });

  it("3. merely knowing a producer ID/name is insufficient to mint", () => {
    const knownName = TEST_PRODUCER_A;
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer: {
          producerNamespace: knownName,
          allowedOutcomeIds: SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS,
          allowedEvidenceClasses: [
            "operator_attested",
            "authoritative_external",
          ],
          trusted: true,
        } as never,
        mutation: mutation(),
      })
    ).toThrow(UntrustedGoldlineIssuanceError);
    const namedForgery = {
      [GOLDLINE_PRODUCER_CAPABILITY_BRAND]: true as const,
      producerNamespace: knownName,
      allowedOutcomeIds: SUPPORTED_PRODUCTION_GOLDLINE_OUTCOME_IDS,
      allowedEvidenceClasses: [
        "operator_attested" as const,
        "authoritative_external" as const,
      ],
    };
    expect(isAuthorizedGoldlineProducerCapability(namedForgery)).toBe(false);
    expect(() =>
      issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
        producer: namedForgery,
        mutation: mutation(),
      })
    ).toThrow(UntrustedGoldlineIssuanceError);
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
  });

  it("4. same sourceEventId / same tenant / different operator does not collide", () => {
    const sourceEventId = "shared-source";
    const first = issueSupported({
      sourceEventId,
      operatorUserId: "op-e",
    });
    const second = issueSupported({
      sourceEventId,
      operatorUserId: "op-other",
    });
    expect(first.receiptId).not.toBe(second.receiptId);
    expect(first.tenantId).toBe(second.tenantId);
  });

  it("5. exact same authoritative source event produces a stable receipt identity", () => {
    const first = issueSupported({ sourceEventId: "stable-src" });
    const second = issueSupported({ sourceEventId: "stable-src" });
    expect(first.receiptId).toBe(second.receiptId);
    expect(first.receiptId).toBe(
      goldlineReceiptIdFromAuthoritativeIdentity({
        tenantId: scope.tenantId,
        operatorUserId: scope.operatorUserId,
        producerNamespace: TEST_PRODUCER_A,
        sourceEventId: "stable-src",
      })
    );
  });

  it("same sourceEventId / same tenant+operator / different producer namespace does not collide", () => {
    const sourceEventId = "ns-shared";
    const first = issueSupported({
      sourceEventId,
      producerNamespace: TEST_PRODUCER_A,
    });
    const second = issueSupported({
      sourceEventId,
      producerNamespace: TEST_PRODUCER_B,
    });
    expect(first.receiptId).not.toBe(second.receiptId);
  });

  it("6. exact duplicate ingest remains idempotent", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({ sourceEventId: "dup-identical" });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(1);
    expect(loaded?.ledger[0]?.goldlineOutcomeId).toBe(receipt.outcomeId);
  });

  it("7. same receipt identity + conflicting outcome fails closed", async () => {
    const { store } = await seeded();
    const first = issueSupported({
      sourceEventId: "conflict-outcome",
      outcomeId: "spoken_no",
    });
    const second = issueSupported({
      sourceEventId: "conflict-outcome",
      outcomeId: "contact_reopened_after_no",
    });
    expect(first.receiptId).toBe(second.receiptId);
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: first });
    await expect(
      ingestVerifiedGoldlineOutcome({ store, scope, receipt: second })
    ).rejects.toBeInstanceOf(ConflictingGoldlineLedgerReplayError);
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(1);
    expect(loaded?.ledger[0]?.goldlineOutcomeId).toBe("spoken_no");
    expect(loaded?.ledger[0]?.persistedVerifiedGoldline?.outcomeId).toBe(
      "spoken_no"
    );
  });

  it("8. same receipt identity + conflicting target fails closed", async () => {
    const { store } = await seeded();
    const first = issueSupported({
      sourceEventId: "conflict-target",
      targetId: "target-a",
    });
    const second = issueSupported({
      sourceEventId: "conflict-target",
      targetId: "target-b",
    });
    expect(first.receiptId).toBe(second.receiptId);
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: first });
    await expect(
      ingestVerifiedGoldlineOutcome({ store, scope, receipt: second })
    ).rejects.toBeInstanceOf(ConflictingGoldlineLedgerReplayError);
    const loaded = await store.load(scope);
    expect(loaded?.ledger[0]?.persistedVerifiedGoldline?.targetRef).toEqual({
      kind: "goldline_target",
      id: "target-a",
    });
  });

  it("9. same receipt identity + conflicting chronology/evidence fails closed", async () => {
    const { store } = await seeded();
    const first = issueSupported({
      sourceEventId: "conflict-time",
      occurredAtMs: MONDAY_MS,
      evidenceClass: "operator_attested",
    });
    const second = issueSupported({
      sourceEventId: "conflict-time",
      occurredAtMs: TUESDAY_MS,
      evidenceClass: "authoritative_external",
      sourceVerificationClass: "VERIFIED",
      evidenceRef: {
        sourceType: "provider_call",
        sourceReference: "twilio:CA-conflict",
        classification: "authoritative_external",
      },
    });
    expect(first.receiptId).toBe(second.receiptId);
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: first });
    await expect(
      ingestVerifiedGoldlineOutcome({ store, scope, receipt: second })
    ).rejects.toBeInstanceOf(ConflictingGoldlineLedgerReplayError);
    const loaded = await store.load(scope);
    expect(loaded?.ledger[0]?.persistedVerifiedGoldline?.occurredAtMs).toBe(
      MONDAY_MS
    );
    expect(loaded?.ledger[0]?.persistedVerifiedGoldline?.evidenceClass).toBe(
      "operator_attested"
    );
  });

  it("10. Drizzle duplicate path verifies identity/payload rather than blindly returning the existing row", () => {
    const first = issueSupported({
      sourceEventId: "drizzle-dup",
      outcomeId: "spoken_no",
    });
    const second = issueSupported({
      sourceEventId: "drizzle-dup",
      outcomeId: "contact_reopened_after_no",
    });
    const existing = drizzleShapedGoldlineRow(first, { id: "db-row" });
    const incoming = drizzleShapedGoldlineRow(second, { id: "new-row" });
    expect(() =>
      resolveDuplicateNarratorLedgerInsert(existing, incoming)
    ).toThrow(ConflictingGoldlineLedgerReplayError);
    const replayed = resolveDuplicateNarratorLedgerInsert(existing, existing);
    expect(replayed).toBe(existing);
    expect(replayed.persistedVerifiedGoldline?.outcomeId).toBe("spoken_no");
    const drizzleSrc = readFileSync(
      resolve(REPO_ROOT, "server/narratorOs/drizzleStore.ts"),
      "utf8"
    );
    expect(drizzleSrc).toMatch(/resolveDuplicateNarratorLedgerInsert/);
    expect(drizzleSrc).not.toMatch(
      /if \(existing\) return ledgerFromRow\(existing\)/
    );
  });

  it("11. rehydration rejects a ledger payload whose receipt identity is inconsistent", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({ sourceEventId: "rehydrate-bad" });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    const tampered: NarratorSnapshot = {
      ...loaded!,
      ledger: loaded!.ledger.map(entry => ({
        ...entry,
        persistedVerifiedGoldline: {
          ...entry.persistedVerifiedGoldline!,
          receiptId: "glv:tampered-identity",
        },
      })),
    };
    expect(rehydratePersistedVerifiedGoldlineReceipts(tampered)).toEqual([]);
    const swappedOutcome: NarratorSnapshot = {
      ...loaded!,
      ledger: loaded!.ledger.map(entry => ({
        ...entry,
        goldlineOutcomeId: "contact_reopened_after_no",
      })),
    };
    expect(rehydratePersistedVerifiedGoldlineReceipts(swappedOutcome)).toEqual(
      []
    );
    const droppedIdentity: NarratorSnapshot = {
      ...loaded!,
      ledger: loaded!.ledger.map(entry => {
        const persisted = { ...entry.persistedVerifiedGoldline! };
        delete persisted.producerNamespace;
        delete persisted.sourceEventId;
        return { ...entry, persistedVerifiedGoldline: persisted };
      }),
    };
    expect(rehydratePersistedVerifiedGoldlineReceipts(droppedIdentity)).toEqual(
      []
    );
    const production = evaluateProductionEligibility(
      evalInput(tampered, { verifiedGoldline: [] })
    );
    expect(production.eligibleBeatIds).not.toContain(BEAT_IDS.M04);
  });

  it("12. restart/reload eligibility still works from a valid persisted receipt", async () => {
    const { store } = await seeded();
    const receipt = issueSupported({
      sourceEventId: "reload-valid",
      outcomeId: "kept_promised_send_visit_or_call",
    });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt });
    const reloaded = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    expect(
      evaluateProductionEligibility(
        evalInput(reloaded!, { verifiedGoldline: [] })
      ).eligibleBeatIds
    ).toContain(BEAT_IDS.M04);
  });

  it("13. existing M03 persisted-evidence regression stays green", async () => {
    const { store } = await seeded();
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({
        sourceEventId: "m03-no",
        outcomeId: "spoken_no",
        occurredAtMs: MONDAY_MS,
      }),
    });
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({
        sourceEventId: "m03-reopen",
        outcomeId: "contact_reopened_after_no",
        occurredAtMs: TUESDAY_MS,
      }),
    });
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({
        sourceEventId: "m03-return",
        outcomeId: "legitimate_second_site_visit",
        occurredAtMs: WEDNESDAY_MS,
      }),
    });
    const reloaded = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    expect(
      evaluateProductionEligibility(
        evalInput(reloaded!, { verifiedGoldline: [] })
      ).eligibleBeatIds
    ).toContain(BEAT_IDS.M03);
  });

  it("14. zero live business mutation producers remain wired", () => {
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
    expect(
      "PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES" in producerCapabilityModule
    ).toBe(false);
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
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src).not.toMatch(/goldlineVerification/);
      expect(src).not.toMatch(/claimTestGoldlineProducerCapability/);
      expect(src).not.toMatch(/GOLDLINE_PRODUCER_CAPABILITY_BRAND/);
    }
  });
});

function forgedBrandedKeepReceipt(): VerifiedGoldlineReceipt {
  return {
    [VERIFIED_GOLDLINE_RECEIPT_BRAND]: true as const,
    receiptId: goldlineReceiptIdFromAuthoritativeIdentity({
      tenantId: scope.tenantId,
      operatorUserId: scope.operatorUserId,
      producerNamespace: TEST_PRODUCER_A,
      sourceEventId: "forged-keep",
    }),
    tenantId: scope.tenantId,
    operatorUserId: scope.operatorUserId,
    outcomeId: "kept_promised_send_visit_or_call",
    verificationClass: "VERIFIED",
    evidenceClass: "operator_attested",
    evidenceRef: {
      sourceType: "goldline_field_commitment",
      sourceReference: "field_commitment:forged-keep",
      classification: "operator_attested",
    },
    targetRef: { kind: "goldline_target", id: "target-a" },
    occurredAtMs: MONDAY_MS,
    producerNamespace: TEST_PRODUCER_A,
    sourceEventId: "forged-keep",
  };
}

describe("Narrator OS Slice E — unforgeable receipt membership and hidden production capabilities", () => {
  it("1. knowing VERIFIED_GOLDLINE_RECEIPT_BRAND does not make a perfect object ingestible", async () => {
    const { store } = await seeded();
    const forged = forgedBrandedKeepReceipt();
    expect(isVerifiedGoldlineReceiptShape(forged)).toBe(true);
    expect(isVerifiedGoldlineReceipt(forged)).toBe(false);
    expect(isUpstreamIssuedVerifiedGoldlineReceipt(forged)).toBe(false);
    await expect(
      recordVerifiedGoldlineOutcome({
        store,
        scope,
        receipt: forged,
      })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);
    await expect(
      ingestVerifiedGoldlineOutcome({ store, scope, receipt: forged })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("2. a forged branded object cannot satisfy production eligibility through live input", async () => {
    const { snapshot } = await seeded();
    const forged = forgedBrandedKeepReceipt();
    const production = evaluateProductionEligibility(
      evalInput(snapshot, { verifiedGoldline: [forged] })
    );
    expect(production.eligibleBeatIds).not.toContain(BEAT_IDS.M04);
    expect(productionVerifiedGoldlineEvidence(snapshot, [forged])).toEqual([]);
  });

  it("arbitrary server code cannot promote a forged branded object into legal production eligibility", async () => {
    const { snapshot } = await seeded();
    const forged = forgedBrandedKeepReceipt();
    const authority = await import(
      "../narratorOs/verifiedGoldlineReceiptAuthority"
    );
    const persistence = await import(
      "../narratorOs/verifiedGoldlinePersistence"
    );
    const receiptModule = await import("../narratorOs/verifiedGoldlineReceipt");
    const narratorIndex = await import("../narratorOs/index");
    expect("rememberRehydratedVerifiedGoldlineEvidence" in authority).toBe(
      false
    );
    expect("rememberRehydratedVerifiedGoldlineEvidence" in persistence).toBe(
      false
    );
    expect("rememberRehydratedVerifiedGoldlineEvidence" in receiptModule).toBe(
      false
    );
    expect("rememberRehydratedVerifiedGoldlineEvidence" in narratorIndex).toBe(
      false
    );
    const authoritySrc = readFileSync(
      resolve(
        REPO_ROOT,
        "server/narratorOs/verifiedGoldlineReceiptAuthority.ts"
      ),
      "utf8"
    );
    const persistenceSrc = readFileSync(
      resolve(REPO_ROOT, "server/narratorOs/verifiedGoldlinePersistence.ts"),
      "utf8"
    );
    expect(authoritySrc).not.toMatch(
      /export function rememberRehydratedVerifiedGoldlineEvidence/
    );
    expect(persistenceSrc).not.toMatch(
      /rememberRehydratedVerifiedGoldlineEvidence/
    );
    for (const mod of [authority, persistence, receiptModule, narratorIndex]) {
      for (const [name, value] of Object.entries(mod)) {
        if (typeof value !== "function") continue;
        if (/test/i.test(name)) continue;
        try {
          const result = value(forged);
          if (
            result &&
            typeof (result as Promise<unknown>).then === "function"
          ) {
            await result;
          }
        } catch {
          /* production APIs may reject untrusted input */
        }
      }
    }
    expect(isVerifiedGoldlineReceipt(forged)).toBe(false);
    expect(isLegalEligibilityGoldlineEvidence(forged)).toBe(false);
    expect(isRehydratedVerifiedGoldlineEvidence(forged)).toBe(false);
    expect(
      evaluateProductionEligibility(
        evalInput(snapshot, { verifiedGoldline: [forged] })
      ).eligibleBeatIds
    ).not.toContain(BEAT_IDS.M04);
    expect(productionVerifiedGoldlineEvidence(snapshot, [forged])).toEqual([]);
  });

  it("3. a validated persisted receipt still satisfies production eligibility after restart", async () => {
    const { store } = await seeded();
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({ sourceEventId: "persist-keep" }),
    });
    const reloaded = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    const hydrated = rehydratePersistedVerifiedGoldlineReceipts(reloaded!);
    expect(hydrated).toHaveLength(1);
    expect(isRehydratedVerifiedGoldlineEvidence(hydrated[0]!)).toBe(true);
    expect(
      evaluateProductionEligibility(
        evalInput(reloaded!, { verifiedGoldline: [] })
      ).eligibleBeatIds
    ).toContain(BEAT_IDS.M04);
  });

  it("4. rehydrated persisted evidence cannot be reused as a fresh upstream ingest credential", async () => {
    const { store } = await seeded();
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({ sourceEventId: "no-reuse" }),
    });
    const reloadedStore = reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    );
    const reloaded = await reloadedStore.load(scope);
    const [hydrated] = rehydratePersistedVerifiedGoldlineReceipts(reloaded!);
    expect(hydrated).toBeTruthy();
    expect(isUpstreamIssuedVerifiedGoldlineReceipt(hydrated!)).toBe(false);
    expect(isRehydratedVerifiedGoldlineEvidence(hydrated!)).toBe(true);
    await expect(
      ingestVerifiedGoldlineOutcome({
        store: reloadedStore,
        scope,
        receipt: hydrated!,
      })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);
    expect((await reloadedStore.load(scope))?.ledger).toHaveLength(1);
  });

  it("5. no raw production capability collection/object is exported", async () => {
    expect(
      "PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES" in producerCapabilityModule
    ).toBe(false);
    expect(
      Object.keys(producerCapabilityModule).some(key => /production/i.test(key))
    ).toBe(false);
    const capabilitySrc = readFileSync(
      resolve(HERE, "producerCapability.ts"),
      "utf8"
    );
    expect(capabilitySrc).not.toMatch(
      /export const PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES/
    );
    expect(capabilitySrc).not.toMatch(
      /export function (get|list|lookup)\w*[Cc]apabilit/
    );
    const narratorIndex = await import("../narratorOs/index");
    expect(
      "rememberUpstreamIssuedVerifiedGoldlineReceipt" in narratorIndex
    ).toBe(false);
    expect("rememberRehydratedVerifiedGoldlineEvidence" in narratorIndex).toBe(
      false
    );
    expect(
      "rememberTestUpstreamIssuedVerifiedGoldlineReceipt" in narratorIndex
    ).toBe(false);
    expect("PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES" in narratorIndex).toBe(
      false
    );
  });

  it("6. test-only producer authority still works only in test", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    try {
      expect(() => testProducer()).toThrow(/not available outside tests/);
    } finally {
      vi.unstubAllEnvs();
    }
    const capability = testProducer();
    const receipt = issueVerifiedGoldlineReceiptFromAuthoritativeMutation({
      producer: capability,
      mutation: mutation({ sourceEventId: "test-gate" }),
    });
    expect(isUpstreamIssuedVerifiedGoldlineReceipt(receipt)).toBe(true);
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
  });

  it("7. production producer registry remains empty", () => {
    expect(REGISTERED_PRODUCTION_GOLDLINE_PRODUCERS).toEqual([]);
    expect(
      "PRODUCTION_GOLDLINE_PRODUCER_CAPABILITIES" in producerCapabilityModule
    ).toBe(false);
  });

  it("8. prior Slice E identity/replay/M03 regressions remain green", async () => {
    const { store } = await seeded();
    const sourceEventId = "prior-identity";
    const first = issueSupported({
      sourceEventId,
      operatorUserId: "op-e",
    });
    const otherOp = issueSupported({
      sourceEventId,
      operatorUserId: "op-other",
    });
    expect(first.receiptId).not.toBe(otherOp.receiptId);
    expect(issueSupported({ sourceEventId }).receiptId).toBe(first.receiptId);
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: first });
    await ingestVerifiedGoldlineOutcome({ store, scope, receipt: first });
    expect((await store.load(scope))?.ledger).toHaveLength(1);
    const conflicting = issueSupported({
      sourceEventId,
      outcomeId: "contact_reopened_after_no",
    });
    await expect(
      ingestVerifiedGoldlineOutcome({ store, scope, receipt: conflicting })
    ).rejects.toBeInstanceOf(ConflictingGoldlineLedgerReplayError);
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({
        sourceEventId: "prior-m03-no",
        outcomeId: "spoken_no",
        occurredAtMs: MONDAY_MS,
      }),
    });
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({
        sourceEventId: "prior-m03-reopen",
        outcomeId: "contact_reopened_after_no",
        occurredAtMs: TUESDAY_MS,
      }),
    });
    await ingestVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: issueSupported({
        sourceEventId: "prior-m03-return",
        outcomeId: "legitimate_second_site_visit",
        occurredAtMs: WEDNESDAY_MS,
      }),
    });
    const reloaded = await reloadInMemoryNarratorStoreFromSnapshot(
      (await store.load(scope))!
    ).load(scope);
    expect(
      evaluateProductionEligibility(
        evalInput(reloaded!, { verifiedGoldline: [] })
      ).eligibleBeatIds
    ).toContain(BEAT_IDS.M03);
  });
});
