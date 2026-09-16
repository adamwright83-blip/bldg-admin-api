import { describe, expect, it } from "vitest";
import { composeCompletion, resolveReachedBeats } from "../../shared/fictionPack";
import { BIO_CONTAINMENT_PACK } from "./bioContainment";
import { getFictionPack, getLatestFictionPack } from "./fictionPackRegistry";

describe("bio_containment", () => {
  it("loads and validates at module load", () => {
    expect(BIO_CONTAINMENT_PACK.id).toBe("bio_containment");
  });

  it("is resolvable by the exact version a run freezes against", () => {
    expect(getFictionPack("bio_containment", 1)).not.toBeNull();
    expect(getFictionPack("bio_containment", 99)).toBeNull();
    expect(getLatestFictionPack("bio_containment")?.version).toBe(1);
  });

  it("wears a 24-target run and an 8-target run identically", () => {
    const at24 = resolveReachedBeats(BIO_CONTAINMENT_PACK, 18 / 24, {
      count: "18",
      total: "24",
      remaining: "6",
    });
    const at8 = resolveReachedBeats(BIO_CONTAINMENT_PACK, 6 / 8, {
      count: "6",
      total: "8",
      remaining: "2",
    });
    expect(at24.map(beat => beat.id)).toEqual(at8.map(beat => beat.id));
  });

  it("never blames the operator in any tempo tail", () => {
    const banned = /\byou were\b|\byou let\b|because of you|too slow|failed/i;
    for (const tail of Object.values(BIO_CONTAINMENT_PACK.tempoTails)) {
      expect(tail).not.toMatch(banned);
    }
  });

  it("gives the same victory line after one session and after twenty", () => {
    const slots = { count: "24", total: "24", remaining: "0" };
    const fast = composeCompletion(
      BIO_CONTAINMENT_PACK,
      { sessionCount: 1, largestGapDays: 0 },
      slots
    );
    const slow = composeCompletion(
      BIO_CONTAINMENT_PACK,
      { sessionCount: 20, largestGapDays: 34 },
      slots
    );
    expect(fast.victory).toBe(slow.victory);
    expect(fast.tier).toBe("clean_break");
    expect(slow.tier).toBe("gone_to_ground");
  });
});
