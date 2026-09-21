import { describe, expect, it } from "vitest";
import { InvalidNarrativeBeatIdError } from "../../shared/narratorOs/contracts";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  BEAT_IDS,
  INTENTIONALLY_ABSENT_MISSION_IDS,
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
import type { NarratorSnapshot } from "./store";
import { issueVerifiedGoldlineReceiptForTests } from "./verifiedGoldlineReceipt.testSupport";

async function newSnapshot(): Promise<NarratorSnapshot> {
  const store = createInMemoryNarratorStore();
  return initNarratorOperator(store, {
    tenantId: "t-reg",
    operatorUserId: "op-reg",
  });
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

  it("keeps M05–M14 intentionally absent", () => {
    for (const id of INTENTIONALLY_ABSENT_MISSION_IDS) {
      expect(isKnownBeatId(id)).toBe(false);
    }
    expect(AUTHORED_BEATS.map(beat => beat.id)).toEqual(
      expect.arrayContaining(["M01", "M02", "M03", "M04", "M15", "M16", "M24"])
    );
    expect(AUTHORED_BEATS.some(beat => beat.id === "M05")).toBe(false);
  });

  it("fails a missing Goldline prereq and does not treat optional C-08 as mandatory", async () => {
    const snapshot = await newSnapshot();
    const withoutGold = evaluateEligibility(inputFor(snapshot));
    const c08 = withoutGold.audit.find(entry => entry.beatId === BEAT_IDS.C08)!;
    expect(c08.pass).toBe(false);
    expect(c08.failedGates).toContain("incomplete_eligibility");
    expect(c08.failedGates).toContain("verified_goldline_evidence");

    const cove = withoutGold.audit.find(
      entry => entry.beatId === BEAT_IDS.K_COVE_ORIGIN
    )!;
    expect(
      cove.prerequisiteChecks.some(
        check =>
          check.detail.startsWith("optional_beat:C-08") && check.passed === true
      )
    ).toBe(true);
    expect(cove.failedGates).toContain("open_unresolved");
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

  it("does not require C-08's own conclusion as an input, and stays incomplete without the package", async () => {
    const snapshot = await newSnapshot();
    const c08 = getBeat("C-08");
    expect(c08.eligibilityDefinition).toBe("INCOMPLETE");
    expect(
      c08.knowledgeRequirements.some(
        requirement =>
          requirement.plane === "CHEMIST" &&
          requirement.factId === "17k_recorded_environmental_provenance_wrong"
      )
    ).toBe(false);
    expect(
      c08.prerequisites.some(
        prereq =>
          prereq.kind === "knowledge" &&
          prereq.plane === "CHEMIST" &&
          prereq.factId === "17k_recorded_environmental_provenance_wrong"
      )
    ).toBe(false);

    const withGold = evaluateEligibility(
      inputFor(snapshot, {
        verifiedGoldline: [
          issueVerifiedGoldlineReceiptForTests({
            receiptId: "receipt:17k_physically_evidenced_in_hand",
            tenantId: "t-reg",
            operatorUserId: "op-reg",
            outcomeId: "17k_physically_evidenced_in_hand",
            evidenceClass: "authoritative_external",
            evidenceRef: {
              sourceType: "external_record",
              sourceReference: "receipt:17k_physically_evidenced_in_hand",
              classification: "authoritative_external",
            },
          }),
        ],
      })
    );
    const audit = withGold.audit.find(entry => entry.beatId === BEAT_IDS.C08)!;
    expect(audit.pass).toBe(false);
    expect(audit.failedGates).toContain("incomplete_eligibility");
    expect(audit.failedGates).not.toContain("knowledge_requirement");

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
    const snapshot = await newSnapshot();
    const result = evaluateEligibility(inputFor(snapshot));
    const cove = result.audit.find(
      entry => entry.beatId === BEAT_IDS.K_COVE_ORIGIN
    )!;
    expect(
      cove.graphDependencyChecks.some(
        check => check.passed === "unresolved_open"
      )
    ).toBe(true);
    expect(cove.failedGates).toContain("open_unresolved");
    expect(cove.pass).toBe(false);
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
