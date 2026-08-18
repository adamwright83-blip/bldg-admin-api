import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A real Android player saw "ENCOUNTER PREP REVEALED" and "MOVE TO NEXT
 * ACTION ZONE" while the header simultaneously showed "NO ACTIVE MISSION"
 * — both messages were derived from lane/progress state or "nothing is
 * currently clickable", never from whether a genuine objective actually
 * exists. Regression guard against either claim becoming context-free
 * again.
 */
describe("Goldline world-claim truth boundary", () => {
  const source = readFileSync(
    new URL("./GoldlineGameHome.tsx", import.meta.url),
    "utf8"
  );

  it("ENCOUNTER PREP REVEALED requires a genuine active mission in at least visible proximity, not just lane+progress", () => {
    expect(source).not.toMatch(
      /branch === "intel" && progress > 0\.38[\s\S]{0,80}ENCOUNTER PREP REVEALED/
    );
    expect(source).toMatch(
      /activeMission && missionSpatialState !== "hidden"[\s\S]{0,80}ENCOUNTER PREP REVEALED/
    );
  });

  it("MOVE TO NEXT ACTION ZONE no longer renders unconditionally whenever no action is available", () => {
    // The literal phrase must not exist at all — it implied a findable zone
    // regardless of whether one exists.
    expect(source).not.toContain("MOVE TO NEXT ACTION ZONE");
  });

  it("the no-action state distinguishes 'a real objective exists, keep moving' from 'nothing exists right now'", () => {
    expect(source).toContain("FOLLOW THE GOLD LINE");
    // The truthful-objective branch must actually check for a real mission,
    // order, or approved objective — not render unconditionally.
    //
    // PR #71 added `preparedObjective` as a third genuine source (a pending,
    // human-approved Open Channel task) and this regex, which named only the
    // first two, started failing. The guard itself was never wrong: it is
    // still asserting that the branch is gated on real work existing. All
    // three sources are named explicitly rather than loosened to a wildcard,
    // so a future edit that drops the condition entirely still fails here.
    expect(source).toMatch(
      /activeMission \|\| nextOrderObjective \|\| preparedObjective \?[\s\S]{0,200}FOLLOW THE GOLD LINE/
    );
  });

  /**
   * §R1 Workstream 2. "NO ACTIVE OBJECTIVE / No unresolved route work right
   * now" was itself a dead end — a truthful but useless statement of
   * absence. R1 replaces it with the day-assembly front door: when the day
   * genuinely has zero assembled work, Goldline offers the three real ways
   * to give it work instead of just reporting that there is none.
   */
  it("the old context-free dead end is gone, replaced by the day-assembly front door gated on the same emptiness", () => {
    expect(source).not.toContain("NO ACTIVE OBJECTIVE");
    expect(source).not.toContain("No unresolved route work right now.");
    expect(source).toContain("day-assembly-front-door");
    expect(source).toContain("IMPORT TODAY FROM CLEANCLOUD");
    expect(source).toContain("ADD OTHER STOPS");
    expect(source).toMatch(/dayIsEmpty \?[\s\S]{0,400}day-assembly-front-door/);
  });
});
