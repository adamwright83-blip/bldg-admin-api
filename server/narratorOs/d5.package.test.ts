import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTHORED_NARRATIVE_FACTS } from "./authoredNarrativeFacts";
import {
  AUTHORED_BEAT_DEFAULTS,
  PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS,
  asNarrativeBeatId,
  type AuthoredBeat,
  type ClaireDisclosurePolicy,
} from "../../shared/narratorOs/contracts";
import {
  evaluateEligibility,
  evaluateProductionEligibility,
  issueEligibilityAuthorizations,
  type EligibilityInput,
} from "./eligibility";
import { commitAuthorizedBeat, IneligibleBeatCommitError } from "./ledger";
import { issueVerifiedGoldlineReceiptForTests } from "./verifiedGoldlineReceipt.testSupport";
import {
  derivedM03ArmedTargetIds,
  m03OccurrenceIdempotencyKey,
  unconsumedM03FireTargetIds,
} from "./m03Readiness";
import { initNarratorOperator } from "./init";
import { createInMemoryNarratorStore } from "./memoryStore";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  BEAT_IDS,
  getBeat,
  hasChemistSkipPolicy,
  INTENTIONALLY_ABSENT_MISSION_IDS,
  isKnownBeatId,
  offscreenCatalog,
  originFalseWithoutChemistIsOpen,
} from "./registry";
import {
  disclosurePolicyMayBecomeOrdinarilyEligible,
  getClaireDisclosurePolicy,
  listClaireDisclosurePolicies,
} from "./disclosurePolicy";
import { CLAIRE_LIVED_BIO_FACTS } from "./livedBio";
import type { NarratorSnapshot } from "./store";
import type { VerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";

const scope = { tenantId: "t-d5", operatorUserId: "op-d5" };

const PRODUCTION_FILES = [
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
  "shared/narratorOs/contracts.ts",
];

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
    receiptId?: string;
    targetId?: string;
    tenantId?: string;
    operatorUserId?: string;
    occurredAtMs?: number;
  }
): VerifiedGoldlineReceipt {
  return issueVerifiedGoldlineReceiptForTests({
    receiptId:
      extra?.receiptId ?? `receipt:${outcomeId}:${extra?.targetId ?? "none"}`,
    tenantId: extra?.tenantId ?? scope.tenantId,
    operatorUserId: extra?.operatorUserId ?? scope.operatorUserId,
    outcomeId,
    evidenceClass: "operator_attested",
    evidenceRef: {
      sourceType: "field_visit",
      sourceReference: extra?.receiptId ?? `receipt:${outcomeId}`,
      classification: "operator_attested",
    },
    targetRef: extra?.targetId
      ? { kind: "goldline_target", id: extra.targetId }
      : null,
    occurredAtMs: extra?.occurredAtMs ?? 1,
  });
}

const MONDAY_MS = Date.parse("2026-09-14T12:00:00Z");
const TUESDAY_MS = Date.parse("2026-09-15T12:00:00Z");
const WEDNESDAY_MS = Date.parse("2026-09-16T12:00:00Z");
const THURSDAY_MS = Date.parse("2026-09-17T12:00:00Z");
const FRIDAY_MS = Date.parse("2026-09-18T12:00:00Z");

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

function withNarrativeFacts(
  snapshot: NarratorSnapshot,
  values: Record<string, string | boolean | number | null>
): NarratorSnapshot {
  return {
    ...snapshot,
    narrativeState: {
      ...snapshot.narrativeState,
      values: { ...snapshot.narrativeState.values, ...values },
    },
  };
}

