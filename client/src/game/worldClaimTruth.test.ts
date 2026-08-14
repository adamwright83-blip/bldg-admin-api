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
    expect(source).toContain("NO ACTIVE OBJECTIVE");
    expect(source).toContain("No unresolved route work right now.");
    // The truthful-objective branch must actually check for a real mission
    // or order, not just render unconditionally.
    expect(source).toMatch(
      /activeMission \|\| nextOrderObjective \?[\s\S]{0,200}FOLLOW THE GOLD LINE/
    );
  });
});
