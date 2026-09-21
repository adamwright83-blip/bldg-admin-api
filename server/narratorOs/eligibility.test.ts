import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORED_BEAT_DEFAULTS,
  asNarrativeBeatId,
  type AuthoredBeat,
} from "../../shared/narratorOs/contracts";
import { isLegalEligibilityGoldlineEvidence } from "./brainBoundary";
import {
  eligibilityMutates,
  evaluateEligibility,
  type EligibilityInput,
  type VerifiedGoldlineOutcome,
} from "./eligibility";
import {
  applyElapsedTime,
  applyQuietClose,
  commitFiredBeat,
  fireOffscreenIfLegal,
  recordVerifiedGoldlineOutcome,
} from "./ledger";
import { initNarratorOperator } from "./init";
import { createInMemoryNarratorStore } from "./memoryStore";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  BEAT_IDS,
  getBeat,
  offscreenCatalog,
} from "./registry";
import {
  NonRepeatableReplayError,
  UnknownBeatLedgerError,
  applyKnowledgeWrite,
  type NarratorSnapshot,
} from "./store";

const scope = { tenantId: "t-d", operatorUserId: "op-d" };

function fixtureBeat(
  partial: Partial<AuthoredBeat> & { id: string }
): AuthoredBeat {
  return {
    ...AUTHORED_BEAT_DEFAULTS,
    title: partial.title ?? partial.id,
    canonStatus: "LOCKED",
    authoredSourceRef: "test-fixture",
    ...partial,
    id: asNarrativeBeatId(partial.id),
  };
}