describe("Narrator OS D.5 — canon package ingestion", () => {
  it("1. new operator is NO_ELIGIBLE", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.outcome).toBe("NO_ELIGIBLE");
    expect(result.eligibleBeatIds).toEqual([]);
    expect(result.withheldBeatIds).toEqual([]);
    expect(snapshot.ledger).toEqual([]);
  });

  it("2. new operator is not universally M03-ARMED", async () => {
    const { snapshot } = await seeded();
    expect(snapshot.narrativeState.values.m03).toBeUndefined();
    expect(Object.keys(snapshot.narrativeState.values)).toEqual([]);
    const armed = derivedM03ArmedTargetIds([], snapshot);
    expect(armed).toEqual([]);
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.eligibleBeatIds).not.toContain("M03");
    expect(result.audit.find(entry => entry.beatId === "M03")?.pass).toBe(
      false
    );
  });

  it("3. legal M03 ARMED is silence / authored no-show / spoken_no+later reopen, never spoken_no alone", async () => {
    const { store, snapshot } = await seeded();
    const noA = issueReceipt("spoken_no", { targetId: "target-a" });
    const silenceS = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-s",
    });
    const noShowN = issueReceipt("no_show", { targetId: "target-n" });
    expect(derivedM03ArmedTargetIds([noA], snapshot)).toEqual([]);
    expect(derivedM03ArmedTargetIds([silenceS], snapshot)).toEqual([
      "target-s",
    ]);
    expect(derivedM03ArmedTargetIds([noShowN], snapshot)).toEqual(["target-n"]);
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [noA] })
    );
    expect(result.eligibleBeatIds).not.toContain("M03");
    expect(result.audit.find(entry => entry.beatId === "M03")?.pass).toBe(
      false
    );
    expect(
      snapshot.ledger.some(
        entry => entry.kind === "FIRED_AUTHORED_BEAT" && entry.beatId === "M03"
      )
    ).toBe(false);
    expect(isKnownBeatId("N-M03-ARM")).toBe(false);
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("4. unrelated-target return cannot complete M03", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-b",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds(receipts, snapshot)).toEqual(["target-a"]);
    expect(unconsumedM03FireTargetIds(receipts, snapshot)).toEqual([]);
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: receipts })
    );
    expect(result.eligibleBeatIds).not.toContain("M03");
    expect(result.audit.find(entry => entry.beatId === "M03")?.pass).toBe(
      false
    );
  });

  it("5. valid same-target return can fire M03", async () => {
    const { store, snapshot } = await seeded();
    const silence = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-a",
      receiptId: "receipt:silence:target-a",
      occurredAtMs: MONDAY_MS,
    });
    const ret = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-a",
      receiptId: "receipt:return:target-a",
      occurredAtMs: TUESDAY_MS,
    });
    const eligibility = evalInput(snapshot, {
      verifiedGoldline: [ret, silence],
    });
    const result = evaluateEligibility(eligibility);
    expect(result.eligibleBeatIds).toContain("M03");
    const auth = issueEligibilityAuthorizations(result, eligibility).find(
      item => item.beatId === BEAT_IDS.M03
    )!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization: auth,
      eligibility,
    });
    expect(
      after.ledger.filter(
        entry => entry.kind === "FIRED_AUTHORED_BEAT" && entry.beatId === "M03"
      )
    ).toHaveLength(1);
    expect(after.ledger[0]?.idempotencyKey).toBe(
      m03OccurrenceIdempotencyKey("target-a", silence.receiptId)
    );
    expect(after.narrativeState.values.m03).not.toBe("ARMED");
  });

  it("6. M03 recurrence is evidence-cycle identity, not a caller-minted key", async () => {
    const { store, snapshot } = await seeded();
    const silenceA = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-a",
      receiptId: "receipt:silence-a-1",
      occurredAtMs: MONDAY_MS,
    });
    const returnA = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-a",
      receiptId: "receipt:return-a-1",
      occurredAtMs: TUESDAY_MS,
    });
    const firstPair = [returnA, silenceA];
    const eligibility = evalInput(snapshot, { verifiedGoldline: firstPair });
    const result = evaluateEligibility(eligibility);
    const auth = issueEligibilityAuthorizations(result, eligibility).find(
      item => item.beatId === BEAT_IDS.M03
    )!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization: auth,
      eligibility,
    });
    expect(after.ledger).toHaveLength(1);

    const replayInput = evalInput(after, { verifiedGoldline: firstPair });
    const replay = evaluateEligibility(replayInput);
    expect(replay.eligibleBeatIds).not.toContain("M03");
    expect(
      issueEligibilityAuthorizations(replay, replayInput).find(
        item => item.beatId === BEAT_IDS.M03
      )
    ).toBeUndefined();

    const laterSilenceA = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-a",
      receiptId: "receipt:silence-a-2",
      occurredAtMs: WEDNESDAY_MS,
    });
    const laterReturnA = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-a",
      receiptId: "receipt:return-a-2",
      occurredAtMs: THURSDAY_MS,
    });
    const laterInput = evalInput(after, {
      verifiedGoldline: [laterReturnA, laterSilenceA, ...firstPair],
    });
    const laterResult = evaluateEligibility(laterInput);
    expect(laterResult.eligibleBeatIds).toContain("M03");
    const laterAuth = issueEligibilityAuthorizations(
      laterResult,
      laterInput
    ).find(item => item.beatId === BEAT_IDS.M03)!;
    const afterLater = await commitAuthorizedBeat({
      store,
      scope,
      authorization: laterAuth,
      eligibility: laterInput,
    });
    expect(
      afterLater.ledger.filter(
        entry => entry.kind === "FIRED_AUTHORED_BEAT" && entry.beatId === "M03"
      )
    ).toHaveLength(2);
  });

  it("7. M04 miss fires nothing", async () => {
    const { store, snapshot } = await seeded();
    expect(isKnownBeatId("M04-MISS")).toBe(false);
    const miss = issueReceipt("hold_window_missed");
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [miss] })
    );
    expect(result.eligibleBeatIds).not.toContain("M04");
    expect(result.outcome).toBe("NO_ELIGIBLE");
    expect(snapshot.narrativeState.values.act_i).toBeUndefined();
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("8. M04 legitimate keep still fires", async () => {
    const { store, snapshot } = await seeded();
    const eligibility = evalInput(snapshot, {
      verifiedGoldline: [issueReceipt("kept_promised_send_visit_or_call")],
    });
    const result = evaluateEligibility(eligibility);
    expect(result.eligibleBeatIds).toContain("M04");
    const auth = issueEligibilityAuthorizations(result, eligibility).find(
      item => item.beatId === BEAT_IDS.M04
    )!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization: auth,
      eligibility,
    });
    expect(after.ledger[0]?.beatId).toBe("M04");
    expect(after.narrativeState.values.act_i).toBe("complete");
  });

  it("9. M02 remains INCOMPLETE", async () => {
    expect(getBeat("M02").eligibilityDefinition).toBe("INCOMPLETE");
    const { snapshot } = await seeded();
    const result = evaluateEligibility(
      evalInput(snapshot, {
        verifiedGoldline: [issueReceipt("leave_real_packet_or_collateral")],
      })
    );
    expect(
      result.audit.find(entry => entry.beatId === "M02")?.failedGates
    ).toContain("incomplete_eligibility");
    expect(result.eligibleBeatIds).not.toContain("M02");
  });

  it("10. C-06 is COMPLETE but withheld", async () => {
    const c06 = getBeat("C-06");
    expect(c06.eligibilityDefinition).toBe("COMPLETE");
    expect(c06.defaultSurface).toBe(false);
    expect(c06.mayFireOffscreen).toBe(false);
    expect(c06.repeatability).toBe("repeatable");
    expect(c06.irreversible).toBe(false);
    const { snapshot } = await seeded();
    const ready = withNarrativeFacts(snapshot, {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "DOES_NOT_SUPPORT",
    });
    const result = evaluateEligibility(evalInput(ready));
    expect(result.outcome).toBe("ELIGIBLE_WITHHELD");
    expect(result.withheldBeatIds).toContain("C-06");
    expect(result.eligibleBeatIds).not.toContain("C-06");
  });

  it("11. C-06 withheld has no execution authorization", async () => {
    const { store, snapshot } = await seeded();
    const ready = withNarrativeFacts(snapshot, {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "INSUFFICIENT",
    });
    await store.replaceNarrativeState(scope, ready.narrativeState);
    const live = (await store.load(scope))!;
    const input = evalInput(live);
    const result = evaluateEligibility(input);
    expect(result.outcome).toBe("ELIGIBLE_WITHHELD");
    expect(issueEligibilityAuthorizations(result, input)).toEqual([]);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: {
          beatId: BEAT_IDS.C06,
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
    expect(loaded?.narrativeState.values).toEqual(ready.narrativeState.values);
  });

  it("12. C-08 requires both narrative-state prereqs", async () => {
    const { snapshot } = await seeded();
    const onlyCore = withNarrativeFacts(snapshot, {
      [AUTHORED_NARRATIVE_FACTS.reservedCorePreserved]: "true",
    });
    const onlyLot = withNarrativeFacts(snapshot, {
      [AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand]: "true",
    });
    const both = withNarrativeFacts(snapshot, {
      [AUTHORED_NARRATIVE_FACTS.reservedCorePreserved]: "true",
      [AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand]: "true",
    });
    expect(
      evaluateEligibility(evalInput(onlyCore)).audit.find(
        entry => entry.beatId === "C-08"
      )?.pass
    ).toBe(false);
    expect(
      evaluateEligibility(evalInput(onlyLot)).audit.find(
        entry => entry.beatId === "C-08"
      )?.pass
    ).toBe(false);
    const bothResult = evaluateEligibility(evalInput(both));
    expect(bothResult.audit.find(entry => entry.beatId === "C-08")?.pass).toBe(
      true
    );
    expect(bothResult.eligibleBeatIds).toContain("C-08");
    expect(getBeat("C-08").defaultSurface).toBe(true);
  });

  it("13. a fake Goldline 17-K receipt cannot satisfy C-08", async () => {
    const { snapshot } = await seeded();
    const fake = issueReceipt("17k_physically_evidenced_in_hand");
    const result = evaluateEligibility(
      evalInput(snapshot, { verifiedGoldline: [fake] })
    );
    const c08 = result.audit.find(entry => entry.beatId === "C-08")!;
    expect(c08.pass).toBe(false);
    expect(c08.failedGates).toContain("prerequisite");
    expect(result.eligibleBeatIds).not.toContain("C-08");
  });

  it("14. C-08 does not make K-COVE-ORIGIN eligible", async () => {
    const { snapshot } = await seeded();
    const both = withNarrativeFacts(snapshot, {
      [AUTHORED_NARRATIVE_FACTS.reservedCorePreserved]: "true",
      [AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand]: "true",
    });
    const result = evaluateEligibility(evalInput(both));
    expect(result.eligibleBeatIds).toContain("C-08");
    expect(result.eligibleBeatIds).not.toContain("K-COVE-ORIGIN");
    const cove = result.audit.find(entry => entry.beatId === "K-COVE-ORIGIN")!;
    expect(cove.pass).toBe(false);
    expect(cove.failedGates).toEqual(
      expect.arrayContaining(["incomplete_eligibility", "open_unresolved"])
    );
  });

  it("15. Chemist-skip remains OPEN", () => {
    expect(originFalseWithoutChemistIsOpen()).toBe(true);
    expect(hasChemistSkipPolicy()).toBe(false);
    expect(
      AUTHORED_GRAPH.some(
        edge =>
          edge.policyId === "origin_false_without_chemist" &&
          edge.canonStatus === "OPEN"
      )
    ).toBe(true);
  });

  it("16. constructedness remains INCOMPLETE", () => {
    expect(getBeat("constructedness").eligibilityDefinition).toBe("INCOMPLETE");
  });

  it("17. M15+ remain INCOMPLETE", () => {
    for (const id of [
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
    ]) {
      expect(getBeat(id).eligibilityDefinition).toBe("INCOMPLETE");
    }
  });

  it("18. M05–M14 remain absent", () => {
    for (const id of INTENTIONALLY_ABSENT_MISSION_IDS) {
      expect(isKnownBeatId(id)).toBe(false);
    }
  });

  it("19. disclosure-policy records are not beats/events/knowledge mutations", () => {
    for (const policy of listClaireDisclosurePolicies()) {
      expect(isKnownBeatId(policy.id)).toBe(false);
    }
    expect(AUTHORED_BEATS.some(beat => beat.id === "CL-CORE")).toBe(false);
    expect(AUTHORED_BEATS.some(beat => beat.id === "CL-WARM-1")).toBe(false);
    expect(
      AUTHORED_BEATS.some(
        beat => beat.id === "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE"
      )
    ).toBe(false);
    expect(
      AUTHORED_BEATS.some(beat => beat.id === "CL-PRIV-EX-LAST-EXCHANGE")
    ).toBe(false);
  });

  it("20. disclosure lookup has zero mutation", async () => {
    const { snapshot } = await seeded();
    const before = structuredClone(snapshot);
    const policy = getClaireDisclosurePolicy("CL-CORE");
    expect(policy.askOnly).toBe(true);
    expect(policy.fromStart).toBe(true);
    const listed = listClaireDisclosurePolicies();
    expect(listed).toHaveLength(7);
    expect(getClaireDisclosurePolicy("CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE"));
    expect(getClaireDisclosurePolicy("CL-PRIV-EX-LAST-EXCHANGE"));
    expect(snapshot.ledger).toEqual(before.ledger);
    expect(snapshot.knowledge).toEqual(before.knowledge);
    expect(snapshot.narrativeState).toEqual(before.narrativeState);
    expect(snapshot.worldTruth).toEqual(before.worldTruth);
  });

  it("21. no offscreen life beats", () => {
    expect(offscreenCatalog()).toEqual([]);
    expect(AUTHORED_BEATS.every(beat => beat.mayFireOffscreen === false)).toBe(
      true
    );
  });

  it("22. caller-supplied registry still cannot create runtime canon", async () => {
    const { store, snapshot } = await seeded();
    const fake: AuthoredBeat = {
      ...AUTHORED_BEAT_DEFAULTS,
      id: asNarrativeBeatId("FAKE-D5"),
      title: "fake",
      canonStatus: "LOCKED",
      authoredSourceRef: "not-canon",
      eligibilityDefinition: "COMPLETE",
      defaultSurface: true,
      playerVisibility: true,
    };
    const fakeInput = evalInput(snapshot, { registry: [fake], graph: [] });
    const fakeResult = evaluateEligibility(fakeInput);
    expect(fakeResult.eligibleBeatIds).toContain("FAKE-D5");
    const auth = issueEligibilityAuthorizations(fakeResult, fakeInput)[0]!;
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: auth,
        eligibility: fakeInput,
      })
    ).rejects.toThrow();
    expect((await store.load(scope))?.ledger).toEqual([]);
    const production = evaluateProductionEligibility(fakeInput);
    expect(production.eligibleBeatIds).not.toContain("FAKE-D5");
  });
});

