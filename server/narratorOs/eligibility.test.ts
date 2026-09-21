import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AUTHORED_BEAT_DEFAULTS,
  asNarrativeBeatId,
  type AuthoredBeat,
} from "../../shared/narratorOs/contracts";
import { isLegalEligibilityGoldlineEvidence } from "./brainBoundary";
import {
  eligibilityMutates,
  evaluateEligibility,
  evaluateProductionEligibility,
  issueEligibilityAuthorizations,
  isEligibilityAuthorization,
  outcomeOfPassing,
  type EligibilityInput,
} from "./eligibility";
import {
  applyElapsedTime,
  applyQuietClose,
  commitAuthorizedBeat,
  commitFiredBeat,
  fireOffscreenIfLegal,
  IneligibleBeatCommitError,
  recordVerifiedGoldlineOutcome,
  UntrustedGoldlineReceiptError,
} from "./ledger";
import { issueVerifiedGoldlineReceiptForTests } from "./verifiedGoldlineReceipt.testSupport";
import {
  isVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";
import { initNarratorOperator } from "./init";
import { createInMemoryNarratorStore } from "./memoryStore";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  BEAT_IDS,
  getBeat,
  offscreenCatalog,
} from "./registry";
import { UnknownBeatLedgerError, type NarratorSnapshot } from "./store";

const scope = { tenantId: "t-d", operatorUserId: "op-d" };

const LATE_REVEAL_IDS = [
  BEAT_IDS.K_COVE_ORIGIN,
  BEAT_IDS.CONSTRUCTEDNESS,
  "M15",
  "M16",
  "M17",
  "M18",
  "M19",
  "M20",
  "M21",
  "M22",
  "M23",
  "M24",
] as const;

async function seeded(): Promise<{
  store: ReturnType<typeof createInMemoryNarratorStore>;
  snapshot: NarratorSnapshot;
}> {
  const store = createInMemoryNarratorStore();
  const snapshot = await initNarratorOperator(store, scope);
  return { store, snapshot };
}

function issueReceipt(
  outcomeId: string,
  extra?: {
    evidenceClass?: "authoritative_external" | "operator_attested";
    receiptId?: string;
    tenantId?: string;
    operatorUserId?: string;
  }
): VerifiedGoldlineReceipt {
  const evidenceClass = extra?.evidenceClass ?? "operator_attested";
  return issueVerifiedGoldlineReceiptForTests({
    receiptId: extra?.receiptId ?? `receipt:${outcomeId}:${scope.tenantId}`,
    tenantId: extra?.tenantId ?? scope.tenantId,
    operatorUserId: extra?.operatorUserId ?? scope.operatorUserId,
    outcomeId,
    evidenceClass,
    evidenceRef: {
      sourceType:
        evidenceClass === "operator_attested"
          ? "field_visit"
          : "external_record",
      sourceReference: extra?.receiptId ?? `receipt:${outcomeId}`,
      classification: evidenceClass,
    },
  });
}

function isolatedBeat(
  partial: Partial<AuthoredBeat> & { id: string }
): AuthoredBeat {
  return {
    ...AUTHORED_BEAT_DEFAULTS,
    title: "isolated-test",
    canonStatus: "LOCKED",
    authoredSourceRef: "isolated-test-not-canon",
    ...partial,
    id: asNarrativeBeatId(partial.id),
  };
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
    nowMs: Date.parse("2026-09-21T00:00:00Z"),
    mode: "interactive",
    ...extra,
  };
}

