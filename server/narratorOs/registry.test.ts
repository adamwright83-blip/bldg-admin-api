import { describe, expect, it } from "vitest";
import { InvalidNarrativeBeatIdError } from "../../shared/narratorOs/contracts";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  BEAT_IDS,
  assertNoPlaceholderBeats,
  getBeat,
  hasChemistSkipPolicy,
  isKnownBeatId,
  offscreenCatalog,
  originFalseWithoutChemistIsOpen,
} from "./registry";
import { assertMutationsLegal } from "./ledger";
import { evaluateEligibility, type EligibilityInput } from "./eligibility";
import { createInMemoryNarratorStore } from "./memoryStore";
import { initNarratorOperator } from "./init";
import { applyKnowledgeWrite } from "./store";
import type { NarratorSnapshot } from "./store";

async function snapshotWithChemistCore(): Promise<NarratorSnapshot> {
  const store = createInMemoryNarratorStore();
  const seeded = await initNarratorOperator(store, {
    tenantId: "t-reg",
    operatorUserId: "op-reg",
  });
  return {
    ...seeded,
    knowledge: applyKnowledgeWrite(seeded.knowledge, {
      plane: "CHEMIST",
      factId: "17k_recorded_environmental_provenance_wrong",
      op: "learn",
      kind: "EVENT_FACT",
    }),
  };
}

function inputFor(
  snapshot: NarratorSnapshot,
  extra?: Partial<EligibilityInput>
): EligibilityInput {
  return {
    registry: AUTHORED_BEATS,
    graph: AUTHORED_GRAPH,
    snapshot,
    verifiedGoldline: [],
    nowMs: 0,
    mode: "interactive",
    ...extra,
  };
}

describe("Narrator OS slice C — authored registry + graph", () => {
  it("rejects unknown beat ids", () => {
    expect(isKnownBeatId("CL-031")).toBe(false);
    expect(() => getBeat("CL-031")).toThrow(InvalidNarrativeBeatIdError);
  });

  it("fails a missing hard prerequisite and does not treat optional as mandatory", async () => {
    const snapshot = await snapshotWithChemistCore();
    const withoutGold = evaluateEligibility(inputFor(snapshot));
    const c08 = withoutGold.audit.find(entry => entry.beatId === BEAT_IDS.C08)!;
    expect(c08.pass).toBe(false);
    expect(c08.failedGates).toContain("prerequisite");

    const cove = withoutGold.audit.find(
      entry => entry.beatId === BEAT_IDS.K_COVE_ORIGIN
    )!;
    expect(
      cove.prerequisiteChecks.some(
        check =>
          check.detail.startsWith("optional_beat:C-08") && check.passed === true
      )
    ).toBe(true);
    expect(cove.failedGates).not.toContain("prerequisite");
  });

  it("keeps WORKING distinct from LOCKED and does not self-resolve OPEN edges", () => {
    const m01 = getBeat("M01");
    const m16 = getBeat("M16");
    expect(m01.canonStatus).toBe("LOCKED");
    expect(m01.title).toBe("FIRST LIGHT");
    expect(m16.canonStatus).toBe("WORKING");
    expect(m16.title).toBeNull();
    expect(originFalseWithoutChemistIsOpen()).toBe(true);
    const openEdge = AUTHORED_GRAPH.find(
      edge =>
        edge.kind === "open_unresolved" &&
        edge.policyId === "origin_false_without_chemist"
    );
    expect(openEdge?.canonStatus).toBe("OPEN");
  });

  it("loads real fixtures and does not require placeholder beats", () => {
    expect(getBeat("C-08").title).toBe("Chemist comparison");
    expect(getBeat("K-COVE-ORIGIN").title).toBe("Cove origin-false reveal");
    expect(getBeat("constructedness").canonStatus).toBe("LOCKED");
    expect(() => assertNoPlaceholderBeats()).not.toThrow();
    expect(AUTHORED_BEATS.some(beat => /^CL-\d+$/i.test(beat.id))).toBe(false);
  });

  it("enforces C-08 prereqs and cannot establish prohibited knowledge", async () => {
    const snapshot = await snapshotWithChemistCore();
    const blocked = evaluateEligibility(inputFor(snapshot));
    expect(
      blocked.audit.find(entry => entry.beatId === BEAT_IDS.C08)?.pass
    ).toBe(false);

    const ready = evaluateEligibility(
      inputFor(snapshot, {
        verifiedGoldline: [
          {
            outcomeId: "17k_physically_evidenced_in_hand",
            verificationClass: "VERIFIED",
            evidenceClass: "authoritative_external",
          },
        ],
      })
    );
    expect(ready.audit.find(entry => entry.beatId === BEAT_IDS.C08)?.pass).toBe(
      true
    );

    const c08 = getBeat("C-08");
    expect(() => assertMutationsLegal(c08)).not.toThrow();
    expect(c08.legalChemistVerdicts).toEqual([
      "SUPPORTS",
      "DOES_NOT_SUPPORT",
      "INSUFFICIENT",
    ]);
    for (const prohibited of c08.prohibitedKnowledgeFactIds) {
      expect(
        c08.knowledgeMutations.some(mutation => mutation.factId === prohibited)
      ).toBe(false);
    }
  });

  it("does not hard-require C-08 for K-COVE-ORIGIN and does not synthesize a Chemist skip policy", async () => {
    const snapshot = await snapshotWithChemistCore();
    const result = evaluateEligibility(inputFor(snapshot));
    const cove = result.audit.find(
      entry => entry.beatId === BEAT_IDS.K_COVE_ORIGIN
    )!;
    expect(
      cove.graphDependencyChecks.some(
        check => check.passed === "unresolved_open"
      )
    ).toBe(true);
    expect(cove.failedGates).not.toContain("graph_dependency");
    expect(hasChemistSkipPolicy()).toBe(false);
    expect(originFalseWithoutChemistIsOpen()).toBe(true);
    expect(
      getBeat("K-COVE-ORIGIN").prerequisites.some(
        prereq => prereq.kind === "hard_beat" && prereq.beatId === BEAT_IDS.C08
      )
    ).toBe(false);
  });

  it("treats an empty offscreen catalog as valid", () => {
    expect(offscreenCatalog()).toEqual([]);
    expect(AUTHORED_BEATS.every(beat => beat.mayFireOffscreen === false)).toBe(
      true
    );
  });
});