describe("Narrator OS D.5 — M03 authority correction", () => {
  it("1. ARM Monday then RETURN Tuesday on the same target may qualify", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        receiptId: "z-return-later-id",
        occurredAtMs: TUESDAY_MS,
      }),
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        receiptId: "a-silence-earlier-id",
        occurredAtMs: MONDAY_MS,
      }),
    ];
    expect(unconsumedM03FireTargetIds(receipts, snapshot)).toEqual([
      "target-a",
    ]);
    expect(
      evaluateEligibility(evalInput(snapshot, { verifiedGoldline: receipts }))
        .eligibleBeatIds
    ).toContain("M03");
  });

  it("2. RETURN Monday then ARM Tuesday on the same target does not qualify", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    expect(unconsumedM03FireTargetIds(receipts, snapshot)).toEqual([]);
    expect(
      evaluateEligibility(evalInput(snapshot, { verifiedGoldline: receipts }))
        .eligibleBeatIds
    ).not.toContain("M03");
  });

  it("3. ARM A then RETURN B does not qualify", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-b",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    expect(
      evaluateEligibility(evalInput(snapshot, { verifiedGoldline: receipts }))
        .eligibleBeatIds
    ).not.toContain("M03");
  });

  it("4. spoken_no then later RETURN without reopen does not qualify", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("spoken_no", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds(receipts, snapshot)).toEqual([]);
    expect(unconsumedM03FireTargetIds(receipts, snapshot)).toEqual([]);
    expect(
      evaluateEligibility(evalInput(snapshot, { verifiedGoldline: receipts }))
        .eligibleBeatIds
    ).not.toContain("M03");
  });

  it("5. spoken_no then later reopen then later RETURN may qualify", async () => {
    const { store, snapshot } = await seeded();
    const spokenNo = issueReceipt("spoken_no", {
      targetId: "target-a",
      receiptId: "receipt:no-a",
      occurredAtMs: MONDAY_MS,
    });
    const reopen = issueReceipt("contact_reopened_after_no", {
      targetId: "target-a",
      receiptId: "receipt:reopen-a",
      occurredAtMs: TUESDAY_MS,
    });
    const ret = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-a",
      receiptId: "receipt:return-a",
      occurredAtMs: WEDNESDAY_MS,
    });
    expect(derivedM03ArmedTargetIds([spokenNo], snapshot)).toEqual([]);
    expect(derivedM03ArmedTargetIds([spokenNo, reopen], snapshot)).toEqual([
      "target-a",
    ]);
    const eligibility = evalInput(snapshot, {
      verifiedGoldline: [ret, spokenNo, reopen],
    });
    expect(derivedM03ArmedTargetIds([ret, spokenNo, reopen], snapshot)).toEqual(
      ["target-a"]
    );
    expect(evaluateEligibility(eligibility).eligibleBeatIds).toContain("M03");
    const auth = issueEligibilityAuthorizations(
      evaluateEligibility(eligibility),
      eligibility
    ).find(item => item.beatId === BEAT_IDS.M03)!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization: auth,
      eligibility,
    });
    expect(after.ledger[0]?.idempotencyKey).toBe(
      m03OccurrenceIdempotencyKey("target-a", reopen.receiptId)
    );
  });

  it("6. reopen or RETURN before spoken_no cannot be reordered into a valid sequence", async () => {
    const { snapshot } = await seeded();
    const reopenFirst = [
      issueReceipt("contact_reopened_after_no", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("spoken_no", {
        targetId: "target-a",
        occurredAtMs: TUESDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        occurredAtMs: WEDNESDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds(reopenFirst, snapshot)).toEqual([]);
    expect(
      evaluateEligibility(
        evalInput(snapshot, { verifiedGoldline: reopenFirst })
      ).eligibleBeatIds
    ).not.toContain("M03");

    const returnThenReopenThenNo = [
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("contact_reopened_after_no", {
        targetId: "target-a",
        occurredAtMs: TUESDAY_MS,
      }),
      issueReceipt("spoken_no", {
        targetId: "target-a",
        occurredAtMs: WEDNESDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds(returnThenReopenThenNo, snapshot)).toEqual(
      []
    );
    expect(
      evaluateEligibility(
        evalInput(snapshot, { verifiedGoldline: returnThenReopenThenNo })
      ).eligibleBeatIds
    ).not.toContain("M03");
  });

  it("7. replaying the same qualifying evidence does not fire M03 twice", async () => {
    const { store, snapshot } = await seeded();
    const receipts = [
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        receiptId: "receipt:silence-same",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        receiptId: "receipt:return-same",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    const eligibility = evalInput(snapshot, { verifiedGoldline: receipts });
    const auth = issueEligibilityAuthorizations(
      evaluateEligibility(eligibility),
      eligibility
    ).find(item => item.beatId === BEAT_IDS.M03)!;
    await commitAuthorizedBeat({
      store,
      scope,
      authorization: auth,
      eligibility,
    });
    const after = (await store.load(scope))!;
    const replay = evaluateEligibility(
      evalInput(after, { verifiedGoldline: receipts })
    );
    expect(replay.eligibleBeatIds).not.toContain("M03");
    expect(after.ledger.filter(entry => entry.beatId === "M03")).toHaveLength(
      1
    );
  });

  it("8. a later distinct eligible cycle on the same target remains representable", async () => {
    const { store, snapshot } = await seeded();
    const first = [
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        receiptId: "receipt:silence-1",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        receiptId: "receipt:return-1",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    const firstInput = evalInput(snapshot, { verifiedGoldline: first });
    const firstAuth = issueEligibilityAuthorizations(
      evaluateEligibility(firstInput),
      firstInput
    ).find(item => item.beatId === BEAT_IDS.M03)!;
    const afterFirst = await commitAuthorizedBeat({
      store,
      scope,
      authorization: firstAuth,
      eligibility: firstInput,
    });
    const second = [
      ...first,
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        receiptId: "receipt:silence-2",
        occurredAtMs: WEDNESDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        receiptId: "receipt:return-2",
        occurredAtMs: THURSDAY_MS,
      }),
    ];
    const secondInput = evalInput(afterFirst, { verifiedGoldline: second });
    expect(evaluateEligibility(secondInput).eligibleBeatIds).toContain("M03");
  });

  it("9. new user remains not armed / NO_ELIGIBLE", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.outcome).toBe("NO_ELIGIBLE");
    expect(derivedM03ArmedTargetIds([], snapshot)).toEqual([]);
    expect(snapshot.narrativeState.values.m03).toBeUndefined();
  });

  it("10. C-06, C-08, M04, disclosure, OPEN, and registry authority remain intact", async () => {
    expect(getBeat("C-06").defaultSurface).toBe(false);
    expect(getBeat("C-08").defaultSurface).toBe(true);
    expect(getBeat("M04").eligibilityDefinition).toBe("COMPLETE");
    expect(isKnownBeatId("CL-CORE")).toBe(false);
    expect(originFalseWithoutChemistIsOpen()).toBe(true);
    const { store, snapshot } = await seeded();
    const fake: AuthoredBeat = {
      ...AUTHORED_BEAT_DEFAULTS,
      id: asNarrativeBeatId("FAKE-M03-AUTH"),
      title: "fake",
      canonStatus: "LOCKED",
      authoredSourceRef: "not-canon",
      eligibilityDefinition: "COMPLETE",
      defaultSurface: true,
      playerVisibility: true,
    };
    const fakeInput = evalInput(snapshot, { registry: [fake], graph: [] });
    const auth = issueEligibilityAuthorizations(
      evaluateEligibility(fakeInput),
      fakeInput
    )[0]!;
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: auth,
        eligibility: fakeInput,
      })
    ).rejects.toThrow();
  });
});