describe("Narrator OS slice D — ledger + eligibility + persistence", () => {
  it("returns NO_ELIGIBLE for a brand-new interactive user; late reveals stay ineligible", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.outcome).toBe("NO_ELIGIBLE");
    expect(result.eligibleBeatIds).toEqual([]);
    expect(result.withheldBeatIds).toEqual([]);
    expect(eligibilityMutates(result)).toBe(false);
    expect(snapshot.ledger).toEqual([]);
    for (const id of LATE_REVEAL_IDS) {
      const audit = result.audit.find(entry => entry.beatId === id)!;
      expect(audit.pass).toBe(false);
      expect(audit.failedGates.length).toBeGreaterThan(0);
    }
    expect(
      result.audit.find(entry => entry.beatId === BEAT_IDS.K_COVE_ORIGIN)
        ?.failedGates
    ).toEqual(
      expect.arrayContaining(["incomplete_eligibility", "open_unresolved"])
    );
    expect(
      result.audit.find(entry => entry.beatId === BEAT_IDS.CONSTRUCTEDNESS)
        ?.failedGates
    ).toContain("incomplete_eligibility");
    expect(
      result.audit.find(entry => entry.beatId === "M02")?.failedGates
    ).toContain("incomplete_eligibility");
    expect(
      result.audit.find(entry => entry.beatId === "M04")?.failedGates
    ).toContain("prerequisite");
    expect(
      result.audit.find(entry => entry.beatId === "M15")?.failedGates
    ).toContain("incomplete_eligibility");
  });

  it("returns ELIGIBLE_WITHHELD only from authored defaultSurface metadata, never taste", () => {
    expect(getBeat("constructedness").defaultSurface).toBe(false);
    expect(outcomeOfPassing([getBeat("constructedness")])).toBe(
      "ELIGIBLE_WITHHELD"
    );
    expect(outcomeOfPassing([getBeat("M03")])).toBe("ELIGIBLE");
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/eligibility.ts"),
      "utf8"
    );
    expect(src).not.toMatch(
      /feel(?:s)? early|pacing|exciting|mystery better|right time/i
    );
  });

  it("does not fire offscreen when the production catalog is empty", async () => {
    const { store, snapshot } = await seeded();
    expect(offscreenCatalog()).toEqual([]);
    const none = await fireOffscreenIfLegal({
      store,
      scope,
      eligibility: evalInput(snapshot, { mode: "offscreen" }),
    });
    expect(none.fired).toEqual([]);
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("refuses raw-id commit, ineligible commit, offscreen-disallowed commit, and incomplete/OPEN commit", async () => {
    const { store, snapshot } = await seeded();
    await expect(
      commitFiredBeat({ store, scope, beatId: "CL-031" })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    await expect(
      commitFiredBeat({ store, scope, beatId: "constructedness" })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);

    const interactive = evalInput(snapshot);
    const result = evaluateEligibility(interactive);
    expect(issueEligibilityAuthorizations(result, interactive)).toEqual([]);

    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: {
          beatId: BEAT_IDS.CONSTRUCTEDNESS,
          mode: "interactive",
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
          ledgerLength: 0,
        } as never,
        eligibility: interactive,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);

    const m03Ready = evalInput(snapshot, {
      verifiedGoldline: [issueReceipt("spoken_no")],
    });
    const m03Result = evaluateEligibility(m03Ready);
    const auths = issueEligibilityAuthorizations(m03Result, m03Ready);
    const m03Auth = auths.find(auth => auth.beatId === BEAT_IDS.M03);
    expect(m03Auth && isEligibilityAuthorization(m03Auth)).toBe(true);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: m03Auth!,
        eligibility: { ...m03Ready, mode: "offscreen" },
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
  });

  it("commits an authorized COMPLETE beat atomically and refuses non-repeatable replay", async () => {
    const { store, snapshot } = await seeded();
    const eligibility = evalInput(snapshot, {
      verifiedGoldline: [issueReceipt("spoken_no")],
    });
    const result = evaluateEligibility(eligibility);
    expect(result.eligibleBeatIds).toContain(BEAT_IDS.M03);
    const authorization = issueEligibilityAuthorizations(
      result,
      eligibility
    ).find(auth => auth.beatId === BEAT_IDS.M03)!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization,
      eligibility,
    });
    expect(after.ledger).toHaveLength(1);
    expect(after.ledger[0]?.beatId).toBe("M03");
    expect(after.narrativeState.values.m03).toBe("FIRED");
    expect(after.knowledge.planes.PLAYER.knownFactIds).not.toContain(
      "antarctica_is_father_reveal"
    );

    const replay = evaluateEligibility(
      evalInput(after, { verifiedGoldline: eligibility.verifiedGoldline })
    );
    const replayAuth = issueEligibilityAuthorizations(
      replay,
      evalInput(after, { verifiedGoldline: eligibility.verifiedGoldline })
    ).find(auth => auth.beatId === BEAT_IDS.M03);
    expect(replayAuth).toBeUndefined();
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization,
        eligibility: evalInput(after, {
          verifiedGoldline: eligibility.verifiedGoldline,
        }),
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    expect((await store.load(scope))?.ledger).toHaveLength(1);
  });

  it("lets Quiet close forward possibility without minting facts or rewriting events", async () => {
    const { snapshot } = await seeded();
    const closed = applyQuietClose(snapshot.narrativeState, "M03", true);
    expect(closed.closedForwardPaths).toEqual(["M03"]);
    expect(closed.values.m03).toBe("ARMED");
    expect(snapshot.ledger).toEqual([]);
    expect(snapshot.knowledge.planes.PLAYER.knownFactIds).toEqual([]);

    const aged = applyElapsedTime(
      { ...closed, holdOpenedAtMs: { m04_hold: 0 } },
      10_000,
      [
        {
          key: "m04_hold",
          durationMs: null,
          pathId: "M04",
          canonStatus: "WORKING",
        },
      ]
    );
    expect(aged.createdEvents).toBe(false);
    expect(aged.state.closedForwardPaths).toEqual(["M03"]);
  });

  it("time-ages an authored HOLD window and still creates no events", () => {
    const aged = applyElapsedTime(
      {
        values: {},
        closedForwardPaths: [],
        holdOpenedAtMs: { m04_hold: 0 },
      },
      5_000,
      [
        {
          key: "m04_hold",
          durationMs: 1_000,
          pathId: "M04",
          canonStatus: "LOCKED",
        },
      ]
    );
    expect(aged.createdEvents).toBe(false);
    expect(aged.state.closedForwardPaths).toEqual(["M04"]);
  });

  it("reality firewall: unverified evidence cannot satisfy Goldline gates", async () => {
    const { snapshot } = await seeded();
    expect(
      isLegalEligibilityGoldlineEvidence({
        verificationClass: "CLAIMED",
        evidenceClass: "operator_attested",
      })
    ).toBe(false);
    expect(
      isLegalEligibilityGoldlineEvidence({
        outcomeId: "spoken_no",
        verificationClass: "VERIFIED",
        evidenceClass: "operator_attested",
      })
    ).toBe(false);
    const m03 = evaluateEligibility(evalInput(snapshot)).audit.find(
      entry => entry.beatId === BEAT_IDS.M03
    )!;
    expect(m03.pass).toBe(false);
    expect(getBeat("M03").eligibilityConditions).toContainEqual({
      kind: "never_manufacture",
      claim: "rejection",
    });
    expect(
      evaluateEligibility(evalInput(snapshot)).audit.find(
        entry => entry.beatId === BEAT_IDS.C08
      )?.pass
    ).toBe(false);
  });

  it("audits every candidate with gates, not hidden reasoning", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.audit).toHaveLength(AUTHORED_BEATS.length);
    for (const entry of result.audit) {
      expect(entry.candidateConsidered).toBe(true);
      expect(entry.beatId).toBeTruthy();
      expect(["LOCKED", "WORKING", "OPEN"]).toContain(entry.canonStatus);
      expect(["COMPLETE", "INCOMPLETE"]).toContain(entry.eligibilityDefinition);
      expect(
        entry.finalOutcome === "pass" || entry.finalOutcome === "fail"
      ).toBe(true);
    }
  });

  it("records verified Goldline outcomes on the ledger when explicitly relevant", async () => {
    const { store } = await seeded();
    const receipt = issueReceipt("spoken_no");
    await recordVerifiedGoldlineOutcome({
      store,
      scope,
      receipt,
      relatedBeatId: BEAT_IDS.M03,
    });
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(1);
    expect(loaded?.ledger[0]?.kind).toBe("VERIFIED_GOLDLINE_OUTCOME");
    expect(loaded?.ledger[0]?.goldlineOutcomeId).toBe(receipt.outcomeId);
    expect(loaded?.ledger[0]?.evidenceRef).toEqual(receipt.evidenceRef);
  });

  it("wraps drizzle knowledge replace and atomic commit in a transaction", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/drizzleStore.ts"),
      "utf8"
    );
    expect(src).toMatch(/async replaceKnowledge[\s\S]*db\.transaction/);
    expect(src).toMatch(/async commitAtomic[\s\S]*db\.transaction/);
  });
});

