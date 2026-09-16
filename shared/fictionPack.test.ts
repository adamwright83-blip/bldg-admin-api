import { describe, expect, it } from "vitest";
import {
  composeCompletion,
  findBusinessNouns,
  gradeTempo,
  renderSlots,
  resolveIncompleteCopy,
  resolveReachedBeats,
  validateFictionPack,
  TEMPO_TIERS,
  type FictionPack,
} from "./fictionPack";

function pack(overrides: Partial<FictionPack> = {}): FictionPack {
  return {
    id: "test_pack",
    version: 1,
    role: "field agent",
    premise: "Something is wrong in the district.",
    briefing: "Bring the field online.",
    objectiveLabels: {
      unit: "detector",
      unitPlural: "detectors",
      action: "deploy",
      grid: "containment grid",
    },
    progressBeats: [
      {
        id: "quarter",
        atFraction: 0.25,
        text: "{count} ACTIVE. Coverage insufficient.",
        requires: ["count"],
      },
      {
        id: "half",
        atFraction: 0.5,
        text: "{count} of {total} ACTIVE.",
        requires: ["count", "total"],
      },
    ],
    proofFraming: "Confirm each one as you place it.",
    victoryBeat: "GRID COMPLETE. The district is clear.",
    tempoTails: {
      clean_break: "They had him at the perimeter.",
      wounded: "They took the site. He had already burned the ledgers.",
      gone_to_ground: "The site was cold. He had moved days earlier.",
    },
    echoPresentation: "{count} holding. {remaining} dark.",
    failureSequence: null,
    visualTheme: {},
    audioTheme: {},
    ...overrides,
  };
}

describe("validateFictionPack", () => {
  it("accepts a lawful pack", () => {
    expect(() => validateFictionPack(pack())).not.toThrow();
  });

  it("rejects a beat that fires outside (0, 1] — packs never know counts", () => {
    expect(() =>
      validateFictionPack(
        pack({
          progressBeats: [
            { id: "ten", atFraction: 10, text: "ten placed", requires: [] },
          ],
        })
      )
    ).toThrow(/fraction/);
  });

  it("rejects a pack that hardcodes a business noun", () => {
    expect(() =>
      validateFictionPack(
        pack({ briefing: "Hang every door hanger before sunrise." })
      )
    ).toThrow(/business nouns/);
  });

  it("rejects a beat requiring a slot it never renders", () => {
    expect(() =>
      validateFictionPack(
        pack({
          progressBeats: [
            { id: "x", atFraction: 0.5, text: "halfway", requires: ["count"] },
          ],
        })
      )
    ).toThrow(/never renders/);
  });

  it("requires an echo for every pack — incomplete work is held ground", () => {
    expect(() => validateFictionPack(pack({ echoPresentation: "" }))).toThrow(
      /echo/
    );
  });

  it("finds business nouns anywhere in the pack, including tempo tails", () => {
    expect(
      findBusinessNouns(
        pack({ tempoTails: { ...pack().tempoTails, wounded: "The plumber escaped." } })
      )
    ).toContain("plumber");
  });
});

describe("renderSlots", () => {
  it("refuses rather than rendering a hole", () => {
    expect(renderSlots("{count} ACTIVE", ["count"], {})).toBeNull();
  });

  it("renders when every required slot is present", () => {
    expect(renderSlots("{count} ACTIVE", ["count"], { count: "7" })).toBe(
      "7 ACTIVE"
    );
  });
});

describe("resolveReachedBeats", () => {
  it("fires by fraction, identically for an 8-target and a 60-target run", () => {
    const small = resolveReachedBeats(pack(), 6 / 8, { count: "6", total: "8" });
    const large = resolveReachedBeats(pack(), 45 / 60, {
      count: "45",
      total: "60",
    });
    expect(small.map(beat => beat.id)).toEqual(large.map(beat => beat.id));
    expect(small.map(beat => beat.id)).toEqual(["quarter", "half"]);
  });

  it("drops a beat whose slots cannot be filled instead of showing a hole", () => {
    const beats = resolveReachedBeats(pack(), 1, { count: "8" });
    expect(beats.map(beat => beat.id)).toEqual(["quarter"]);
  });
});

describe("tempo grading", () => {
  it("returns a win at every cadence — there is no failing tier", () => {
    const tiers = [
      gradeTempo({ sessionCount: 1, largestGapDays: 0 }),
      gradeTempo({ sessionCount: 4, largestGapDays: 5 }),
      gradeTempo({ sessionCount: 12, largestGapDays: 40 }),
    ];
    expect(tiers).toEqual(["clean_break", "wounded", "gone_to_ground"]);
    for (const tier of tiers) expect(TEMPO_TIERS).toContain(tier);
  });

  it("gives a byte-identical victory line at every tempo", () => {
    const slots = { count: "24", total: "24", remaining: "0" };
    const victories = [
      composeCompletion(pack(), { sessionCount: 1, largestGapDays: 0 }, slots),
      composeCompletion(pack(), { sessionCount: 4, largestGapDays: 6 }, slots),
      composeCompletion(pack(), { sessionCount: 20, largestGapDays: 35 }, slots),
    ];
    expect(new Set(victories.map(entry => entry.victory)).size).toBe(1);
    expect(new Set(victories.map(entry => entry.tail)).size).toBe(3);
  });
});

describe("resolveIncompleteCopy", () => {
  it("defaults to an echo, not a failure", () => {
    const result = resolveIncompleteCopy(
      pack(),
      { campaignHasFailureCondition: false, failureConditionMet: false },
      { count: "10", remaining: "14" }
    );
    expect(result.kind).toBe("echo");
    expect(result.text).toBe("10 holding. 14 dark.");
  });

  it("stays an echo even when a failure sequence exists, absent a real condition", () => {
    const result = resolveIncompleteCopy(
      pack({ failureSequence: "The window closed." }),
      { campaignHasFailureCondition: false, failureConditionMet: true },
      { count: "10", remaining: "14" }
    );
    expect(result.kind).toBe("echo");
  });

  it("uses the failure sequence only when the campaign declares a real one", () => {
    const result = resolveIncompleteCopy(
      pack({ failureSequence: "The window closed." }),
      { campaignHasFailureCondition: true, failureConditionMet: true },
      { count: "10", remaining: "14" }
    );
    expect(result.kind).toBe("failure");
  });
});