describe("Narrator OS D.5 — C-08 may execute when eligible; C-06 may not", () => {
  it("does not withhold C-08 like C-06", async () => {
    const { store, snapshot } = await seeded();
    const ready = withNarrativeFacts(snapshot, {
      [AUTHORED_NARRATIVE_FACTS.reservedCorePreserved]: "true",
      [AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand]: "true",
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "DOES_NOT_SUPPORT",
    });
    await store.replaceNarrativeState(scope, ready.narrativeState);
    const live = (await store.load(scope))!;
    const input = evalInput(live);
    const result = evaluateEligibility(input);
    expect(result.outcome).toBe("ELIGIBLE");
    expect(result.eligibleBeatIds).toContain("C-08");
    expect(result.withheldBeatIds).toContain("C-06");
    const auths = issueEligibilityAuthorizations(result, input);
    expect(auths.some(auth => auth.beatId === "C-08")).toBe(true);
    expect(auths.some(auth => auth.beatId === "C-06")).toBe(false);
    const c08Auth = auths.find(auth => auth.beatId === "C-08")!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization: c08Auth,
      eligibility: input,
    });
    expect(after.ledger.some(entry => entry.beatId === "C-08")).toBe(true);
    expect(after.ledger.some(entry => entry.beatId === "C-06")).toBe(false);
  });

  it("does not infer an M03 target from a free-form evidence string", async () => {
    const { snapshot } = await seeded();
    const noTarget = issueReceipt("spoken_no");
    const returnNoTarget = issueReceipt("legitimate_second_site_visit");
    expect(derivedM03ArmedTargetIds([noTarget], snapshot)).toEqual([]);
    const result = evaluateEligibility(
      evalInput(snapshot, {
        verifiedGoldline: [noTarget, returnNoTarget],
      })
    );
    expect(result.eligibleBeatIds).not.toContain("M03");
  });
});