describe("Narrator OS brain boundary", () => {
  it("does not import Brain V2 or write goldline world events", () => {
    const files = [
      "server/narratorOs/eligibility.ts",
      "server/narratorOs/ledger.ts",
      "server/narratorOs/init.ts",
      "server/narratorOs/drizzleStore.ts",
      "server/narratorOs/registry.ts",
      "server/narratorOs/verifiedGoldlineReceipt.ts",
    ];
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/server\/claire\/brain/);
      expect(src).not.toMatch(/goldlineWorldEvents/);
      expect(src).not.toMatch(/workingMemoryGate/);
    }
  });
});

describe("Narrator OS verified Goldline receipt authority", () => {
  it("does not let a plain VERIFIED object satisfy eligibility", async () => {
    const { snapshot } = await seeded();
    const counterfeit = {
      outcomeId: "spoken_no",
      verificationClass: "VERIFIED",
      evidenceClass: "operator_attested",
      evidenceRef: {
        sourceType: "field_visit",
        sourceReference: "visit:1",
        classification: "operator_attested",
      },
    };
    expect(isVerifiedGoldlineReceipt(counterfeit)).toBe(false);
    expect(isLegalEligibilityGoldlineEvidence(counterfeit)).toBe(false);
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [counterfeit as never] })
    );
    expect(result.eligibleBeatIds).not.toContain(BEAT_IDS.M03);
    const m03 = result.audit.find(entry => entry.beatId === BEAT_IDS.M03)!;
    expect(m03.pass).toBe(false);
    expect(m03.failedGates).toContain("prerequisite");
    expect(
      m03.prerequisiteChecks.some(
        check =>
          check.detail.includes("verified_goldline_any") &&
          check.passed === false
      )
    ).toBe(true);
  });

  it("does not let a caller mint spoken_no and unlock M03", async () => {
    const { snapshot } = await seeded();
    const minted = {
      outcomeId: "spoken_no",
      verificationClass: "VERIFIED" as const,
      evidenceClass: "operator_attested" as const,
    };
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [minted as never] })
    );
    expect(result.outcome).toBe("NO_ELIGIBLE");
    expect(result.eligibleBeatIds).not.toContain(BEAT_IDS.M03);
    expect(
      result.audit.find(entry => entry.beatId === BEAT_IDS.M03)?.pass
    ).toBe(false);
  });

  it("lets only a trusted opaque receipt satisfy a Goldline evidence prerequisite", async () => {
    const { snapshot } = await seeded();
    const receipt = issueReceipt("spoken_no");
    expect(isVerifiedGoldlineReceipt(receipt)).toBe(true);
    expect(isLegalEligibilityGoldlineEvidence(receipt)).toBe(true);
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [receipt] })
    );
    expect(result.eligibleBeatIds).toContain(BEAT_IDS.M03);
    const m03 = result.audit.find(entry => entry.beatId === BEAT_IDS.M03)!;
    expect(m03.pass).toBe(true);
    expect(m03.failedGates).toEqual([]);
  });

  it("persists an authorized receipt without changing its meaning", async () => {
    const { store } = await seeded();
    const receipt = issueReceipt("spoken_no");
    await recordVerifiedGoldlineOutcome({
      store,
      scope,
      receipt,
      relatedBeatId: BEAT_IDS.M03,
    });
    const loaded = await store.load(scope);
    const entry = loaded?.ledger[0];
    expect(entry?.kind).toBe("VERIFIED_GOLDLINE_OUTCOME");
    expect(entry?.goldlineOutcomeId).toBe(receipt.outcomeId);
    expect(entry?.evidenceRef).toEqual({
      sourceType: receipt.evidenceRef.sourceType,
      sourceReference: receipt.evidenceRef.sourceReference,
      classification: receipt.evidenceRef.classification,
    });
    expect(entry?.evidenceRef?.classification).toBe(receipt.evidenceClass);
    expect(receipt.verificationClass).toBe("VERIFIED");
  });

  it("still cannot write upstream business truth or re-mint from ledger copies", async () => {
    const { store, snapshot } = await seeded();
    await expect(
      recordVerifiedGoldlineOutcome({
        store,
        scope,
        receipt: {
          outcomeId: "spoken_no",
          verificationClass: "VERIFIED",
          evidenceClass: "operator_attested",
          evidenceRef: {
            sourceType: "field_visit",
            sourceReference: "visit:1",
            classification: "operator_attested",
          },
        } as never,
      })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);

    const receipt = issueReceipt("spoken_no");
    await recordVerifiedGoldlineOutcome({ store, scope, receipt });
    const loaded = await store.load(scope);
    const ledgerCopy = {
      outcomeId: loaded?.ledger[0]?.goldlineOutcomeId,
      verificationClass: "VERIFIED",
      evidenceClass: loaded?.ledger[0]?.evidenceRef?.classification,
      evidenceRef: loaded?.ledger[0]?.evidenceRef,
    };
    expect(isVerifiedGoldlineReceipt(ledgerCopy)).toBe(false);
    const fromLedger = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [ledgerCopy as never] })
    );
    expect(fromLedger.eligibleBeatIds).not.toContain(BEAT_IDS.M03);

    const productionFiles = [
      "server/narratorOs/index.ts",
      "server/narratorOs/eligibility.ts",
      "server/narratorOs/ledger.ts",
      "server/narratorOs/brainBoundary.ts",
      "server/narratorOs/init.ts",
      "server/narratorOs/registry.ts",
      "server/narratorOs/drizzleStore.ts",
      "server/narratorOs/verifiedGoldlineReceipt.ts",
    ];
    for (const file of productionFiles) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/issueVerifiedGoldlineReceiptForTests/);
      expect(src).not.toMatch(/verifiedGoldlineReceipt\.testSupport/);
    }
    const receiptSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/verifiedGoldlineReceipt.ts"),
      "utf8"
    );
    expect(receiptSrc).not.toMatch(/function issue/);
    expect(receiptSrc).not.toMatch(/Object\.freeze/);
    const indexSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/index.ts"),
      "utf8"
    );
    expect(indexSrc).not.toMatch(/issueVerifiedGoldlineReceiptForTests/);
    expect(indexSrc).not.toMatch(/verifiedGoldlineReceiptBrand/);
    expect(indexSrc).not.toMatch(/verifiedGoldlineReceipt\.testSupport/);
    const prod = await import("./index");
    expect("issueVerifiedGoldlineReceiptForTests" in prod).toBe(false);
    expect("VERIFIED_GOLDLINE_RECEIPT_BRAND" in prod).toBe(false);
    const receiptModule = await import("./verifiedGoldlineReceipt");
    expect("issueVerifiedGoldlineReceiptForTests" in receiptModule).toBe(false);
  });
});

