import { describe, expect, it } from "vitest";
import {
  assertBusinessTruthEvidence,
  assertGameProjectionDoesNotPromoteTruth,
  canSupportBusinessTruth,
  type GoldlineEvidenceRef,
} from "./goldlineTruthContract";

const evidence = (
  classification: GoldlineEvidenceRef["classification"]
): GoldlineEvidenceRef => ({
  sourceType: "test",
  sourceReference: `test:${classification}`,
  classification,
  observedAt: "2026-09-13T09:00:00.000Z",
});

describe("Goldline truth contract", () => {
  it("allows authoritative external and operator-attested evidence to support business truth", () => {
    expect(canSupportBusinessTruth(evidence("authoritative_external"))).toBe(true);
    expect(canSupportBusinessTruth(evidence("operator_attested"))).toBe(true);
  });

  it("keeps derived intelligence and game projection from becoming business truth", () => {
    expect(canSupportBusinessTruth(evidence("derived"))).toBe(false);
    expect(canSupportBusinessTruth(evidence("game_projection"))).toBe(false);
    expect(() => assertBusinessTruthEvidence([evidence("derived")], "sale")).toThrow(
      /sale requires/
    );
  });

  it("structurally rejects game projection promoting itself to real-world evidence", () => {
    expect(() =>
      assertGameProjectionDoesNotPromoteTruth({
        source: "game_projection",
        target: "operator_attested",
      })
    ).toThrow(/cannot create business truth/);
  });
});