describe("Narrator OS D.5 — package authority without Markdown runtime parse", () => {
  it("preserves v1.2-proposed package at repo root", () => {
    const path = resolve(process.cwd(), "GOLDLINE_NARRATOR_CANON_PACKAGE.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Version: 1.2-proposed");
    expect(text).toContain("CANON PACKAGE (PROPOSED)");
    expect(text).toContain("does not license a retry RETURN");
    expect(text).toContain("contact_reopened_after_no");
  });

  it("does not parse Markdown or writers-room files at runtime", () => {
    for (const file of PRODUCTION_FILES) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/readFileSync|createReadStream/);
      expect(src).not.toMatch(/GOLDLINE_NARRATOR_BEAT_CANDIDATES/);
      expect(src).not.toMatch(/GOLDLINE_ACT_I_PLAYABLE_BEATS/);
      expect(src).not.toMatch(/N-M03-ARM/);
      expect(src).not.toMatch(/M04-MISS/);
      expect(src).not.toMatch(/from ['"]marked['"]|markdown-it|remark-parse/);
    }
    expect(
      existsSync(resolve(process.cwd(), "GOLDLINE_NARRATOR_BEAT_CANDIDATES.md"))
    ).toBe(false);
    expect(
      existsSync(resolve(process.cwd(), "GOLDLINE_ACT_I_PLAYABLE_BEATS.md"))
    ).toBe(false);
  });

  it("does not contradict locked GOLDLINE_CANON.md Act I / cove / disclosure rules", () => {
    const canon = readFileSync(
      resolve(process.cwd(), "GOLDLINE_CANON.md"),
      "utf8"
    );
    expect(canon).toMatch(/Never manufacture a rejection/);
    expect(canon).toMatch(
      /A spoken no is terminal unless that person later reopens contact/
    );
    expect(canon).toMatch(/Act I does not complete on a miss/);
    expect(canon).toMatch(/Core facts from start/);
    expect(getBeat("M03").eligibilityConditions).toContainEqual({
      kind: "never_manufacture",
      claim: "rejection",
    });
    expect(getBeat("M03").prerequisites).toContainEqual({
      kind: "verified_goldline_same_target",
      priorOutcomeIds: [
        "silence_eligible_for_retry",
        "no_show",
        "contact_reopened_after_no",
      ],
      subsequentOutcomeIds: [
        "legitimate_second_site_visit",
        "timed_retry_after_silence",
        "reinspect_previously_deployed_item",
      ],
    });
    expect(getBeat("M04").stateMutations).toContainEqual({
      key: "act_i",
      value: "complete",
    });
    expect(
      getBeat("K-COVE-ORIGIN").prerequisites.some(
        prereq => prereq.kind === "hard_beat" && prereq.beatId === BEAT_IDS.C08
      )
    ).toBe(false);
  });
});

