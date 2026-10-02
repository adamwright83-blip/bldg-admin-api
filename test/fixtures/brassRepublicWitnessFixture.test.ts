import { describe, expect, it } from "vitest";
import { getBrassRepublicMetadata } from "./brassRepublicWitnessFixture";

describe("Brass Republic Characterization Fixture Contract", () => {
  it("exposes canonical Kingdom One identity without Boreslay entanglement", () => {
    const meta = getBrassRepublicMetadata();
    expect(meta.gameId).toBe("kingdom.brass_republic");
    expect(meta.title).toBe("Brass Republic");
    expect(meta.canonicalLevel).toBe("level.colosseum");
    expect(meta.isVerified).toBe(false); // IMPLEMENTED ≠ VERIFIED
  });
});
