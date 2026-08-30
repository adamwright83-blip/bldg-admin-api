import { describe, expect, it } from "vitest";
import {
  LADDER_DEPTHS,
  commercialAccessCopy,
  commercialAccessFor,
  fieldShape,
  MAX_FIELD_UNITS,
  projectOccupancyField,
  projectSiegeLadder,
  residentTerritoryCopy,
  residentTerritoryFor,
  winOpenedTheBoard,
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

  it("refuses a denominator too large to be a building", () => {
    // A config typo must degrade, not allocate and sort millions of cells.
    expect(
      projectOccupancyField({
        totalUnits: MAX_FIELD_UNITS + 1,
        denominatorVerified: true,
        signups: 1,
        paidResidents: 1,
      })
    ).toBeNull();
    // The real denominators stay comfortably inside the cap.
    expect(576).toBeLessThan(MAX_FIELD_UNITS);
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

describe("the two axes are independent", () => {
  it("reads commercial access from the siege depth alone", () => {
    expect(commercialAccessFor(null)).toBe("no_mission");
    expect(commercialAccessFor("unsighted")).toBe("sealed");
    expect(commercialAccessFor("at_the_door")).toBe("sealed");
    expect(commercialAccessFor("inside")).toBe("inside");
    expect(commercialAccessFor("held")).toBe("held");
    expect(commercialAccessFor("closed")).toBe("closed");
  });

  it("reads resident territory from the access reason alone", () => {
    expect(
      residentTerritoryFor({ hasField: false, access: "commercial_win" })
    ).toBe("none");
    expect(
      residentTerritoryFor({ hasField: true, access: "commercial_win" })
    ).toBe("unlocked_by_win");
    expect(
      residentTerritoryFor({ hasField: true, access: "preexisting_residents" })
    ).toBe("active_preexisting");
  });

  /**
   * The case this whole split exists for: Century Park East today. A sealed
   * commercial approach must not imply the resident board is unavailable.
   */
  it("allows a sealed account alongside an already-active resident board", () => {
    const access = commercialAccessFor("at_the_door");
    const territory = residentTerritoryFor({
      hasField: true,
      access: "preexisting_residents",
    });
    expect(access).toBe("sealed");
    expect(territory).toBe("active_preexisting");
    expect(commercialAccessCopy(access).label).toBe("Sealed");
    expect(residentTerritoryCopy(territory).label).toBe(
      "Active — pre-existing"
    );
  });

  it("never claims a win opened a board that predates the mission", () => {
    expect(winOpenedTheBoard("active_preexisting")).toBe(false);
    expect(winOpenedTheBoard("none")).toBe(false);
    expect(winOpenedTheBoard("unlocked_by_win")).toBe(true);
    expect(residentTerritoryCopy("active_preexisting").detail).toContain(
      "predate any commercial mission"
    );
  });

  it("says winning opened the board without saying it finished anything", () => {
    expect(residentTerritoryCopy("unlocked_by_win").detail).toContain(
      "not the end of anything"
    );
  });

  it("distinguishes being inside from having won", () => {
    expect(commercialAccessCopy("inside").detail).toContain("Not won yet");
    expect(commercialAccessCopy("held").detail).toContain("held");
  });

  it("never describes a whole building with a single verdict", () => {
    // Each copy function may only speak about its own axis.
    for (const state of ["sealed", "inside", "held", "closed", "no_mission"] as const) {
      const detail = commercialAccessCopy(state).detail.toLowerCase();
      expect(detail).not.toContain("resident");
    }
    for (const state of ["none", "active_preexisting", "unlocked_by_win"] as const) {
      const label = residentTerritoryCopy(state).label.toLowerCase();
      expect(label).not.toContain("sealed");
    }
  });
});

describe("enrolled total is reported without double counting", () => {
  const field = projectOccupancyField({
    totalUnits: 428,
    denominatorVerified: true,
    signups: 61,
    paidResidents: 34,
  })!;

  it("sums paying plus signup-only", () => {
    expect(field.totalEnrolled).toBe(61);
    expect(field.paidResidents + field.signupsOnly).toBe(field.totalEnrolled);
  });

  it("keeps the enrolled figure out of the field bands", () => {
    // Three bands only; totalEnrolled must never become a fourth.
    const bandTotal =
      field.paidResidents + field.signupsOnly + field.unclaimed;
    expect(bandTotal).toBe(field.totalUnits);
    expect(field.cells).toHaveLength(field.totalUnits);
  });
});