describe("Narrator OS D.5 — derivedM03ArmedTargetIds is legally armed", () => {
  it("does not arm from array order, receiptId lexical order, or free-form sourceReference", async () => {
    const { snapshot } = await seeded();
    const spokenNoLaterTime = issueReceipt("spoken_no", {
      targetId: "target-a",
      receiptId: "a-lexical-first",
      occurredAtMs: TUESDAY_MS,
    });
    const reopenEarlierTime = issueReceipt("contact_reopened_after_no", {
      targetId: "target-a",
      receiptId: "z-lexical-last",
      occurredAtMs: MONDAY_MS,
    });
    const reversedCallerOrder = [spokenNoLaterTime, reopenEarlierTime];
    expect(derivedM03ArmedTargetIds(reversedCallerOrder, snapshot)).toEqual([]);

    const freeForm = issueVerifiedGoldlineReceiptForTests({
      receiptId: "receipt:free-form-no",
      tenantId: scope.tenantId,
      operatorUserId: scope.operatorUserId,
      outcomeId: "spoken_no",
      evidenceClass: "operator_attested",
      evidenceRef: {
        sourceType: "field_visit",
        sourceReference: "target-a spoke no then reopened",
        classification: "operator_attested",
      },
      targetRef: { kind: "goldline_target", id: "target-a" },
      occurredAtMs: MONDAY_MS,
    });
    expect(derivedM03ArmedTargetIds([freeForm], snapshot)).toEqual([]);
  });

  it("arms only when spoken_no is followed later by trusted same-target reopen", async () => {
    const { snapshot } = await seeded();
    const spokenNo = issueReceipt("spoken_no", {
      targetId: "target-a",
      receiptId: "z-no-later-lexical",
      occurredAtMs: MONDAY_MS,
    });
    const reopen = issueReceipt("contact_reopened_after_no", {
      targetId: "target-a",
      receiptId: "a-reopen-earlier-lexical",
      occurredAtMs: TUESDAY_MS,
    });
    expect(derivedM03ArmedTargetIds([reopen, spokenNo], snapshot)).toEqual([
      "target-a",
    ]);
    expect(
      derivedM03ArmedTargetIds(
        [
          issueReceipt("spoken_no", {
            targetId: "target-a",
            occurredAtMs: MONDAY_MS,
          }),
          issueReceipt("contact_reopened_after_no", {
            targetId: "target-b",
            occurredAtMs: TUESDAY_MS,
          }),
        ],
        snapshot
      )
    ).toEqual([]);
  });
});

