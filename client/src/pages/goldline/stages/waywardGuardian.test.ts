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

  it("re-engages after a missed slam and two-axis overworld knockback", () => {
    const encounter = new WaywardGuardianEncounter();
    const initialPlayer = { x: 900, y: 505 };
    let frame = encounter.current();
    for (let index = 0; index < 90 && !frame.struckPlayer; index += 1)
      frame = encounter.update(1 / 30, initialPlayer);
    expect(frame.struckPlayer).toBe(true);

    const knockedPlayer = { x: 854, y: 540 };
    let offeredAnotherParry = false;
    for (let index = 0; index < 180; index += 1) {
      frame = encounter.update(1 / 30, knockedPlayer);
      if (frame.canParry) {
        offeredAnotherParry = true;
        break;
      }
    }
    expect(offeredAnotherParry).toBe(true);
  });

  it("accepts a phone tap on the telegraph-to-slam frame boundary", () => {
    const encounter = new WaywardGuardianEncounter();
    const player = { x: 900, y: 505 };
    let frame = encounter.current();
    for (let index = 0; index < 60 && !frame.canParry; index += 1)
      frame = encounter.update(1 / 60, player);
    expect(frame.canParry).toBe(true);
    for (let index = 0; index < 60 && frame.state === "telegraph"; index += 1)
      frame = encounter.update(1 / 60, player);
    expect(frame.canParry).toBe(true);
    expect(encounter.parry(player)).toBe(true);
  });
});
