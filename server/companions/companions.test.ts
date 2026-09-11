import { describe, expect, it } from "vitest";
import { SEED_COMPANIONS } from "./seedCompanions";

describe("companion roster", () => {
  it("has exactly the seven companions from REALITY_BRIDGE.md", () => {
    const ids = SEED_COMPANIONS.map(seed => seed.companionId).sort();
    expect(ids).toEqual(
      ["bront", "ilex", "luma", "mara", "orren", "rook", "sable"].sort()
    );
  });

  it("every companion has a non-empty may and may-not list", () => {
    for (const { companionId, companion } of SEED_COMPANIONS) {
      expect(companion.may.length, companionId).toBeGreaterThan(0);
      expect(companion.mayNot.length, companionId).toBeGreaterThan(0);
      expect(companion.abilityId.trim(), companionId).not.toBe("");
    }
  });

  it("only Rook is unified with an existing product persona", () => {
    for (const { companionId, companion } of SEED_COMPANIONS) {
      if (companionId === "rook") {
        expect(companion.unifiedProductPersona).toBe(true);
        expect(companion.productPersonaNote).toBeTruthy();
      } else {
        expect(companion.unifiedProductPersona, companionId).toBe(false);
      }
    }
  });
});
