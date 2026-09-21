import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUTHORED_NARRATIVE_FACTS } from "./authoredNarrativeFacts";
import {
  AUTHORED_BEAT_DEFAULTS,
  asNarrativeBeatId,
  type AuthoredBeat,
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
  M03_OCCURRENCE_PREFIX,
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
  getClaireDisclosurePolicy,
  listClaireDisclosurePolicies,
} from "./disclosurePolicy";
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
  });
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

  it("3. trusted no/silence creates per-target M03 readiness without firing M03", async () => {
    const { store, snapshot } = await seeded();
    const noA = issueReceipt("spoken_no", { targetId: "target-a" });
    const silenceS = issueReceipt("silence_eligible_for_retry", {
      targetId: "target-s",
    });
    expect(derivedM03ArmedTargetIds([noA], snapshot)).toEqual(["target-a"]);
    expect(derivedM03ArmedTargetIds([silenceS], snapshot)).toEqual([
      "target-s",
    ]);
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
      issueReceipt("spoken_no", { targetId: "target-a" }),
      issueReceipt("legitimate_second_site_visit", { targetId: "target-b" }),
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
    const receipts = [
      issueReceipt("spoken_no", { targetId: "target-a" }),
      issueReceipt("legitimate_second_site_visit", { targetId: "target-a" }),
    ];
    const eligibility = evalInput(snapshot, { verifiedGoldline: receipts });
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
      `${M03_OCCURRENCE_PREFIX}target-a`
    );
    expect(after.narrativeState.values.m03).not.toBe("ARMED");
  });

  it("6. M03 recurrence cannot be created by caller-minted occurrence identity", async () => {
    const { store, snapshot } = await seeded();
    const firstPair = [
      issueReceipt("spoken_no", {
        targetId: "target-a",
        receiptId: "receipt:no-a-1",
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        receiptId: "receipt:return-a-1",
      }),
    ];
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

    const remintedSameTarget = [
      issueReceipt("spoken_no", {
        targetId: "target-a",
        receiptId: "receipt:no-a-2",
      }),
      issueReceipt("legitimate_second_site_visit", {
        targetId: "target-a",
        receiptId: "receipt:return-a-2",
      }),
    ];
    const replayInput = evalInput(after, {
      verifiedGoldline: remintedSameTarget,
    });
    const replay = evaluateEligibility(replayInput);
    expect(replay.eligibleBeatIds).not.toContain("M03");
    expect(
      issueEligibilityAuthorizations(replay, replayInput).find(
        item => item.beatId === BEAT_IDS.M03
      )
    ).toBeUndefined();

    const newTarget = [
      ...remintedSameTarget,
      issueReceipt("spoken_no", {
        targetId: "target-b",
        receiptId: "receipt:no-b",
      }),
      issueReceipt("timed_retry_after_silence", {
        targetId: "target-b",
        receiptId: "receipt:return-b",
      }),
    ];
    const bInput = evalInput(after, { verifiedGoldline: newTarget });
    const bResult = evaluateEligibility(bInput);
    expect(bResult.eligibleBeatIds).toContain("M03");
    const bAuth = issueEligibilityAuthorizations(bResult, bInput).find(
      item => item.beatId === BEAT_IDS.M03
    )!;
    const afterB = await commitAuthorizedBeat({
      store,
      scope,
      authorization: bAuth,
      eligibility: bInput,
    });
    const fired = afterB.ledger.filter(
      entry => entry.kind === "FIRED_AUTHORED_BEAT" && entry.beatId === "M03"
    );
    expect(fired).toHaveLength(2);
    expect(fired.map(entry => entry.idempotencyKey).sort()).toEqual([
      `${M03_OCCURRENCE_PREFIX}target-a`,
      `${M03_OCCURRENCE_PREFIX}target-b`,
    ]);
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
  });

  it("20. disclosure lookup has zero mutation", async () => {
    const { snapshot } = await seeded();
    const before = structuredClone(snapshot);
    const policy = getClaireDisclosurePolicy("CL-CORE");
    expect(policy.askOnly).toBe(true);
    expect(policy.fromStart).toBe(true);
    const listed = listClaireDisclosurePolicies();
    expect(listed).toHaveLength(5);
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
    expect(canon).toMatch(/Act I does not complete on a miss/);
    expect(canon).toMatch(/Core facts from start/);
    expect(getBeat("M03").eligibilityConditions).toContainEqual({
      kind: "never_manufacture",
      claim: "rejection",
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
