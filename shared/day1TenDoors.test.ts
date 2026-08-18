import { describe, expect, it } from "vitest";
import {
  DAY1_ARRIVAL_ACCURACY_CAP_METERS,
  DAY1_TARGETS,
  day1CurrentTarget,
  day1IsComplete,
  day1OutcomeCounts,
  day1ProgressLabel,
  day1VisitedCount,
  decodeDay1Payload,
  effectiveArrivalRadiusMeters,
  encodeDay1Payload,
  haversineMeters,
  type Day1Target,
  type Day1TenDoorsPayload,
} from "./day1TenDoors";

function payloadWithOutcomes(
  outcomes: Record<string, "pitched" | "couldnt_reach">
): Day1TenDoorsPayload {
  return {
    kind: "day1_ten_doors",
    targets: DAY1_TARGETS as unknown as Day1Target[],
    outcomes,
  };
}

describe("DAY1_TARGETS — the hand-verified list", () => {
  it("has exactly 10 real properties", () => {
    expect(DAY1_TARGETS.length).toBe(10);
  });

  it("every target has a real name/address/coordinates/navigation URL", () => {
    for (const target of DAY1_TARGETS) {
      expect(target.name.length).toBeGreaterThan(0);
      expect(target.address.length).toBeGreaterThan(0);
      expect(Number.isFinite(target.lat)).toBe(true);
      expect(Number.isFinite(target.lng)).toBe(true);
      expect(target.navigationUrl.startsWith("https://www.google.com/maps/")).toBe(
        true
      );
    }
  });

  it("has unique, stable ids", () => {
    const ids = DAY1_TARGETS.map(target => target.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("truthfully labels exactly 7 as Greystar and 3 as real, named other managers", () => {
    const greystar = DAY1_TARGETS.filter(target => target.isGreystar);
    const other = DAY1_TARGETS.filter(target => !target.isGreystar);
    expect(greystar.length).toBe(7);
    expect(other.length).toBe(3);
    for (const target of other) {
      expect(target.managerLabel).not.toBeNull();
      expect(target.isGreystar).toBe(false);
    }
  });

  it("never includes an existing Laundry Butler account as a 'prospect' (Opus LA excluded)", () => {
    expect(DAY1_TARGETS.some(target => target.id === "opus-la")).toBe(false);
    expect(
      DAY1_TARGETS.some(target => target.name.toLowerCase() === "opus la")
    ).toBe(false);
  });

  it("matches the final operator-authoritative route order exactly", () => {
    expect(DAY1_TARGETS.map(target => target.id)).toEqual([
      "rise-koreatown",
      "avana-on-wilshire",
      "the-pearl-on-wilshire",
      "wilshire-vermont",
      "the-chadwick",
      "onsunset",
      "the-charlie-weho",
      "the-alfred",
      "blu-beverly-hills",
      "ninety9fifty5",
    ]);
  });

  it("every target carries a positive, tightened base arrival radius (~125m)", () => {
    for (const target of DAY1_TARGETS) {
      expect(target.arrivalRadiusMeters).toBe(125);
    }
  });
});

describe("day1 payload encode/decode", () => {
  it("round-trips through JSON", () => {
    const payload = payloadWithOutcomes({});
    const decoded = decodeDay1Payload(encodeDay1Payload(payload));
    expect(decoded?.targets.length).toBe(10);
  });

  it("never matches an ordinary task's free-text detail", () => {
    expect(decodeDay1Payload("Pick up dry cleaning from Mona")).toBeNull();
    expect(decodeDay1Payload("")).toBeNull();
  });

  it("never matches a LOCAL_TARGET_RUN payload (different kind)", () => {
    expect(
      decodeDay1Payload(
        JSON.stringify({ kind: "local_target_run", sourcedTargets: [] })
      )
    ).toBeNull();
  });
});

describe("day1 progress", () => {
  it("target 1 is current on a fresh mission", () => {
    const payload = payloadWithOutcomes({});
    expect(day1CurrentTarget(payload)?.id).toBe(DAY1_TARGETS[0]!.id);
    expect(day1ProgressLabel(payload)).toBe("TARGET 1 OF 10");
    expect(day1VisitedCount(payload)).toBe(0);
    expect(day1IsComplete(payload)).toBe(false);
  });

  it("I MADE THE PITCH advances 0/10 -> 1/10 and moves to the next target", () => {
    const first = DAY1_TARGETS[0]!;
    const second = DAY1_TARGETS[1]!;
    const payload = payloadWithOutcomes({ [first.id]: "pitched" });
    expect(day1VisitedCount(payload)).toBe(1);
    expect(day1CurrentTarget(payload)?.id).toBe(second.id);
    expect(day1ProgressLabel(payload)).toBe("TARGET 2 OF 10");
  });

  it("COULDN'T REACH THEM also advances the physical-visit count, distinctly from pitched", () => {
    const first = DAY1_TARGETS[0]!;
    const payload = payloadWithOutcomes({ [first.id]: "couldnt_reach" });
    expect(day1VisitedCount(payload)).toBe(1);
    const counts = day1OutcomeCounts(payload);
    expect(counts.pitched).toBe(0);
    expect(counts.couldntReach).toBe(1);
  });

  it("10/10 with a mixed real breakdown produces DAY 1 COMPLETE with no fabricated figures", () => {
    const outcomes: Record<string, "pitched" | "couldnt_reach"> = {};
    DAY1_TARGETS.forEach((target, index) => {
      outcomes[target.id] = index < 7 ? "pitched" : "couldnt_reach";
    });
    const payload = payloadWithOutcomes(outcomes);
    expect(day1IsComplete(payload)).toBe(true);
    expect(day1CurrentTarget(payload)).toBeNull();
    expect(day1ProgressLabel(payload)).toBeNull();
    const counts = day1OutcomeCounts(payload);
    expect(counts.pitched).toBe(7);
    expect(counts.couldntReach).toBe(3);
    expect(counts.pitched + counts.couldntReach).toBe(10);
  });
});

describe("arrival radius — GPS helps, never blocks", () => {
  it("recognizes a position inside a target's own tightened radius as arrived", () => {
    const target = DAY1_TARGETS[0]!; // 125m base radius
    const near = { lat: target.lat + 0.0005, lng: target.lng }; // ~55m
    expect(haversineMeters(near, target)).toBeLessThan(
      effectiveArrivalRadiusMeters(target, null)
    );
  });

  it("does not treat a mile away as arrived even with a generous accuracy reading", () => {
    const target = DAY1_TARGETS[0]!;
    const far = { lat: target.lat + 0.02, lng: target.lng };
    expect(haversineMeters(far, target)).toBeGreaterThan(
      effectiveArrivalRadiusMeters(target, 500)
    );
  });

  it("uses the same tightened base radius for every target now that coordinates are real rooftops", () => {
    const radii = new Set(DAY1_TARGETS.map(target => target.arrivalRadiusMeters));
    expect(radii.size).toBe(1);
    expect([...radii][0]).toBe(125);
  });

  it("folds device accuracy into the effective radius, capped so a noisy reading can't restore the old blanket radius", () => {
    const target = DAY1_TARGETS[0]!;
    const base = effectiveArrivalRadiusMeters(target, null);
    const withModestAccuracy = effectiveArrivalRadiusMeters(target, 40);
    const withHugeAccuracy = effectiveArrivalRadiusMeters(target, 5_000);
    expect(withModestAccuracy).toBe(base + 40);
    expect(withHugeAccuracy).toBe(base + DAY1_ARRIVAL_ACCURACY_CAP_METERS);
    expect(withHugeAccuracy).toBeLessThan(base + 250);
  });
});