describe("Narrator OS D.5 — M03 live unconsumed readiness", () => {
  async function fireM03(
    store: ReturnType<typeof createInMemoryNarratorStore>,
    snapshot: NarratorSnapshot,
    receipts: readonly VerifiedGoldlineReceipt[]
  ): Promise<NarratorSnapshot> {
    const eligibility = evalInput(snapshot, { verifiedGoldline: receipts });
    const result = evaluateEligibility(eligibility);
    expect(result.eligibleBeatIds).toContain("M03");
    const auth = issueEligibilityAuthorizations(result, eligibility).find(
      item => item.beatId === BEAT_IDS.M03
    )!;
    return commitAuthorizedBeat({
      store,
      scope,
      authorization: auth,
      eligibility,
    });
  }

  it("1. silence → RETURN → M03 fire → old cycle is not ARMED", async () => {
    const { store, snapshot } = await seeded();
    const silence = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-a",
      receiptId: "receipt:silence-live-1",
      occurredAtMs: MONDAY_MS,
    });
    const ret = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-a",
      receiptId: "receipt:return-live-1",
      occurredAtMs: TUESDAY_MS,
    });
    const receipts = [ret, silence];
    expect(derivedM03ArmedTargetIds(receipts, snapshot)).toEqual(["target-a"]);
    const after = await fireM03(store, snapshot, receipts);
    expect(derivedM03ArmedTargetIds(receipts, after)).toEqual([]);
    expect(unconsumedM03FireTargetIds(receipts, after)).toEqual([]);
  });

  it("2. spoken no → reopen → RETURN → M03 fire → old reopen is not ARMED", async () => {
    const { store, snapshot } = await seeded();
    const spokenNo = issueReceipt("spoken_no", {
      targetId: "target-a",
      receiptId: "receipt:no-live-2",
      occurredAtMs: MONDAY_MS,
    });
    const reopen = issueReceipt("contact_reopened_after_no", {
      targetId: "target-a",
      receiptId: "receipt:reopen-live-2",
      occurredAtMs: TUESDAY_MS,
    });
    const ret = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-a",
      receiptId: "receipt:return-live-2",
      occurredAtMs: WEDNESDAY_MS,
    });
    const receipts = [ret, spokenNo, reopen];
    expect(derivedM03ArmedTargetIds(receipts, snapshot)).toEqual(["target-a"]);
    const after = await fireM03(store, snapshot, receipts);
    expect(derivedM03ArmedTargetIds(receipts, after)).toEqual([]);
    expect(unconsumedM03FireTargetIds(receipts, after)).toEqual([]);
  });

  it("3. after a consumed cycle, a later new legal cycle can ARMED again", async () => {
    const { store, snapshot } = await seeded();
    const silence1 = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-a",
      receiptId: "receipt:silence-live-3a",
      occurredAtMs: MONDAY_MS,
    });
    const return1 = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-a",
      receiptId: "receipt:return-live-3a",
      occurredAtMs: TUESDAY_MS,
    });
    const afterSilenceFire = await fireM03(store, snapshot, [
      return1,
      silence1,
    ]);
    expect(
      derivedM03ArmedTargetIds([return1, silence1], afterSilenceFire)
    ).toEqual([]);
    const silence2 = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-a",
      receiptId: "receipt:silence-live-3b",
      occurredAtMs: WEDNESDAY_MS,
    });
    expect(
      derivedM03ArmedTargetIds([return1, silence1, silence2], afterSilenceFire)
    ).toEqual(["target-a"]);

    const { store: storeB, snapshot: snapshotB } = await seeded();
    const spokenNo = issueReceipt("spoken_no", {
      targetId: "target-b",
      receiptId: "receipt:no-live-3",
      occurredAtMs: MONDAY_MS,
    });
    const reopen1 = issueReceipt("contact_reopened_after_no", {
      targetId: "target-b",
      receiptId: "receipt:reopen-live-3a",
      occurredAtMs: TUESDAY_MS,
    });
    const returnB = issueReceipt("legitimate_second_site_visit", {
      targetId: "target-b",
      receiptId: "receipt:return-live-3b",
      occurredAtMs: WEDNESDAY_MS,
    });
    const firstB = [returnB, spokenNo, reopen1];
    const afterReopenFire = await fireM03(storeB, snapshotB, firstB);
    expect(derivedM03ArmedTargetIds(firstB, afterReopenFire)).toEqual([]);
    const reopen2 = issueReceipt("contact_reopened_after_no", {
      targetId: "target-b",
      receiptId: "receipt:reopen-live-3b",
      occurredAtMs: THURSDAY_MS,
    });
    expect(
      derivedM03ArmedTargetIds([...firstB, reopen2], afterReopenFire)
    ).toEqual(["target-b"]);
  });

  it("4. silence → newer spoken no → RETURN does not qualify", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("spoken_no", {
        targetId: "target-a",
        occurredAtMs: TUESDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        occurredAtMs: WEDNESDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds(receipts, snapshot)).toEqual([]);
    expect(unconsumedM03FireTargetIds(receipts, snapshot)).toEqual([]);
    expect(
      evaluateEligibility(evalInput(snapshot, { verifiedGoldline: receipts }))
        .eligibleBeatIds
    ).not.toContain("M03");
  });

  it("5. no → reopen → newer no → RETURN does not qualify", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("spoken_no", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("contact_reopened_after_no", {
        targetId: "target-a",
        occurredAtMs: TUESDAY_MS,
      }),
      issueReceipt("spoken_no", {
        targetId: "target-a",
        receiptId: "receipt:spoken_no:target-a:later",
        occurredAtMs: WEDNESDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        occurredAtMs: THURSDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds(receipts, snapshot)).toEqual([]);
    expect(unconsumedM03FireTargetIds(receipts, snapshot)).toEqual([]);
    expect(
      evaluateEligibility(evalInput(snapshot, { verifiedGoldline: receipts }))
        .eligibleBeatIds
    ).not.toContain("M03");
  });

  it("6. no → reopen → newer no → newer reopen → RETURN may qualify", async () => {
    const { snapshot } = await seeded();
    const receipts = [
      issueReceipt("spoken_no", {
        targetId: "target-a",
        receiptId: "receipt:no-1",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("contact_reopened_after_no", {
        targetId: "target-a",
        receiptId: "receipt:reopen-1",
        occurredAtMs: TUESDAY_MS,
      }),
      issueReceipt("spoken_no", {
        targetId: "target-a",
        receiptId: "receipt:no-2",
        occurredAtMs: WEDNESDAY_MS,
      }),
      issueReceipt("contact_reopened_after_no", {
        targetId: "target-a",
        receiptId: "receipt:reopen-2",
        occurredAtMs: THURSDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        receiptId: "receipt:return-2",
        occurredAtMs: FRIDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds(receipts, snapshot)).toEqual(["target-a"]);
    expect(unconsumedM03FireTargetIds(receipts, snapshot)).toEqual([
      "target-a",
    ]);
    expect(
      evaluateEligibility(evalInput(snapshot, { verifiedGoldline: receipts }))
        .eligibleBeatIds
    ).toContain("M03");
  });

  it("7. a newer terminal no removes the target from derived ARMED state", async () => {
    const { snapshot } = await seeded();
    const silenceThenNo = [
      issueReceipt("silence_eligible_for_retry", {
        targetId: "target-a",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("spoken_no", {
        targetId: "target-a",
        occurredAtMs: TUESDAY_MS,
      }),
    ];
    expect(derivedM03ArmedTargetIds([silenceThenNo[0]!], snapshot)).toEqual([
      "target-a",
    ]);
    expect(derivedM03ArmedTargetIds(silenceThenNo, snapshot)).toEqual([]);

    const noReopenThenNo = [
      issueReceipt("spoken_no", {
        targetId: "target-b",
        receiptId: "receipt:no-b-1",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("contact_reopened_after_no", {
        targetId: "target-b",
        occurredAtMs: TUESDAY_MS,
      }),
      issueReceipt("spoken_no", {
        targetId: "target-b",
        receiptId: "receipt:no-b-2",
        occurredAtMs: WEDNESDAY_MS,
      }),
    ];
    expect(
      derivedM03ArmedTargetIds(noReopenThenNo.slice(0, 2), snapshot)
    ).toEqual(["target-b"]);
    expect(derivedM03ArmedTargetIds(noReopenThenNo, snapshot)).toEqual([]);
  });
});

describe("Narrator OS D.5 — permanently private Claire disclosures", () => {
  const privateIds = [
    "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE",
    "CL-PRIV-EX-LAST-EXCHANGE",
  ] as const;

  const maxProgress = {
    asked: true,
    fromStartSatisfied: true,
    progressSatisfied: true,
    highestTierReached: true,
    rapportUnlocked: true,
    verifiedBusinessProgress: true,
  };

  function assertNoInventedExchangeText(value: unknown): void {
    const serialized = JSON.stringify(value);
    expect(serialized).not.toMatch(/I (said|told|replied|whispered)/i);
    expect(serialized).not.toMatch(/last words/i);
    expect(serialized).not.toMatch(/goodbye,?\s*(dad|father|love)/i);
    expect(Object.prototype.hasOwnProperty.call(value as object, "text")).toBe(
      false
    );
    expect(
      Object.prototype.hasOwnProperty.call(value as object, "content")
    ).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(value as object, "body")).toBe(
      false
    );
    expect(
      Object.prototype.hasOwnProperty.call(value as object, "dialogue")
    ).toBe(false);
  }

  it("catalogs both permanently-private last-exchange policies", () => {
    expect([...PERMANENTLY_PRIVATE_CLAIRE_DISCLOSURE_POLICY_IDS]).toEqual([
      ...privateIds,
    ]);
    const listed = listClaireDisclosurePolicies();
    for (const id of privateIds) {
      const policy = getClaireDisclosurePolicy(id);
      expect(policy.permanentlyPrivate).toBe(true);
      expect(policy.canonStatus).toBe("LOCKED");
      expect(policy.fromStart).toBe(false);
      expect(policy.progressGated).toBe(false);
      expect(policy.askOnly).toBe(true);
      expect(policy.authoredSourceRef).toBe("GOLDLINE_CANON.md§6 disclosure");
      expect(listed.some(entry => entry.id === id)).toBe(true);
      expect(isKnownBeatId(id)).toBe(false);
      expect(AUTHORED_BEATS.some(beat => beat.id === id)).toBe(false);
      expect(
        AUTHORED_BEATS.some(beat =>
          beat.knowledgeMutations.some(mutation =>
            JSON.stringify(mutation).includes(id)
          )
        )
      ).toBe(false);
      assertNoInventedExchangeText(policy);
    }
    const father = getClaireDisclosurePolicy(
      "CL-PRIV-ADAPTED-FATHER-LAST-EXCHANGE"
    );
    const ex = getClaireDisclosurePolicy("CL-PRIV-EX-LAST-EXCHANGE");
    expect(father.governedScopeRef.toLowerCase()).toMatch(
      /adapted father last exchange/
    );
    expect(ex.governedScopeRef.toLowerCase()).toMatch(/ex last exchange/);
  });

  it("cannot convert permanently-private policies into ordinary disclosure eligibility", () => {
    for (const id of privateIds) {
      const policy = getClaireDisclosurePolicy(id);
      expect(disclosurePolicyMayBecomeOrdinarilyEligible(policy)).toBe(false);
      expect(
        disclosurePolicyMayBecomeOrdinarilyEligible(policy, maxProgress)
      ).toBe(false);
      const spoofed: ClaireDisclosurePolicy = {
        ...policy,
        fromStart: true,
        progressGated: true,
        askOnly: false,
      };
      expect(
        disclosurePolicyMayBecomeOrdinarilyEligible(spoofed, maxProgress)
      ).toBe(false);
    }
  });

  it("lookup of permanently-private policies causes zero mutation", async () => {
    const { snapshot } = await seeded();
    const before = structuredClone(snapshot);
    for (const id of privateIds) {
      getClaireDisclosurePolicy(id);
    }
    listClaireDisclosurePolicies();
    expect(snapshot.ledger).toEqual(before.ledger);
    expect(snapshot.knowledge).toEqual(before.knowledge);
    expect(snapshot.narrativeState).toEqual(before.narrativeState);
    expect(snapshot.worldTruth).toEqual(before.worldTruth);
  });

  it("does not invent last-exchange text in lived biography", () => {
    for (const fact of CLAIRE_LIVED_BIO_FACTS) {
      expect(fact.value ?? "").not.toMatch(/last exchange/i);
      assertNoInventedExchangeText(fact);
    }
    expect(
      CLAIRE_LIVED_BIO_FACTS.some(fact =>
        /father last exchange|ex last exchange/i.test(fact.factId)
      )
    ).toBe(false);
  });
});