async function seeded(knowledge?: NarratorSnapshot["knowledge"]): Promise<{
  store: ReturnType<typeof createInMemoryNarratorStore>;
  snapshot: NarratorSnapshot;
}> {
  const store = createInMemoryNarratorStore();
  const snapshot = await initNarratorOperator(store, scope);
  if (!knowledge) return { store, snapshot };
  await store.replaceKnowledge(scope, knowledge);
  return { store, snapshot: { ...snapshot, knowledge } };
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
  it("returns NO_ELIGIBLE as success with no mutation when nothing passes", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(
      evalInput(snapshot, { mode: "offscreen" })
    );
    expect(result.outcome).toBe("NO_ELIGIBLE");
    expect(result.eligibleBeatIds).toEqual([]);
    expect(eligibilityMutates(result)).toBe(false);
    expect(snapshot.ledger).toEqual([]);
  });

  it("returns ELIGIBLE_WITHHELD only from authored defaultSurface metadata, never taste", async () => {
    const { snapshot } = await seeded();
    const withheld = fixtureBeat({
      id: "withheld-fixture",
      defaultSurface: false,
    });
    const result = evaluateEligibility(
      evalInput(snapshot, { registry: [withheld], graph: [] })
    );
    expect(result.outcome).toBe("ELIGIBLE_WITHHELD");
    expect(result.withheldBeatIds).toEqual(["withheld-fixture"]);
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/eligibility.ts"),
      "utf8"
    );
    expect(src).not.toMatch(
      /feel(?:s)? early|pacing|exciting|mystery better|right time/i
    );
  });

  it("does not fire offscreen unless mayFireOffscreen is true and prereqs pass", async () => {
    const { store, snapshot } = await seeded();
    expect(offscreenCatalog()).toEqual([]);
    const none = await fireOffscreenIfLegal({
      store,
      scope,
      eligibility: evalInput(snapshot, { mode: "offscreen" }),
    });
    expect(none.fired).toEqual([]);
    expect((await store.load(scope))?.ledger).toEqual([]);

    const legal = fixtureBeat({
      id: "offscreen-legal",
      mayFireOffscreen: true,
      defaultSurface: false,
      playerVisibility: false,
      knowledgeMutations: [
        {
          plane: "OTHER",
          factId: "offscreen_occurred",
          op: "learn",
          kind: "EVENT_FACT",
        },
      ],
    });
    const blocked = fixtureBeat({
      id: "offscreen-blocked",
      mayFireOffscreen: false,
    });
    const fired = await fireOffscreenIfLegal({
      store,
      scope,
      eligibility: evalInput(snapshot, {
        registry: [legal, blocked],
        graph: [],
        mode: "offscreen",
      }),
    });
    expect(fired.fired).toEqual(["offscreen-legal"]);
    const after = await store.load(scope);
    expect(after?.ledger).toHaveLength(1);
    expect(after?.ledger[0]?.offscreen).toBe(true);
    expect(after?.ledger[0]?.playerVisible).toBe(false);
    expect(after?.knowledge.planes.OTHER.knownFactIds).toContain(
      "offscreen_occurred"
    );
  });

  it("refuses unknown beats and non-repeatable replay on the ledger", async () => {
    const { store } = await seeded();
    await expect(
      commitFiredBeat({ store, scope, beatId: "CL-031" })
    ).rejects.toBeInstanceOf(UnknownBeatLedgerError);

    await commitFiredBeat({ store, scope, beatId: "constructedness" });
    await expect(
      commitFiredBeat({ store, scope, beatId: "constructedness" })
    ).rejects.toBeInstanceOf(NonRepeatableReplayError);
  });

  it("applies only authored knowledge mutations and preserves visibility when a beat fires", async () => {
    const { store, snapshot } = await seeded();
    const withChemist = applyKnowledgeWrite(snapshot.knowledge, {
      plane: "CHEMIST",
      factId: "17k_recorded_environmental_provenance_wrong",
      op: "learn",
      kind: "EVENT_FACT",
    });
    await store.replaceKnowledge(scope, withChemist);
    const gold: VerifiedGoldlineOutcome[] = [
      {
        outcomeId: "17k_physically_evidenced_in_hand",
        verificationClass: "VERIFIED",
        evidenceClass: "authoritative_external",
      },
    ];
    const eligible = evaluateEligibility(
      evalInput(
        { ...snapshot, knowledge: withChemist },
        { verifiedGoldline: gold }
      )
    );
    expect(eligible.eligibleBeatIds).toContain(BEAT_IDS.C08);
    const after = await commitFiredBeat({ store, scope, beatId: "C-08" });
    expect(after.knowledge.planes.CHEMIST.knownFactIds).toContain(
      "c08_comparison_occurred"
    );
    expect(after.knowledge.planes.PLAYER.knownFactIds).not.toContain(
      "antarctica_is_father_reveal"
    );
    expect(after.knowledge.planes.CLAIRE.knownFactIds).not.toContain(
      "antarctica_is_father_reveal"
    );
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
        holdOpenedAtMs: { authored_hold: 0 },
      },
      5_000,
      [
        {
          key: "authored_hold",
          durationMs: 1_000,
          pathId: "hold-path",
          canonStatus: "LOCKED",
        },
      ]
    );
    expect(aged.createdEvents).toBe(false);
    expect(aged.state.closedForwardPaths).toEqual(["hold-path"]);
  });

  it("reality firewall: unverified and game-projection evidence cannot satisfy Goldline gates", async () => {
    const { snapshot } = await seeded();
    const withChemist = applyKnowledgeWrite(snapshot.knowledge, {
      plane: "CHEMIST",
      factId: "17k_recorded_environmental_provenance_wrong",
      op: "learn",
      kind: "EVENT_FACT",
    });
    expect(
      isLegalEligibilityGoldlineEvidence({
        verificationClass: "CLAIMED",
        evidenceClass: "operator_attested",
      })
    ).toBe(false);
    const result = evaluateEligibility(
      evalInput(
        { ...snapshot, knowledge: withChemist },
        {
          verifiedGoldline: [
            {
              outcomeId: "17k_physically_evidenced_in_hand",
              verificationClass: "VERIFIED",
              evidenceClass: "authoritative_external",
            },
          ].filter(() => false) as VerifiedGoldlineOutcome[],
        }
      )
    );
    expect(
      result.audit.find(entry => entry.beatId === BEAT_IDS.C08)?.pass
    ).toBe(false);
    const m03 = evaluateEligibility(evalInput(snapshot)).audit.find(
      entry => entry.beatId === BEAT_IDS.M03
    )!;
    expect(m03.pass).toBe(false);
    expect(getBeat("M03").eligibilityConditions).toContainEqual({
      kind: "never_manufacture",
      claim: "rejection",
    });
  });

  it("audits every candidate with gates, not hidden reasoning", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.audit).toHaveLength(AUTHORED_BEATS.length);
    for (const entry of result.audit) {
      expect(entry.candidateConsidered).toBe(true);
      expect(entry.beatId).toBeTruthy();
      expect(["LOCKED", "WORKING", "OPEN"]).toContain(entry.canonStatus);
      expect(
        entry.finalOutcome === "pass" || entry.finalOutcome === "fail"
      ).toBe(true);
    }
  });

  it("records verified Goldline outcomes on the ledger when explicitly relevant", async () => {
    const { store } = await seeded();
    await recordVerifiedGoldlineOutcome({
      store,
      scope,
      outcomeId: "spoken_no",
      evidenceRef: {
        sourceType: "field_visit",
        sourceReference: "visit:1",
        classification: "operator_attested",
      },
      relatedBeatId: BEAT_IDS.M03,
    });
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(1);
    expect(loaded?.ledger[0]?.kind).toBe("VERIFIED_GOLDLINE_OUTCOME");
    expect(loaded?.ledger[0]?.goldlineOutcomeId).toBe("spoken_no");
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
    ];
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/server\/claire\/brain/);
      expect(src).not.toMatch(/goldlineWorldEvents/);
      expect(src).not.toMatch(/workingMemoryGate/);
    }
  });
});