describe("Narrator OS production registry authority", () => {
  it("rejects a fake COMPLETE beat that evaluated against a caller registry", async () => {
    const { store, snapshot } = await seeded();
    const fake = isolatedBeat({
      id: "FAKE-COMPLETE",
      eligibilityDefinition: "COMPLETE",
      defaultSurface: true,
      playerVisibility: true,
    });
    const fakeInput = evalInput(snapshot, {
      registry: [fake],
      graph: [],
    });
    const fakeResult = evaluateEligibility(fakeInput);
    expect(fakeResult.outcome).toBe("ELIGIBLE");
    expect(fakeResult.eligibleBeatIds).toContain("FAKE-COMPLETE");
    const auths = issueEligibilityAuthorizations(fakeResult, fakeInput);
    const fakeAuth = auths.find(auth => auth.beatId === "FAKE-COMPLETE");
    expect(fakeAuth && isEligibilityAuthorization(fakeAuth)).toBe(true);

    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: fakeAuth!,
        eligibility: fakeInput,
      })
    ).rejects.toBeInstanceOf(UnknownBeatLedgerError);
    expect((await store.load(scope))?.ledger).toEqual([]);
    expect((await store.load(scope))?.narrativeState.values.m03).toBe("ARMED");
  });

  it("rejects a rewritten canon beat that is incomplete in AUTHORED_BEATS", async () => {
    const { store, snapshot } = await seeded();
    const rewritten = isolatedBeat({
      ...getBeat("M15"),
      eligibilityDefinition: "COMPLETE",
      defaultSurface: true,
      playerVisibility: true,
      prerequisites: [],
      eligibilityConditions: [],
    });
    const fakeInput = evalInput(snapshot, {
      registry: [rewritten],
      graph: [],
    });
    const fakeResult = evaluateEligibility(fakeInput);
    expect(fakeResult.eligibleBeatIds).toContain("M15");
    const auth = issueEligibilityAuthorizations(fakeResult, fakeInput).find(
      item => item.beatId === "M15"
    )!;
    expect(isEligibilityAuthorization(auth)).toBe(true);

    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: auth,
        eligibility: fakeInput,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    expect((await store.load(scope))?.ledger).toEqual([]);

    const production = evaluateProductionEligibility(fakeInput);
    expect(production.eligibleBeatIds).not.toContain("M15");
    expect(
      production.audit.find(entry => entry.beatId === "M15")?.failedGates
    ).toContain("incomplete_eligibility");
  });
});

