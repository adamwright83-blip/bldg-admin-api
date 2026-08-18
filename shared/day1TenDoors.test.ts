import { describe, expect, it } from "vitest";
import {
  DAY1_ARRIVAL_RADIUS_METERS,
  DAY1_TARGETS,
  day1CurrentTarget,
  day1IsComplete,
  day1OutcomeCounts,
  day1ProgressLabel,
  day1VisitedCount,
  decodeDay1Payload,
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

  it("truthfully labels exactly 6 as Greystar (Koreatown) and 4 as real, named others", () => {
    const greystar = DAY1_TARGETS.filter(target => target.isGreystar);
    const other = DAY1_TARGETS.filter(target => !target.isGreystar);
    expect(greystar.length).toBe(6);
    expect(other.length).toBe(4);
    for (const target of other) {
      expect(target.managerLabel).not.toBeNull();
      expect(target.isGreystar).toBe(false);
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

describe("arrival radius", () => {
  it("recognizes a position inside the radius as arrived", () => {
    const target = DAY1_TARGETS[0]!;
    // ~150m north — inside the 250m radius.
    const near = { lat: target.lat + 0.00135, lng: target.lng };
    expect(haversineMeters(near, target)).toBeLessThan(DAY1_ARRIVAL_RADIUS_METERS);
  });

  it("does not treat a mile away as arrived", () => {
    const target = DAY1_TARGETS[0]!;
    const far = { lat: target.lat + 0.02, lng: target.lng };
    expect(haversineMeters(far, target)).toBeGreaterThan(DAY1_ARRIVAL_RADIUS_METERS);
  });
});
