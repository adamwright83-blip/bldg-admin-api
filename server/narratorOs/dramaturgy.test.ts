import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AUTHORED_NARRATIVE_FACTS } from "./authoredNarrativeFacts";
import {
  asNarrativeBeatId,
  type NarrativeBeatId,
  type NarrativeEligibilityResult,
} from "../../shared/narratorOs/contracts";
import {
  AUTHORED_DRAMATURGY_TIE_BREAKS,
  decideDramaturgy,
  type AuthoredDramaturgyTieBreak,
  type DramaturgyInput,
} from "./dramaturgy";
import { decideDramaturgyWithRulesForTests } from "./dramaturgy.testSupport";
import {
  AUTHORED_DRAMATURGY_TIE_BREAKS as indexTieBreaks,
  decideDramaturgy as indexDecideDramaturgy,
} from "./index";
import {
  evaluateProductionEligibility,
  isEligibilityAuthorization,
  issueEligibilityAuthorizations,
  type EligibilityInput,
} from "./eligibility";
import { commitAuthorizedBeat, IneligibleBeatCommitError } from "./ledger";
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
import { issueVerifiedGoldlineReceiptForTests } from "./verifiedGoldlineReceipt.testSupport";
import type { VerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";

const scope = { tenantId: "t-f", operatorUserId: "op-f" };
const MONDAY_MS = Date.parse("2026-09-14T12:00:00Z");
const TUESDAY_MS = Date.parse("2026-09-15T12:00:00Z");

const SURFACEABLE_CAPABLE = ["C-08", "M01", "M03", "M04"] as const;

type ProductionDramaturgyParameter = Parameters<
  typeof indexDecideDramaturgy
>[0];
type _ProductionInputIsEligibilityOnly =
  Exclude<keyof ProductionDramaturgyParameter, "eligibility"> extends never
    ? true
    : never;
const productionInputIsEligibilityOnly: _ProductionInputIsEligibilityOnly = true;
void productionInputIsEligibilityOnly;

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
    occurredAtMs?: number;
  }
): VerifiedGoldlineReceipt {
  return issueVerifiedGoldlineReceiptForTests({
    receiptId: extra?.receiptId ?? `receipt:${outcomeId}`,
    tenantId: scope.tenantId,
    operatorUserId: scope.operatorUserId,
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

function withNarrativeFacts(
  snapshot: NarratorSnapshot,
  values: Record<string, string>
): NarratorSnapshot {
  return {
    ...snapshot,
    narrativeState: {
      ...snapshot.narrativeState,
      values: { ...snapshot.narrativeState.values, ...values },
    },
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

function evidenceFor(ids: readonly string[]): {
  values: Record<string, string>;
  receipts: VerifiedGoldlineReceipt[];
} {
  const values: Record<string, string> = {};
  const receipts: VerifiedGoldlineReceipt[] = [];
  if (ids.includes("C-08")) {
    values[AUTHORED_NARRATIVE_FACTS.reservedCorePreserved] = "true";
    values[AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand] = "true";
  }
  if (ids.includes("M01")) {
    receipts.push(
      issueReceipt("physical_first_visit", { receiptId: "m01-visit" })
    );
  }
  if (ids.includes("M03")) {
    receipts.push(
      issueReceipt("silence_eligible_for_retry", {
        receiptId: "m03-arm",
        targetId: "target-f",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        receiptId: "m03-return",
        targetId: "target-f",
        occurredAtMs: TUESDAY_MS,
      })
    );
  }
  if (ids.includes("M04")) {
    receipts.push(
      issueReceipt("kept_promised_send_visit_or_call", {
        receiptId: "m04-keep",
      })
    );
  }
  return { values, receipts };
}

function productionResult(
  snapshot: NarratorSnapshot,
  ids: readonly string[],
  extraValues: Record<string, string> = {},
  mode: EligibilityInput["mode"] = "interactive"
): NarrativeEligibilityResult {
  const evidence = evidenceFor(ids);
  const ready = withNarrativeFacts(snapshot, {
    ...evidence.values,
    ...extraValues,
  });
  return evaluateProductionEligibility(
    evalInput(ready, {
      verifiedGoldline: evidence.receipts,
      mode,
    })
  );
}

function inRegistryOrder(ids: readonly string[]): string[] {
  return AUTHORED_BEATS.map(beat => beat.id as string).filter(id =>
    ids.includes(id)
  );
}

function subsetsAtLeastTwo(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  const n = ids.length;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    const subset: string[] = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) subset.push(ids[i]!);
    }
    if (subset.length >= 2) out.push(subset);
  }
  return out;
}

function fabricated(
  eligible: readonly string[],
  outcome: NarrativeEligibilityResult["outcome"] = "ELIGIBLE",
  withheld: readonly string[] = []
): NarrativeEligibilityResult {
  return {
    outcome,
    eligibleBeatIds: eligible.map(id => asNarrativeBeatId(id)),
    withheldBeatIds: withheld.map(id => asNarrativeBeatId(id)),
    audit: [],
  };
}

describe("Narrator OS slice F — deterministic dramaturgy", () => {
  it("1. zero eligible beats is deterministic silence", async () => {
    const { snapshot } = await seeded();
    const result = evaluateProductionEligibility(evalInput(snapshot));
    expect(result.outcome).toBe("NO_ELIGIBLE");
    const decision = decideDramaturgy({ eligibility: result });
    expect(decision.outcome).toBe("SILENCE_NO_ELIGIBLE");
    expect(decision.selectedBeatId).toBeNull();
    expect(decision.reasonCode).toBe("no_surfaceable_eligible_beat");
    expect(decision.candidateBeatIds).toEqual([]);
    expect(decision.surfaceableBeatIds).toEqual([]);
    expect(decision.authoredTieBreakRequired).toBe(false);
    expect(decision.authoredTieBreakExisted).toBe(false);
  });

  it("2. exactly one surfaceable beat is selected", async () => {
    const { snapshot } = await seeded();
    for (const id of SURFACEABLE_CAPABLE) {
      const result = productionResult(snapshot, [id]);
      expect(result.outcome).toBe("ELIGIBLE");
      expect(result.eligibleBeatIds).toEqual([id]);
      const decision = decideDramaturgy({ eligibility: result });
      expect(decision.outcome).toBe("SELECT");
      expect(decision.selectedBeatId).toBe(id);
      expect(decision.reasonCode).toBe("single_surfaceable_eligible_beat");
      expect(decision.authoredTieBreakRequired).toBe(false);
    }
  });

  it("3. withheld-only result selects nothing", async () => {
    const { snapshot } = await seeded();
    const result = productionResult(snapshot, [], {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "DOES_NOT_SUPPORT",
    });
    expect(result.outcome).toBe("ELIGIBLE_WITHHELD");
    expect(result.withheldBeatIds).toEqual([BEAT_IDS.C06]);
    const decision = decideDramaturgy({ eligibility: result });
    expect(decision.outcome).toBe("SILENCE_WITHHELD");
    expect(decision.selectedBeatId).toBeNull();
    expect(decision.reasonCode).toBe("only_withheld_candidates");
    expect(decision.withheldBeatIds).toEqual([BEAT_IDS.C06]);
    expect(decision.surfaceableBeatIds).toEqual([]);
    expect(decision.candidateBeatIds).toEqual([BEAT_IDS.C06]);
  });

  it("4. ELIGIBLE_WITHHELD cannot be promoted", async () => {
    const { store, snapshot } = await seeded();
    const withheld = productionResult(snapshot, [], {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "INSUFFICIENT",
    });
    const stuffed: NarrativeEligibilityResult = {
      ...withheld,
      eligibleBeatIds: [BEAT_IDS.C06],
    };
    const decision = decideDramaturgy({ eligibility: stuffed });
    expect(stuffed.outcome).toBe("ELIGIBLE_WITHHELD");
    expect(decision.outcome).toBe("SILENCE_WITHHELD");
    expect(decision.selectedBeatId).toBeNull();
    expect(decision.refusedPromotionBeatIds).toEqual([BEAT_IDS.C06]);
    expect(decision.surfaceableBeatIds).toEqual([]);
    expect(isEligibilityAuthorization(decision)).toBe(false);

    const rewritten = fabricated(["C-06"]);
    const echoed = decideDramaturgy({ eligibility: rewritten });
    expect(echoed.outcome).toBe("SELECT");
    expect(echoed.selectedBeatId).toBe("C-06");
    const input = evalInput(snapshot);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: echoed as never,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    const branded = issueEligibilityAuthorizations(rewritten, input);
    expect(branded).toHaveLength(1);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: branded[0]!,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    expect((await store.load(scope))?.ledger).toEqual([]);
    expect(getBeat("C-06").defaultSurface).toBe(false);
  });

  it("5. two eligible beats with no authored tie-break stay unresolved", async () => {
    const { snapshot } = await seeded();
    const result = productionResult(snapshot, ["M01", "M04"]);
    expect(result.eligibleBeatIds).toEqual(["M01", "M04"]);
    const decision = indexDecideDramaturgy({ eligibility: result });
    expect(indexTieBreaks).toEqual([]);
    expect(AUTHORED_DRAMATURGY_TIE_BREAKS).toEqual([]);
    expect(decision.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(decision.selectedBeatId).toBeNull();
    expect(decision.reasonCode).toBe(
      "multiple_surfaceable_no_authored_tie_break"
    );
    expect(decision.authoredTieBreakRequired).toBe(true);
    expect(decision.authoredTieBreakExisted).toBe(false);
    expect(decision.authoredTieBreakRuleId).toBeNull();
    expect(decision.surfaceableBeatIds).toEqual(["M01", "M04"]);
  });

  it("6. candidate array order is not dramaturgy priority", async () => {
    const { snapshot } = await seeded();
    const result = productionResult(snapshot, ["M01", "M03", "M04"]);
    const forward = decideDramaturgy({ eligibility: result });
    const reversed = decideDramaturgy({
      eligibility: {
        ...result,
        eligibleBeatIds: [...result.eligibleBeatIds].reverse(),
      },
    });
    expect(forward.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(reversed.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(forward.selectedBeatId).toBeNull();
    expect(reversed.selectedBeatId).toBeNull();
    expect(reversed.surfaceableBeatIds[0]).toBe("M04");
    expect(reversed.selectedBeatId).not.toBe(reversed.surfaceableBeatIds[0]);
  });

  it("7. registry ordering is not dramaturgy priority", async () => {
    const { snapshot } = await seeded();
    const capable = AUTHORED_BEATS.filter(
      beat => beat.eligibilityDefinition === "COMPLETE" && beat.defaultSurface
    ).map(beat => beat.id);
    expect(capable).toEqual([...SURFACEABLE_CAPABLE]);
    const result = productionResult(snapshot, SURFACEABLE_CAPABLE);
    expect(result.eligibleBeatIds).toEqual([...SURFACEABLE_CAPABLE]);
    const decision = decideDramaturgy({ eligibility: result });
    expect(decision.selectedBeatId).toBeNull();
    expect(decision.selectedBeatId).not.toBe(capable[0]);
    expect(decision.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
  });

  it("8. repeated identical inputs return identical decisions", async () => {
    const { snapshot } = await seeded();
    const result = productionResult(snapshot, ["M03"]);
    const first = decideDramaturgy({ eligibility: result });
    const second = decideDramaturgy({ eligibility: result });
    expect(second).toEqual(first);
    expect(JSON.parse(JSON.stringify(second))).toEqual(
      JSON.parse(JSON.stringify(first))
    );
  });

  it("9. the same supplied state is not random or time-dependent", async () => {
    const { snapshot } = await seeded();
    const result = productionResult(snapshot, ["M01", "M04"]);
    vi.spyOn(Date, "now").mockReturnValue(1);
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const early = decideDramaturgy({ eligibility: result });
    vi.spyOn(Date, "now").mockReturnValue(9_999_999_999_999);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const late = decideDramaturgy({ eligibility: result });
    vi.restoreAllMocks();
    expect(late).toEqual(early);
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/dramaturgy.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/Math\.random|Date\.now|new Date\(/);
  });

  it("10. a dramaturgy decision is not execution authorization", async () => {
    const { store, snapshot } = await seeded();
    const result = productionResult(snapshot, ["M04"]);
    const decision = decideDramaturgy({ eligibility: result });
    expect(decision.outcome).toBe("SELECT");
    expect(decision.selectedBeatId).toBe("M04");
    expect(isEligibilityAuthorization(decision)).toBe(false);
    expect(Object.getOwnPropertySymbols(decision)).toEqual([]);
    expect(decision).not.toHaveProperty("beatId");
    const input = evalInput(withNarrativeFacts(snapshot, {}), {
      verifiedGoldline: evidenceFor(["M04"]).receipts,
    });
    expect(issueEligibilityAuthorizations(decision as never, input)).toEqual(
      []
    );
    const before = await store.load(scope);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: decision as never,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    expect(await store.load(scope)).toEqual(before);
  });

  it("11. a fabricated eligibility result cannot execute an OPEN beat", async () => {
    const { store, snapshot } = await seeded();
    expect(AUTHORED_BEATS.some(beat => beat.canonStatus === "OPEN")).toBe(
      false
    );
    const openResult = fabricated(["OPEN-UNAUTHORED"]);
    const decision = decideDramaturgy({ eligibility: openResult });
    expect(decision.selectedBeatId).toBe("OPEN-UNAUTHORED");
    expect(isEligibilityAuthorization(decision)).toBe(false);
    const input = evalInput(snapshot);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: decision as never,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    const branded = issueEligibilityAuthorizations(openResult, input);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: branded[0]!,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(UnknownBeatLedgerError);
    const live = evaluateProductionEligibility(input);
    expect(live.eligibleBeatIds).not.toContain("OPEN-UNAUTHORED");
    expect(decideDramaturgy({ eligibility: live }).selectedBeatId).toBeNull();
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("12. an INCOMPLETE beat cannot gain execution authority", async () => {
    const { store, snapshot } = await seeded();
    expect(getBeat("M15").eligibilityDefinition).toBe("INCOMPLETE");
    expect(getBeat("K-COVE-ORIGIN").eligibilityDefinition).toBe("INCOMPLETE");
    expect(getBeat("M02").eligibilityDefinition).toBe("INCOMPLETE");
    const fake = fabricated(["M15"]);
    const decision = decideDramaturgy({ eligibility: fake });
    expect(decision.outcome).toBe("SELECT");
    const input = evalInput(snapshot, {
      verifiedGoldline: [
        issueReceipt("leave_real_packet_or_collateral", {
          receiptId: "m02-packet",
        }),
        ...evidenceFor(["M01"]).receipts,
      ],
    });
    const branded = issueEligibilityAuthorizations(fake, input);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: branded[0]!,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    const alongside = evaluateProductionEligibility(input);
    expect(alongside.eligibleBeatIds).toEqual(["M01"]);
    expect(alongside.eligibleBeatIds).not.toContain("M02");
    expect(alongside.eligibleBeatIds).not.toContain("M15");
    expect(decideDramaturgy({ eligibility: alongside }).selectedBeatId).toBe(
      "M01"
    );
    const coveReady = productionResult(snapshot, ["C-08"]);
    expect(coveReady.eligibleBeatIds).toEqual(["C-08"]);
    expect(coveReady.eligibleBeatIds).not.toContain("K-COVE-ORIGIN");
    expect(decideDramaturgy({ eligibility: coveReady }).selectedBeatId).toBe(
      "C-08"
    );
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("13. commit-time production recheck still authorizes a real beat", async () => {
    const { store, snapshot } = await seeded();
    const receipts = evidenceFor(["M04"]).receipts;
    const input = evalInput(snapshot, { verifiedGoldline: receipts });
    const result = evaluateProductionEligibility(input);
    const decision = decideDramaturgy({ eligibility: result });
    expect(decision.selectedBeatId).toBe("M04");
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: decision as never,
        eligibility: input,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    expect((await store.load(scope))?.ledger).toEqual([]);

    const ledgerSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/ledger.ts"),
      "utf8"
    );
    expect(ledgerSrc).toMatch(/evaluateProductionEligibility/);
    expect(ledgerSrc).not.toMatch(/dramaturg/);
    const auth = issueEligibilityAuthorizations(result, input).find(
      item => item.beatId === "M04"
    )!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization: auth,
      eligibility: input,
    });
    expect(after.ledger.map(entry => entry.beatId)).toEqual(["M04"]);
    expect(after.narrativeState.values.act_i).toBe("complete");
  });

  it("14. dramaturgy performs no Narrator store writes", async () => {
    const { store, snapshot } = await seeded();
    const before = structuredClone(await store.load(scope));
    const collisions = subsetsAtLeastTwo(SURFACEABLE_CAPABLE);
    for (const subset of collisions) {
      const result = productionResult(snapshot, subset);
      decideDramaturgy({ eligibility: result });
    }
    decideDramaturgy({
      eligibility: productionResult(snapshot, [], {
        [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]:
          "DOES_NOT_SUPPORT",
      }),
    });
    expect(await store.load(scope)).toEqual(before);
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/dramaturgy.ts"),
      "utf8"
    );
    expect(src).not.toMatch(
      /commitAuthorizedBeat|appendLedger|commitAtomic|replaceKnowledge|replaceNarrativeState|recordVerifiedGoldlineOutcome/
    );
    expect(src).not.toMatch(
      /from ["']\.\/(ledger|store|eligibility|registry|memoryStore|drizzleStore)/
    );
  });

  it("15. dramaturgy does not touch Goldline, Claire, Brain, or world writers", async () => {
    const { snapshot } = await seeded();
    const beforeTruth = snapshot.worldTruth;
    const beforeBio = snapshot.livedBio;
    const beforeKnowledge = snapshot.knowledge;
    const beforeState = snapshot.narrativeState;
    const result = productionResult(snapshot, ["M01", "C-08"]);
    decideDramaturgy({ eligibility: result });
    expect(snapshot.worldTruth).toBe(beforeTruth);
    expect(snapshot.livedBio).toBe(beforeBio);
    expect(snapshot.knowledge).toBe(beforeKnowledge);
    expect(snapshot.narrativeState).toBe(beforeState);
    expect(snapshot.ledger).toEqual([]);
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/dramaturgy.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/server\/claire|xai|openai|generateText|brain/);
    expect(src).not.toMatch(/worldTruth|livedBio|goldlineVerification/);
  });

  it("16. C-06 withheld behavior is unchanged", () => {
    const c06 = getBeat("C-06");
    expect(c06.eligibilityDefinition).toBe("COMPLETE");
    expect(c06.defaultSurface).toBe(false);
    expect(c06.mayFireOffscreen).toBe(false);
    expect(c06.playerVisibility).toBe(false);
    expect(c06.repeatability).toBe("repeatable");
    expect(offscreenCatalog()).toEqual([]);
    for (const id of ["M01", "M03", "M04", "C-08"] as const) {
      expect(getBeat(id).mayFireOffscreen).toBe(false);
    }
  });

  it("17. a single M03 or M04 result is that beat, with no invented companion", async () => {
    const { snapshot } = await seeded();
    const m03 = decideDramaturgy({
      eligibility: productionResult(snapshot, ["M03"]),
    });
    const m04 = decideDramaturgy({
      eligibility: productionResult(snapshot, ["M04"]),
    });
    expect(m03.selectedBeatId).toBe("M03");
    expect(m04.selectedBeatId).toBe("M04");
    expect(m03.candidateBeatIds).toEqual(["M03"]);
    expect(m04.candidateBeatIds).toEqual(["M04"]);
  });

  it("18. a new user with empty reality produces no invented scene", async () => {
    const { store, snapshot } = await seeded();
    expect(snapshot.ledger).toEqual([]);
    const result = evaluateProductionEligibility(evalInput(snapshot));
    const decision = decideDramaturgy({ eligibility: result });
    expect(decision.outcome).toBe("SILENCE_NO_ELIGIBLE");
    expect(decision.selectedBeatId).toBeNull();
    expect(decision.candidateBeatIds).toEqual([]);
    const offscreen = evaluateProductionEligibility(
      evalInput(snapshot, {
        mode: "offscreen",
        verifiedGoldline: evidenceFor(["M01"]).receipts,
      })
    );
    expect(offscreen.outcome).toBe("NO_ELIGIBLE");
    expect(decideDramaturgy({ eligibility: offscreen }).selectedBeatId).toBe(
      null
    );
    expect((await store.load(scope))?.ledger).toEqual([]);
    expect((await store.load(scope))?.worldTruth).toEqual(snapshot.worldTruth);
    expect((await store.load(scope))?.livedBio).toEqual(snapshot.livedBio);
  });

  it("records every simultaneous surfaceable collision and leaves it unresolved", async () => {
    const { snapshot } = await seeded();
    const collisions = subsetsAtLeastTwo([...SURFACEABLE_CAPABLE]);
    expect(collisions).toHaveLength(11);
    const discovered: string[][] = [];
    for (const subset of collisions) {
      const result = productionResult(snapshot, subset);
      const expected = inRegistryOrder(subset);
      expect(result.outcome).toBe("ELIGIBLE");
      expect([...result.eligibleBeatIds]).toEqual(expected);
      const decision = indexDecideDramaturgy({ eligibility: result });
      expect(decision.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
      expect(decision.selectedBeatId).toBeNull();
      expect(decision.authoredTieBreakExisted).toBe(false);
      expect(
        AUTHORED_DRAMATURGY_TIE_BREAKS.some(rule =>
          sameMembers(rule.surfaceableBeatIds, expected)
        )
      ).toBe(false);
      discovered.push(expected);
    }
    expect(discovered).toEqual([
      ["C-08", "M01"],
      ["C-08", "M03"],
      ["M01", "M03"],
      ["C-08", "M01", "M03"],
      ["C-08", "M04"],
      ["M01", "M04"],
      ["C-08", "M01", "M04"],
      ["M03", "M04"],
      ["C-08", "M03", "M04"],
      ["M01", "M03", "M04"],
      ["C-08", "M01", "M03", "M04"],
    ]);

    const withWithheld = productionResult(snapshot, ["M01", "M03"], {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "DOES_NOT_SUPPORT",
    });
    expect(withWithheld.withheldBeatIds).toEqual(["C-06"]);
    const ambiguous = indexDecideDramaturgy({ eligibility: withWithheld });
    expect(ambiguous.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(ambiguous.selectedBeatId).toBeNull();
    expect(ambiguous.withheldBeatIds).toEqual(["C-06"]);

    const onlyWithheldCompanion = productionResult(snapshot, ["M01"], {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "INSUFFICIENT",
    });
    const selected = indexDecideDramaturgy({
      eligibility: onlyWithheldCompanion,
    });
    expect(selected.outcome).toBe("SELECT");
    expect(selected.selectedBeatId).toBe("M01");
    expect(selected.withheldBeatIds).toEqual(["C-06"]);
  });

  it("applies an exact authored tie-break only through test support", () => {
    const m01 = asNarrativeBeatId("M01");
    const m04 = asNarrativeBeatId("M04");
    const rule: AuthoredDramaturgyTieBreak = {
      ruleId: "test-only-not-canon",
      surfaceableBeatIds: [m01, m04],
      selectBeatId: m04,
      authoredSourceRef: "dramaturgy.test.ts — not a canon rule",
    };
    expect(AUTHORED_DRAMATURGY_TIE_BREAKS).toEqual([]);
    const pair = decideDramaturgyWithRulesForTests({
      eligibility: fabricated(["M01", "M04"]),
      tieBreaks: [rule],
    });
    expect(pair.outcome).toBe("SELECT");
    expect(pair.selectedBeatId).toBe("M04");
    expect(pair.reasonCode).toBe("authored_tie_break_applied");
    expect(pair.authoredTieBreakRuleId).toBe("test-only-not-canon");

    const reversed = decideDramaturgyWithRulesForTests({
      eligibility: fabricated(["M04", "M01"]),
      tieBreaks: [rule],
    });
    expect(reversed.selectedBeatId).toBe("M04");

    const superset = decideDramaturgyWithRulesForTests({
      eligibility: fabricated(["M01", "M03", "M04"]),
      tieBreaks: [rule],
    });
    expect(superset.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(superset.selectedBeatId).toBeNull();
    expect(superset.authoredTieBreakExisted).toBe(false);

    const singleton = decideDramaturgyWithRulesForTests({
      eligibility: fabricated(["M04"]),
      tieBreaks: [rule],
    });
    expect(singleton.reasonCode).toBe("single_surfaceable_eligible_beat");
    expect(singleton.authoredTieBreakRequired).toBe(false);

    const disagree = decideDramaturgyWithRulesForTests({
      eligibility: fabricated(["M01", "M04"]),
      tieBreaks: [
        rule,
        {
          ruleId: "test-only-other",
          surfaceableBeatIds: [m04, m01],
          selectBeatId: m01,
          authoredSourceRef: "dramaturgy.test.ts — not a canon rule",
        },
      ],
    });
    expect(disagree.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(disagree.selectedBeatId).toBeNull();
    expect(disagree.reasonCode).toBe("authored_tie_breaks_disagree");
    expect(disagree.authoredTieBreakExisted).toBe(true);
  });

  it("production surface ignores injected tie-breaks and stays ambiguous", async () => {
    const m01 = asNarrativeBeatId("M01");
    const m04 = asNarrativeBeatId("M04");
    const rule: AuthoredDramaturgyTieBreak = {
      ruleId: "injected-not-canon",
      surfaceableBeatIds: [m01, m04],
      selectBeatId: m04,
      authoredSourceRef: "caller-injected",
    };
    const eligibility = fabricated(["M01", "M04"]);
    const injected = {
      eligibility,
      tieBreaks: [rule],
      priority: ["M04", "M01"],
      authoredSourceRef: "caller-injected",
    };
    const fromModule = decideDramaturgy(injected as DramaturgyInput);
    const fromIndex = indexDecideDramaturgy(injected as DramaturgyInput);
    expect(fromModule.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(fromModule.selectedBeatId).toBeNull();
    expect(fromModule.reasonCode).toBe(
      "multiple_surfaceable_no_authored_tie_break"
    );
    expect(fromIndex).toEqual(fromModule);
    expect(indexTieBreaks).toEqual([]);
    expect(() => {
      (indexTieBreaks as AuthoredDramaturgyTieBreak[]).push(rule);
    }).toThrow();

    const narratorIndex = await import("./index");
    expect("decideDramaturgyWithRulesForTests" in narratorIndex).toBe(false);
    expect("decideDramaturgyWithCatalog" in narratorIndex).toBe(false);
    expect("decideDramaturgy" in narratorIndex).toBe(true);
    const indexSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/index.ts"),
      "utf8"
    );
    expect(indexSrc).not.toMatch(/dramaturgy\.testSupport/);
    expect(indexSrc).not.toMatch(/dramaturgySelect/);
    expect(indexSrc).not.toMatch(/decideDramaturgyWithRulesForTests/);
    expect(indexSrc).not.toMatch(/decideDramaturgyWithCatalog/);
    expect(indexSrc).not.toMatch(/tieBreaks/);
    const productionSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/dramaturgy.ts"),
      "utf8"
    );
    expect(productionSrc).not.toMatch(/tieBreaks/);
    expect(productionSrc).toMatch(/AUTHORED_DRAMATURGY_TIE_BREAKS/);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VITEST", "");
    try {
      expect(() =>
        decideDramaturgyWithRulesForTests({
          eligibility,
          tieBreaks: [rule],
        })
      ).toThrow(/not available outside tests/);
    } finally {
      vi.unstubAllEnvs();
    }
    expect(indexDecideDramaturgy({ eligibility }).outcome).toBe(
      "AMBIGUOUS_REQUIRES_AUTHORED_RULE"
    );
  });

  it("duplicate copies of one beat are still one selection", () => {
    const decision = decideDramaturgy({
      eligibility: fabricated(["M01", "M01"]),
    });
    expect(decision.outcome).toBe("SELECT");
    expect(decision.selectedBeatId).toBe("M01");
    expect(decision.surfaceableBeatIds).toEqual(["M01"]);
  });
});

function sameMembers(
  left: readonly NarrativeBeatId[],
  right: readonly string[]
): boolean {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}