describe("Narrator OS test-only Goldline issuer", () => {
  it("refuses to mint receipts in a production runtime", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    try {
      expect(() =>
        issueVerifiedGoldlineReceiptForTests({
          receiptId: "evt-prod",
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
          outcomeId: "spoken_no",
          evidenceClass: "operator_attested",
          evidenceRef: {
            sourceType: "field_visit",
            sourceReference: "visit:prod",
            classification: "operator_attested",
          },
        })
      ).toThrow(/not available outside tests/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("Narrator OS scoped Goldline receipts", () => {
  it("does not let operator A's receipt unlock operator B", async () => {
    const { snapshot } = await seeded();
    const foreign = issueReceipt("spoken_no", {
      tenantId: "other-tenant",
      operatorUserId: "other-op",
      receiptId: "evt-a",
    });
    expect(isVerifiedGoldlineReceipt(foreign)).toBe(true);
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [foreign] })
    );
    expect(result.eligibleBeatIds).not.toContain(BEAT_IDS.M03);
    const { store } = await seeded();
    await expect(
      recordVerifiedGoldlineOutcome({ store, scope, receipt: foreign })
    ).rejects.toBeInstanceOf(UntrustedGoldlineReceiptError);
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("idempotently persists one receiptId and keeps distinct receipts distinct", async () => {
    const { store } = await seeded();
    const first = issueReceipt("spoken_no", { receiptId: "evt-1" });
    const second = issueReceipt("spoken_no", { receiptId: "evt-2" });
    await recordVerifiedGoldlineOutcome({ store, scope, receipt: first });
    await recordVerifiedGoldlineOutcome({ store, scope, receipt: first });
    let loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(1);
    expect(loaded?.ledger[0]?.idempotencyKey).toBe("goldline:evt-1");
    expect(loaded?.ledger[0]?.goldlineOutcomeId).toBe("spoken_no");

    await recordVerifiedGoldlineOutcome({ store, scope, receipt: second });
    loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(2);
    expect(loaded?.ledger.map(entry => entry.idempotencyKey)).toEqual([
      "goldline:evt-1",
      "goldline:evt-2",
    ]);
    expect(
      loaded?.ledger.every(entry => entry.goldlineOutcomeId === "spoken_no")
    ).toBe(true);
  });
});

describe("Narrator OS withheld beats have no execution authority", () => {
  it("does not authorize or commit an ELIGIBLE_WITHHELD beat", async () => {
    const { store, snapshot } = await seeded();
    const withheld = isolatedBeat({
      id: "WITHHELD-PASSING",
      eligibilityDefinition: "COMPLETE",
      defaultSurface: false,
      playerVisibility: false,
    });
    const input = evalInput(snapshot, {
      registry: [withheld],
      graph: [],
    });
    const result = evaluateEligibility(input);
    expect(result.outcome).toBe("ELIGIBLE_WITHHELD");
    expect(result.eligibleBeatIds).toEqual([]);
    expect(result.withheldBeatIds).toEqual(["WITHHELD-PASSING"]);
    expect(issueEligibilityAuthorizations(result, input)).toEqual([]);

    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: {
          beatId: withheld.id,
          mode: "interactive",
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
          ledgerLength: 0,
        } as never,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toEqual([]);
    expect(loaded?.knowledge).toEqual(snapshot.knowledge);
    expect(loaded?.narrativeState).toEqual(snapshot.narrativeState);
  });
});
