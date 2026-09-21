import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AUTHORED_NARRATIVE_FACTS } from "./authoredNarrativeFacts";
import {
  asNarrativeBeatId,
  type NarrativeBeatId,
} from "../../shared/narratorOs/contracts";
import {
  AUTHORED_DRAMATURGY_TIE_BREAKS,
  decideDramaturgy,
} from "./dramaturgy";
import {
  evaluateProductionEligibility,
  isEligibilityAuthorization,
  issueEligibilityAuthorizations,
  type EligibilityInput,
} from "./eligibility";
import { initNarratorOperator } from "./init";
import { createInMemoryNarratorStore } from "./memoryStore";
import { AUTHORED_BEATS, AUTHORED_GRAPH, getBeat } from "./registry";
import {
  matchSingleSelectedBeatAuthorization,
  orchestrateSelectedBeatReaction,
  type SelectedBeatOrchestrationInput,
} from "./selectedBeatOrchestration";
import { planeKnows, type NarratorSnapshot } from "./store";
import { issueVerifiedGoldlineReceiptForTests } from "./verifiedGoldlineReceipt.testSupport";
import type { VerifiedGoldlineReceipt } from "./verifiedGoldlineReceipt";

const scope = { tenantId: "t-g", operatorUserId: "op-g" };
const NOW_MS = Date.parse("2026-09-21T00:00:00Z");
const NOW_ISO = "2026-09-21T00:00:00.000Z";
const MONDAY_MS = Date.parse("2026-09-14T12:00:00Z");
const TUESDAY_MS = Date.parse("2026-09-15T12:00:00Z");
const SURFACEABLE = ["C-08", "M01", "M03", "M04"] as const;

type OrchestrationKeys = keyof SelectedBeatOrchestrationInput;
type _InputHasNoDecision = Exclude<
  OrchestrationKeys,
  "store" | "scope" | "verifiedGoldline" | "nowMs" | "mode" | "nowIso"
> extends never
  ? true
  : never;
const inputHasNoDecision: _InputHasNoDecision = true;
void inputHasNoDecision;

async function seeded() {
  const store = createInMemoryNarratorStore();
  const snapshot = await initNarratorOperator(store, scope);
  return { store, snapshot };
}

