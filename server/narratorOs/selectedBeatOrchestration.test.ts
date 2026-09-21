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
import {
  LiveDramaturgyMismatchError,
  commitAuthorizedBeat,
  fireOffscreenIfLegal,
  recordVerifiedGoldlineOutcome,
} from "./ledger";
import {
  authoredReactionPlan,
  authoredReactionReceipt,
  narrativeMemoryView,
} from "./narrativeReadModels";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  getBeat,
  offscreenCatalog,
} from "./registry";
import {
  OffscreenReactionOrchestrationError,
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
  "store" | "scope" | "verifiedGoldline" | "nowMs" | "nowIso"
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
  receipts: readonly VerifiedGoldlineReceipt[] = []
) {
  return orchestrateSelectedBeatReaction({
    store,
    scope,
    verifiedGoldline: receipts,
    nowMs: NOW_MS,
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

  it("orchestration cannot execute offscreen", async () => {
    const { store, snapshot } = await seeded();
    const { receipts } = await readyFor(store, snapshot, ["M01"]);
    const before = await store.load(scope);
    const attempt = {
      store,
      scope,
      verifiedGoldline: receipts,
      nowMs: NOW_MS,
      nowIso: NOW_ISO,
      mode: "offscreen" as const,
    };
    await expect(
      orchestrateSelectedBeatReaction(attempt)
    ).rejects.toBeInstanceOf(OffscreenReactionOrchestrationError);
    expect(await store.load(scope)).toEqual(before);
    expect(getBeat("M01").mayFireOffscreen).toBe(false);
    expect(offscreenCatalog()).toEqual([]);
    const offscreen = await fireOffscreenIfLegal({
      store,
      scope,
      eligibility: {
        registry: AUTHORED_BEATS,
        graph: AUTHORED_GRAPH,
        snapshot: before!,
        verifiedGoldline: receipts,
        nowMs: NOW_MS,
        mode: "offscreen",
      },
    });
    expect(offscreen.fired).toEqual([]);
    expect((await store.load(scope))?.ledger).toEqual([]);
    const ledgerSrc = readFileSync(
      resolve(process.cwd(), "server/narratorOs/ledger.ts"),
      "utf8"
    );
    const offscreenFn = ledgerSrc.slice(
      ledgerSrc.indexOf("export async function fireOffscreenIfLegal")
    );
    expect(offscreenFn).toMatch(/mode: "offscreen"/);
    expect(offscreenFn).toMatch(/mayFireOffscreen !== true/);
    expect(offscreenFn).toMatch(/commitAuthorizedBeat\(/);
    expect(offscreenFn).not.toMatch(/decideDramaturgy/);
  });

  it("the commit reload refuses when live dramaturgy becomes ambiguous", async () => {
    const { store, snapshot } = await seeded();
    const receipts = evidenceFor(["M04"]).receipts;
    const opening = evaluateProductionEligibility({
      registry: AUTHORED_BEATS,
      graph: AUTHORED_GRAPH,
      snapshot,
      verifiedGoldline: receipts,
      nowMs: NOW_MS,
      mode: "interactive",
    });
    expect(decideDramaturgy({ eligibility: opening }).selectedBeatId).toBe(
      "M04"
    );
    const originalLoad = store.load.bind(store);
    let reads = 0;
    store.load = async scopeArg => {
      reads += 1;
      const loaded = await originalLoad(scopeArg);
      if (reads === 1) {
        await store.replaceNarrativeState(scopeArg, {
          ...loaded.narrativeState,
          values: {
            ...loaded.narrativeState.values,
            [AUTHORED_NARRATIVE_FACTS.reservedCorePreserved]: "true",
            [AUTHORED_NARRATIVE_FACTS.lot17kPhysicallyInHand]: "true",
          },
        });
      }
      return loaded;
    };
    const result = await run(store, receipts);
    expect(reads).toBeGreaterThanOrEqual(2);
    expect(result.committed).toBe(false);
    expect(result.reason).toBe("live_dramaturgy_mismatch");
    expect(result.decision.outcome).toBe("AMBIGUOUS_REQUIRES_AUTHORED_RULE");
    expect(result.decision.selectedBeatId).toBeNull();
    expect(
      result.snapshot.ledger.filter(entry => entry.kind === "FIRED_AUTHORED_BEAT")
    ).toEqual([]);
    expect(result.snapshot.knowledge.planes.PLAYER.knownFactIds).toEqual([]);
    expect(result.snapshot.knowledge.planes.CLAIRE.knownFactIds).toEqual([]);
    expect(result.snapshot.knowledge.planes.CHEMIST.knownFactIds).toEqual([]);
    expect(result.snapshot.narrativeState.values.act_i).toBeUndefined();
    expect(result.snapshot.worldTruth).toEqual(snapshot.worldTruth);
    expect(result.snapshot.livedBio).toEqual(snapshot.livedBio);
  });

  it("a valid authorization does not commit an ambiguous live set", async () => {
    const { store, snapshot } = await seeded();
    const both = evidenceFor(["M01", "M04"]);
    const onlyM04 = evidenceFor(["M04"]);
    const live = (await store.load(scope))!;
    const ambiguousInput: EligibilityInput = {
      registry: AUTHORED_BEATS,
      graph: AUTHORED_GRAPH,
      snapshot: live,
      verifiedGoldline: both.receipts,
      nowMs: NOW_MS,
      mode: "interactive",
    };
    const ambiguous = evaluateProductionEligibility(ambiguousInput);
    expect([...ambiguous.eligibleBeatIds]).toEqual(["M01", "M04"]);
    const singleton = evaluateProductionEligibility({
      ...ambiguousInput,
      verifiedGoldline: onlyM04.receipts,
    });
    const authorization = issueEligibilityAuthorizations(
      singleton,
      { ...ambiguousInput, verifiedGoldline: onlyM04.receipts }
    ).find(item => item.beatId === "M04");
    expect(isEligibilityAuthorization(authorization)).toBe(true);
    const before = await store.load(scope);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: authorization!,
        eligibility: ambiguousInput,
      })
    ).rejects.toBeInstanceOf(LiveDramaturgyMismatchError);
    expect(await store.load(scope)).toEqual(before);
    expect(before?.narrativeState.values.act_i).toBeUndefined();
    expect(before?.knowledge.planes.PLAYER.knownFactIds).toEqual([]);
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
    const ledgerSrc = read("ledger.ts");
    expect(ledgerSrc).toMatch(/input\.store\.commitAtomic\(/);
    expect(ledgerSrc).toMatch(
      /liveInput\.mode === "interactive"[\s\S]*decideDramaturgy\(\{ eligibility: result \}\)/
    );
    const readModel = read("narrativeReadModels.ts");
    expect(readModel).not.toMatch(
      /commitAuthorizedBeat|commitAtomic|appendLedger|replaceKnowledge|replaceNarrativeState|applyKnowledgeWrite/
    );
    expect(AUTHORED_DRAMATURGY_TIE_BREAKS).toEqual([]);
  });

  it("the index exports the orchestrator and not a caller catalog", async () => {
    const narratorIndex = await import("./index");
    expect("orchestrateSelectedBeatReaction" in narratorIndex).toBe(true);
    expect("authoredReactionPlan" in narratorIndex).toBe(true);
    expect("authoredReactionReceipt" in narratorIndex).toBe(true);
    expect("narrativeMemoryView" in narratorIndex).toBe(true);
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

  it("reaction plan, receipt, and memory are reads over the existing commit", async () => {
    const { store, snapshot } = await seeded();
    const before = await store.load(scope);
    const m01 = authoredReactionPlan("M01");
    const m04 = authoredReactionPlan("M04");
    const c08 = authoredReactionPlan("C-08");
    expect(await store.load(scope)).toEqual(before);
    expect(isEligibilityAuthorization(m04)).toBe(false);
    expect(m01.knowledgeMutations).toEqual([]);
    expect(m01.stateMutations).toEqual([]);
    expect(m04.stateMutations).toEqual([{ key: "act_i", value: "complete" }]);
    expect(m04.knowledgeMutations).toEqual([]);
    expect(m04.playerVisibility).toBe(getBeat("M04").playerVisibility);
    expect(m04.authoredSourceRef).toBe(getBeat("M04").authoredSourceRef);
    expect(m04.characters).toEqual([...getBeat("M04").characters]);
    expect(c08.knowledgeMutations.map(mutation => mutation.factId)).toEqual([
      "c08_comparison_occurred",
      "c08_comparison_occurred",
      "c08_comparison_occurred",
    ]);
    expect(m04).not.toHaveProperty("presented");
    expect(m04).not.toHaveProperty("delivered");
    expect(c08).not.toHaveProperty("ranking");

    const { receipts } = await readyFor(store, snapshot, ["M04"]);
    const committed = await run(store, receipts);
    expect(committed.committed).toBe(true);
    const fired = committed.snapshot.ledger[0]!;
    const receipt = authoredReactionReceipt(committed.snapshot, fired.id);
    expect(receipt).toEqual({
      beatId: "M04",
      ledgerEntryId: fired.id,
      occurredAt: fired.occurredAt,
      knowledgeMutationRefs: [],
      stateMutationRefs: [{ key: "act_i", value: "complete" }],
      characters: [...getBeat("M04").characters],
      playerVisible: true,
    });
    expect(receipt).not.toHaveProperty("presented");
    expect(receipt).not.toHaveProperty("delivered");
    expect(receipt).not.toHaveProperty("surfaced");
    expect(receipt).not.toHaveProperty("claireSaid");
    expect(authoredReactionReceipt(committed.snapshot, "missing")).toBeNull();

    const evidence = issueReceipt("kept_promised_send_visit_or_call", {
      receiptId: "memory-only-goldline",
    });
    await recordVerifiedGoldlineOutcome({
      store,
      scope,
      receipt: evidence,
      nowIso: NOW_ISO,
    });
    const stored = (await store.load(scope))!;
    const ledgerBeforeView = stored.ledger.map(entry => entry.id);
    const playerFacts = [...stored.knowledge.planes.PLAYER.knownFactIds];
    const memory = narrativeMemoryView(stored);
    expect(stored.ledger.map(entry => entry.id)).toEqual(ledgerBeforeView);
    expect([...stored.knowledge.planes.PLAYER.knownFactIds]).toEqual(playerFacts);
    expect(memory.firedAuthoredBeats).toHaveLength(1);
    expect(memory.firedAuthoredBeats[0]).toMatchObject({
      ledgerEntryId: fired.id,
      beatId: "M04",
      occurredAt: NOW_ISO,
      offscreen: false,
      playerVisible: true,
    });
    expect(memory.firedAuthoredBeats[0]).not.toHaveProperty("presented");
    expect(memory.firedAuthoredBeats[0]).not.toHaveProperty("delivered");
    expect(memory.verifiedGoldlineOutcomes).toHaveLength(1);
    expect(memory.verifiedGoldlineOutcomes[0]).toMatchObject({
      goldlineOutcomeId: "kept_promised_send_visit_or_call",
      relatedBeatId: null,
    });
    expect(
      memory.firedAuthoredBeats.map(row => row.ledgerEntryId)
    ).not.toContain(memory.verifiedGoldlineOutcomes[0]?.ledgerEntryId);
    expect(
      authoredReactionReceipt(
        stored,
        memory.verifiedGoldlineOutcomes[0]!.ledgerEntryId
      )
    ).toBeNull();
    expect(memory.narrativeStateValues.act_i).toBe("complete");
    expect(memory.closedForwardPaths).toEqual([]);
    expect(memory.holdOpenedAtMs).toEqual({});
    expect(memory.knowledge.planes.PLAYER.knownFactIds).toEqual([]);
    expect(memory).not.toHaveProperty("presented");
    expect(memory).not.toHaveProperty("delivered");
  });

  it("keeps repeat M03 occurrences as separate memory rows", async () => {
    const { store, snapshot } = await seeded();
    const first = evidenceFor(["M03"]);
    const opened = await run(store, first.receipts);
    expect(opened.committed).toBe(true);
    const wednesday = Date.parse("2026-09-16T12:00:00Z");
    const thursday = Date.parse("2026-09-17T12:00:00Z");
    const secondReceipts = [
      ...first.receipts,
      issueReceipt("silence_eligible_for_retry", {
        receiptId: "m03-arm-2",
        targetId: "target-g",
        occurredAtMs: wednesday,
      }),
      issueReceipt("legitimate_second_site_visit", {
        receiptId: "m03-return-2",
        targetId: "target-g",
        occurredAtMs: thursday,
      }),
    ];
    const again = await orchestrateSelectedBeatReaction({
      store,
      scope,
      verifiedGoldline: secondReceipts,
      nowMs: NOW_MS,
      nowIso: "2026-09-22T00:00:00.000Z",
    });
    expect(again.committed).toBe(true);
    expect(again.decision.selectedBeatId).toBe("M03");
    const memory = narrativeMemoryView(again.snapshot);
    expect(memory.firedAuthoredBeats).toHaveLength(2);
    expect(memory.firedAuthoredBeats.map(row => row.beatId)).toEqual([
      "M03",
      "M03",
    ]);
    expect(memory.firedAuthoredBeats[0]?.ledgerEntryId).not.toBe(
      memory.firedAuthoredBeats[1]?.ledgerEntryId
    );
    expect(memory.firedAuthoredBeats[0]?.occurredAt).toBe(NOW_ISO);
    expect(memory.firedAuthoredBeats[1]?.occurredAt).toBe(
      "2026-09-22T00:00:00.000Z"
    );
    expect(memory.firedAuthoredBeats.every(row => row.playerVisible)).toBe(
      true
    );
    expect(memory.firedAuthoredBeats[0]).not.toHaveProperty("presented");
    expect(again.snapshot.knowledge.planes.CLAIRE.knownFactIds).toEqual([]);
    const before = again.snapshot.ledger.length;
    narrativeMemoryView(again.snapshot);
    expect(again.snapshot.ledger).toHaveLength(before);
  });
});
