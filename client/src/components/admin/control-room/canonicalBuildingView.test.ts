import { describe, expect, it } from "vitest";
import {
  LADDER_DEPTHS,
  fieldShape,
  isHeld,
  phaseHeadline,
  projectOccupancyField,
  projectSiegeLadder,
} from "./canonicalBuildingView";

describe("the siege ladder", () => {
  it("excludes closed, which is an exit rather than a depth", () => {
    expect(LADDER_DEPTHS).not.toContain("closed");
    expect(LADDER_DEPTHS[0]).toBe("unsighted");
    expect(LADDER_DEPTHS.at(-1)).toBe("held");
  });

  it("marks everything up to the current depth as reached", () => {
    const rungs = projectSiegeLadder("at_the_door");
    const reached = rungs.filter(r => r.reached).map(r => r.depth);
    expect(reached).toEqual([
      "unsighted",
      "sighted",
      "briefed",
      "reachable",
      "committed",
      "inbound",
      "at_the_door",
    ]);
  });

  it("names the lowest sealed rung as the next action", () => {
    const next = projectSiegeLadder("at_the_door").find(r => r.isNext)!;
    expect(next.depth).toBe("inside");
    expect(next.reached).toBe(false);
    expect(next.reachedBy).toBe("Get inside and talk");
  });

  it("has no next rung once the building is held", () => {
    const rungs = projectSiegeLadder("held");
    expect(rungs.every(r => r.reached)).toBe(true);
    expect(rungs.find(r => r.isNext)).toBeUndefined();
  });

  it("gives a lost mission no reached rungs at all", () => {
    const rungs = projectSiegeLadder("closed");
    expect(rungs.some(r => r.reached)).toBe(false);
    expect(rungs.find(r => r.isNext)!.depth).toBe("unsighted");
  });

  it("treats an unknown building as standing before the first rung", () => {
    const rungs = projectSiegeLadder(null);
    expect(rungs.some(r => r.reached)).toBe(false);
    expect(rungs.find(r => r.isNext)!.depth).toBe("unsighted");
  });

  it("marks exactly one current rung", () => {
    expect(
      projectSiegeLadder("reachable").filter(r => r.isCurrent)
    ).toHaveLength(1);
  });
});

describe("the occupancy field uses the real denominator", () => {
  it("draws one cell per real rentable unit at OPUS", () => {
    const field = projectOccupancyField({
      totalUnits: 428,
      denominatorVerified: true,
      signups: 61,
      paidResidents: 34,
    })!;
    expect(field.cells).toHaveLength(428);
    expect(field.cells.filter(c => c === "paid")).toHaveLength(34);
    // signups includes payers upstream, so the signed-up-only band is 61-34.
    expect(field.cells.filter(c => c === "signup")).toHaveLength(27);
    expect(field.unclaimed).toBe(428 - 61);
  });

  it("draws one cell per real rentable unit at Century Park East", () => {
    const field = projectOccupancyField({
      totalUnits: 576,
      denominatorVerified: true,
      signups: 10,
      paidResidents: 10,
    })!;
    expect(field.cells).toHaveLength(576);
    expect(field.signupsOnly).toBe(0);
    expect(field.unclaimed).toBe(566);
  });

  it("carries an unverified denominator through rather than hiding it", () => {
    const field = projectOccupancyField({
      totalUnits: 300,
      denominatorVerified: false,
      signups: 5,
      paidResidents: 2,
    })!;
    expect(field.denominatorVerified).toBe(false);
  });

  it("refuses to build a field from an unusable denominator", () => {
    expect(
      projectOccupancyField({
        totalUnits: 0,
        denominatorVerified: true,
        signups: 3,
        paidResidents: 1,
      })
    ).toBeNull();
    expect(projectOccupancyField(null)).toBeNull();
  });

  it("clamps bad data so the field can never over-fill", () => {
    const field = projectOccupancyField({
      totalUnits: 10,
      denominatorVerified: true,
      signups: 999,
      paidResidents: 999,
    })!;
    expect(field.cells).toHaveLength(10);
    expect(field.paidResidents).toBe(10);
    expect(field.signupsOnly).toBe(0);
    expect(field.unclaimed).toBe(0);
  });

  it("never renders negative bands from inconsistent counts", () => {
    // paid greater than signups should not produce a negative signup band.
    const field = projectOccupancyField({
      totalUnits: 100,
      denominatorVerified: true,
      signups: 3,
      paidResidents: 20,
    })!;
    expect(field.signupsOnly).toBe(0);
    expect(field.paidResidents).toBe(20);
    expect(field.unclaimed).toBe(80);
  });
});

describe("occupancy arrangement is presentation, counts are truth", () => {
  const input = {
    totalUnits: 428,
    denominatorVerified: true,
    signups: 61,
    paidResidents: 34,
  };

  it("is deterministic across renders", () => {
    expect(projectOccupancyField(input)).toEqual(projectOccupancyField(input));
  });

  it("scatters lit units rather than stacking them into a bar", () => {
    const field = projectOccupancyField(input)!;
    const litIndexes = field.cells
      .map((cell, index) => (cell === "paid" ? index : -1))
      .filter(index => index >= 0);
    // A solid leading block would mean the field reads as a progress bar.
    const contiguous = litIndexes.every((value, i) =>
      i === 0 ? value === 0 : value === litIndexes[i - 1]! + 1
    );
    expect(contiguous).toBe(false);
    // And they should span most of the structure, not cluster in one corner.
    expect(Math.max(...litIndexes)).toBeGreaterThan(field.totalUnits * 0.5);
  });

  it("shapes the field portrait so it reads as a tower", () => {
    const { columns, rows } = fieldShape(428);
    expect(rows).toBeGreaterThan(columns);
    expect(columns * rows).toBeGreaterThanOrEqual(428);
  });
});

describe("phase copy makes the hinge obvious", () => {
  it("says winning opened the doors without saying it finished anything", () => {
    expect(phaseHeadline("held_unpenetrated")).toBe(
      "The doors are open. Nobody inside is yours yet."
    );
    expect(phaseHeadline("held_penetrating")).toContain("board now");
  });

  it("distinguishes sealed prospect from active siege", () => {
    expect(phaseHeadline("prospect")).toContain("Not yet targeted");
    expect(phaseHeadline("under_siege")).toContain("working your way in");
  });

  it("treats both held phases as held", () => {
    expect(isHeld("held_unpenetrated")).toBe(true);
    expect(isHeld("held_penetrating")).toBe(true);
    expect(isHeld("under_siege")).toBe(false);
    expect(isHeld("closed")).toBe(false);
  });
});