function issueReceipt(
  outcomeId: string,
  extra?: { receiptId?: string; targetId?: string; occurredAtMs?: number }
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
        targetId: "target-g",
        occurredAtMs: MONDAY_MS,
      }),
      issueReceipt("legitimate_second_site_visit", {
        receiptId: "m03-return",
        targetId: "target-g",
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

async function readyFor(
  store: ReturnType<typeof createInMemoryNarratorStore>,
  snapshot: NarratorSnapshot,
  ids: readonly string[],
  extraValues: Record<string, string> = {}
) {
  const evidence = evidenceFor(ids);
  await store.replaceNarrativeState(scope, {
    ...snapshot.narrativeState,
    values: {
      ...snapshot.narrativeState.values,
      ...evidence.values,
      ...extraValues,
    },
  });
  const loaded = await store.load(scope);
  if (!loaded) throw new Error("missing snapshot");
  return { snapshot: loaded, receipts: evidence.receipts };
}

function run(
  store: ReturnType<typeof createInMemoryNarratorStore>,
  receipts: readonly VerifiedGoldlineReceipt[] = [],
  mode: SelectedBeatOrchestrationInput["mode"] = "interactive"
) {
  return orchestrateSelectedBeatReaction({
    store,
    scope,
    verifiedGoldline: receipts,
    nowMs: NOW_MS,
    mode,
    nowIso: NOW_ISO,
  });
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

function ledgerShape(snapshot: NarratorSnapshot) {
  return snapshot.ledger.map(entry => ({
    kind: entry.kind,
    beatId: entry.beatId,
    idempotencyKey: entry.idempotencyKey,
    occurredAt: entry.occurredAt,
    offscreen: entry.offscreen,
    playerVisible: entry.playerVisible,
  }));
}

describe("Narrator OS slice G — selected-beat reaction and memory", () => {
  it("silence does not commit a beat", async () => {
    const { store, snapshot } = await seeded();
    const result = await run(store);
    expect(result.committed).toBe(false);
    expect(result.reason).toBe("no_surfaceable_eligible_beat");
    expect(result.decision.outcome).toBe("SILENCE_NO_ELIGIBLE");
    expect(result.decision.selectedBeatId).toBeNull();
    expect(isEligibilityAuthorization(result.decision)).toBe(false);
    expect(result.snapshot.ledger).toEqual([]);
    expect(result.snapshot.knowledge).toEqual(snapshot.knowledge);
    expect(result.snapshot.narrativeState).toEqual(snapshot.narrativeState);
    expect(result.snapshot.worldTruth).toEqual(snapshot.worldTruth);
    expect(result.snapshot.livedBio).toEqual(snapshot.livedBio);
    expect(await store.load(scope)).toEqual(result.snapshot);
  });

  it("withheld C-06 does not commit", async () => {
    const { store, snapshot } = await seeded();
    expect(getBeat("C-06").defaultSurface).toBe(false);
    const { receipts } = await readyFor(store, snapshot, [], {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "DOES_NOT_SUPPORT",
    });
    const before = await store.load(scope);
    const result = await run(store, receipts);
    expect(result.committed).toBe(false);
    expect(result.reason).toBe("only_withheld_candidates");
    expect(result.decision.outcome).toBe("SILENCE_WITHHELD");
    expect(result.decision.selectedBeatId).toBeNull();
    expect(result.decision.withheldBeatIds).toEqual(["C-06"]);
    expect(result.snapshot.ledger).toEqual([]);
    expect(result.snapshot.knowledge).toEqual(before?.knowledge);
    expect(await store.load(scope)).toEqual(before);
  });

  it("the eleven surfaceable collisions stay unresolved and uncommitted", async () => {
    expect(AUTHORED_DRAMATURGY_TIE_BREAKS).toEqual([]);
    const collisions = subsetsAtLeastTwo([...SURFACEABLE]);
    expect(collisions).toHaveLength(11);
    for (const subset of collisions) {
      const { store, snapshot } = await seeded();
      const { receipts } = await readyFor(store, snapshot, subset);
      const before = await store.load(scope);
      const result = await run(store, receipts);
      expect(result.committed).toBe(false);
      expect(result.decision.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
      expect(result.decision.selectedBeatId).toBeNull();
      expect(result.reason).toBe("multiple_surfaceable_no_authored_tie_break");
      expect(result.snapshot.ledger).toEqual([]);
      expect(await store.load(scope)).toEqual(before);
    }
  });

  it("a stuffed SELECT on an ambiguous set does not commit", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["M01", "M04"]);
    const stuffed = {
      store,
      scope,
      verifiedGoldline: receipts,
      nowMs: NOW_MS,
      mode: "interactive" as const,
      nowIso: NOW_ISO,
      decision: {
        outcome: "SELECT",
        selectedBeatId: "M04",
      },
      beatId: "M04",
      authorization: { beatId: "M04" },
      tieBreaks: [
        {
          ruleId: "caller-invented",
          selectBeatId: "M04",
          surfaceableBeatIds: ["M01", "M04"],
        },
      ],
    };
    const result = await orchestrateSelectedBeatReaction(stuffed);
    expect(result.committed).toBe(false);
    expect(result.decision.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(result.decision.selectedBeatId).toBeNull();
    expect((await store.load(scope))?.ledger).toEqual([]);
    expect((await store.load(scope))?.narrativeState.values.act_i).toBeUndefined();
  });

  it("M01 commits the fired-beat ledger and no invented reaction", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["M01"]);
    const before = (await store.load(scope))!;
    const result = await run(store, receipts);
    expect(result.committed).toBe(true);
    expect(result.reason).toBe("committed_authorized_beat");
    expect(result.decision.outcome).toBe("SELECT");
    expect(result.decision.selectedBeatId).toBe("M01");
    expect(isEligibilityAuthorization(result.decision)).toBe(false);
    expect(getBeat("M01").knowledgeMutations).toEqual([]);
    expect(getBeat("M01").stateMutations).toEqual([]);
    expect(ledgerShape(result.snapshot)).toEqual([
      {
        kind: "FIRED_AUTHORED_BEAT",
        beatId: "M01",
        idempotencyKey: "beat:M01:once",
        occurredAt: NOW_ISO,
        offscreen: false,
        playerVisible: true,
      },
    ]);
    expect(result.snapshot.knowledge).toEqual(before.knowledge);
    expect(result.snapshot.narrativeState.values).toEqual(
      before.narrativeState.values
    );
    expect(result.snapshot.worldTruth).toEqual(before.worldTruth);
    expect(result.snapshot.livedBio).toEqual(before.livedBio);
  });

  it("M03 commits only the authored fired-beat memory", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["M03"]);
    const result = await run(store, receipts);
    expect(result.committed).toBe(true);
    expect(result.decision.selectedBeatId).toBe("M03");
    expect(getBeat("M03").knowledgeMutations).toEqual([]);
    expect(getBeat("M03").stateMutations).toEqual([]);
    expect(result.snapshot.ledger).toHaveLength(1);
    expect(result.snapshot.ledger[0]).toMatchObject({
      kind: "FIRED_AUTHORED_BEAT",
      beatId: "M03",
      offscreen: false,
      playerVisible: true,
    });
    expect(result.snapshot.knowledge.planes.PLAYER.knownFactIds).toEqual([]);
    expect(result.snapshot.knowledge.planes.CLAIRE.knownFactIds).toEqual([]);
    expect(result.snapshot.narrativeState.values).toEqual({});
    const again = await run(store, receipts);
    expect(again.committed).toBe(false);
    expect(again.decision.outcome).toBe("SILENCE_NO_ELIGIBLE");
    expect(again.snapshot.ledger).toHaveLength(1);
  });

  it("M04 commits the authored state mutation through the existing ledger path", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["M04"]);
    const result = await run(store, receipts);
    expect(result.committed).toBe(true);
    expect(result.decision.selectedBeatId).toBe("M04");
    expect(result.snapshot.narrativeState.values.act_i).toBe("complete");
    expect(result.snapshot.knowledge.planes.PLAYER.knownFactIds).toEqual([]);
    expect(ledgerShape(result.snapshot)).toEqual([
      {
        kind: "FIRED_AUTHORED_BEAT",
        beatId: "M04",
        idempotencyKey: "beat:M04:once",
        occurredAt: NOW_ISO,
        offscreen: false,
        playerVisible: true,
      },
    ]);
    const again = await run(store, receipts);
    expect(again.committed).toBe(false);
    expect(again.snapshot.narrativeState.values.act_i).toBe("complete");
    expect(again.snapshot.ledger).toHaveLength(1);
  });

  it("C-08 commits only the beat's authored knowledge mutations", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["C-08"]);
    const before = (await store.load(scope))!;
    const result = await run(store, receipts);
    const beat = getBeat("C-08");
    expect(result.committed).toBe(true);
    expect(result.decision.selectedBeatId).toBe("C-08");
    expect(beat.stateMutations).toEqual([]);
    for (const plane of ["PLAYER", "CLAIRE", "CHEMIST", "OTHER"] as const) {
      const expected = beat.knowledgeMutations
        .filter(mutation => mutation.plane === plane && mutation.op === "learn")
        .map(mutation => mutation.factId);
      expect([...result.snapshot.knowledge.planes[plane].knownFactIds]).toEqual(
        expected
      );
      for (const factId of expected) {
        expect(planeKnows(result.snapshot.knowledge, plane, factId)).toBe(true);
      }
    }
    expect(planeKnows(result.snapshot.knowledge, "OTHER", "c08_comparison_occurred")).toBe(
      false
    );
    expect(result.snapshot.narrativeState.values).toEqual(
      before.narrativeState.values
    );
    expect(result.snapshot.worldTruth).toEqual(before.worldTruth);
    expect(result.snapshot.livedBio).toEqual(before.livedBio);
    expect(result.snapshot.ledger.map(entry => entry.beatId)).toEqual(["C-08"]);
    expect(result.snapshot.ledger[0]?.kind).toBe("FIRED_AUTHORED_BEAT");
  });

  it("a withheld C-06 beside one surfaceable beat does not fire", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["M04"], {
      [AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult]: "INSUFFICIENT",
    });
    const result = await run(store, receipts);
    expect(result.committed).toBe(true);
    expect(result.decision.selectedBeatId).toBe("M04");
    expect(result.decision.withheldBeatIds).toEqual(["C-06"]);
    expect(result.snapshot.ledger.map(entry => entry.beatId)).toEqual(["M04"]);
    expect(result.snapshot.narrativeState.values.act_i).toBe("complete");
    expect(
      result.snapshot.narrativeState.values[
        AUTHORED_NARRATIVE_FACTS.chemistNonSupportiveResult
      ]
    ).toBe("INSUFFICIENT");
  });

  it("offscreen mode does not commit a beat that may not fire offscreen", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["M01"]);
    expect(getBeat("M01").mayFireOffscreen).toBe(false);
    const result = await run(store, receipts, "offscreen");
    expect(result.committed).toBe(false);
    expect(result.decision.outcome).toBe("SILENCE_NO_ELIGIBLE");
    expect(result.decision.selectedBeatId).toBeNull();
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("an uninitialized operator does not commit", async () => {
    const store = createInMemoryNarratorStore();
    await expect(run(store)).rejects.toThrow(/not initialized/);
  });

  it("identical inputs commit the same authored record", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1);
    vi.spyOn(Math, "random").mockReturnValue(0.01);
    const first = await seeded();
    const firstReady = await readyFor(first.store, first.snapshot, ["M04"]);
    const early = await run(first.store, firstReady.receipts);
    vi.spyOn(Date, "now").mockReturnValue(9_999_999_999_999);
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const second = await seeded();
    const secondReady = await readyFor(second.store, second.snapshot, ["M04"]);
    const late = await run(second.store, secondReady.receipts);
    vi.restoreAllMocks();
    expect(late.decision).toEqual(early.decision);
    expect(late.committed).toBe(true);
    expect(ledgerShape(late.snapshot)).toEqual(ledgerShape(early.snapshot));
    expect(late.snapshot.narrativeState.values).toEqual(
      early.snapshot.narrativeState.values
    );
  });

  it("a SELECT decision without a single-beat authorization does not match", async () => {
    const { snapshot } = await seeded();
    const m04 = evidenceFor(["M04"]);
    const both = evidenceFor(["M01", "M04"]);
    const m04Input: EligibilityInput = {
      registry: AUTHORED_BEATS,
      graph: AUTHORED_GRAPH,
      snapshot,
      verifiedGoldline: m04.receipts,
      nowMs: NOW_MS,
      mode: "interactive",
    };
    const bothSnapshot: NarratorSnapshot = {
      ...snapshot,
      narrativeState: {
        ...snapshot.narrativeState,
        values: { ...snapshot.narrativeState.values, ...both.values },
      },
    };
    const bothInput: EligibilityInput = {
      ...m04Input,
      snapshot: bothSnapshot,
      verifiedGoldline: both.receipts,
    };
    const m04Result = evaluateProductionEligibility(m04Input);
    const bothResult = evaluateProductionEligibility(bothInput);
    const selected = decideDramaturgy({ eligibility: m04Result });
    const ambiguous = decideDramaturgy({ eligibility: bothResult });
    const m04Auth = issueEligibilityAuthorizations(m04Result, m04Input);
    const bothAuth = issueEligibilityAuthorizations(bothResult, bothInput);
    expect(selected.outcome).toBe("SELECT");
    expect(ambiguous.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(matchSingleSelectedBeatAuthorization(selected, [])).toBeNull();
    expect(
      matchSingleSelectedBeatAuthorization(selected, bothAuth)
    ).toBeNull();
    expect(
      matchSingleSelectedBeatAuthorization(ambiguous, m04Auth)
    ).toBeNull();
    expect(
      matchSingleSelectedBeatAuthorization(ambiguous, bothAuth)
    ).toBeNull();
    const matched = matchSingleSelectedBeatAuthorization(selected, m04Auth);
    expect(matched?.beatId).toBe("M04");
    expect(isEligibilityAuthorization(matched)).toBe(true);
    const stuffedSelect = {
      ...ambiguous,
      outcome: "SELECT" as const,
      selectedBeatId: asNarrativeBeatId("M04"),
    };
    expect(
      matchSingleSelectedBeatAuthorization(stuffedSelect, bothAuth)
    ).toBeNull();
  });

  it("production beat mutation still has one applier", () => {
    const dir = resolve(process.cwd(), "server/narratorOs");
    const files = readdirSync(dir).filter(
      name => name.endsWith(".ts") && !name.endsWith(".test.ts")
    );
    const read = (name: string) => readFileSync(resolve(dir, name), "utf8");
    const orchestration = read("selectedBeatOrchestration.ts");
    expect(orchestration).toMatch(/commitAuthorizedBeat\(/);
    expect(orchestration).toMatch(/evaluateProductionEligibility\(/);
    expect(orchestration).toMatch(/issueEligibilityAuthorizations\(/);
    expect(orchestration).toMatch(/decideDramaturgy\(\{ eligibility: result \}\)/);
    expect(orchestration).not.toMatch(
      /commitAtomic|applyKnowledgeWrite|appendLedger|replaceKnowledge|replaceNarrativeState|recordVerifiedGoldlineOutcome/
    );
    expect(orchestration).not.toMatch(
      /Math\.random|Date\.now|new Date\(|generateText|openai|xai|server\/claire|decideDramaturgyWithRulesForTests|decideDramaturgyWithCatalog/
    );
    const knowledgeWriters = files.filter(name =>
      /applyKnowledgeWrite\(/.test(read(name))
    );
    expect(knowledgeWriters.sort()).toEqual(["ledger.ts", "store.ts"]);
    const atomicBeatCalls = files.filter(name =>
      /input\.store\.commitAtomic\(/.test(read(name))
    );
    expect(atomicBeatCalls).toEqual(["ledger.ts"]);
    const dramaturgy = read("dramaturgy.ts");
    const select = read("dramaturgySelect.ts");
    expect(dramaturgy).not.toMatch(/commitAuthorizedBeat|commitAtomic/);
    expect(select).not.toMatch(/commitAuthorizedBeat|commitAtomic/);
    expect(read("ledger.ts")).not.toMatch(/dramaturg/);
    expect(AUTHORED_DRAMATURGY_TIE_BREAKS).toEqual([]);
  });

  it("the index exports the orchestrator and not a caller catalog", async () => {
    const narratorIndex = await import("./index");
    expect("orchestrateSelectedBeatReaction" in narratorIndex).toBe(true);
    expect("decideDramaturgyWithRulesForTests" in narratorIndex).toBe(false);
    expect("decideDramaturgyWithCatalog" in narratorIndex).toBe(false);
    const indexSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/index.ts"),
      "utf8"
    );
    expect(indexSrc).not.toMatch(/dramaturgy\.testSupport|tieBreaks/);
    const beatId: NarrativeBeatId | null = null;
    void beatId;
  });
});
