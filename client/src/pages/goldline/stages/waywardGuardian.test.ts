import { describe, expect, it } from "vitest";
import { WaywardGuardianEncounter } from "./waywardGuardian";

describe("Wayward tether guardian", () => {
  it("cannot be dismissed before its authored telegraph", () => {
    const encounter = new WaywardGuardianEncounter();
    expect(encounter.parry({ x: 890, y: 505 })).toBe(false);
    expect(encounter.current().state).toBe("default");
  });

  it("telegraphs, threatens a strike, and only then accepts the parry", () => {
    const encounter = new WaywardGuardianEncounter();
    const player = { x: 900, y: 505 };
    let frame = encounter.current();
    for (let index = 0; index < 30 && !frame.canParry; index += 1) {
      frame = encounter.update(1 / 30, player);
    }
    expect(frame.canParry).toBe(true);
    expect(encounter.parry(player)).toBe(true);
    expect(encounter.current().state).toBe("defeated");
  });
});
