import { describe, expect, it } from "vitest";
import { classifyDayDirectorKind, isHousekeepingUtterance, isTomorrowPrepUtterance } from "./workdayCommandKind";

describe("bundled Day Director kind classification", () => {
  it("classifies Zeely / commercial sales work as growth", () => {
    expect(
      classifyDayDirectorKind(
        "Monday's priority is finishing the Zeely static Instagram ad, sending it to my collaborator for approval"
      )
    ).toBe("growth");
  });

  it("classifies tomorrow clothes and collateral as prep", () => {
    expect(classifyDayDirectorKind("wash my jacket, dress shirt and jeans for tomorrow")).toBe("prep");
    expect(classifyDayDirectorKind("print tomorrow's collateral")).toBe("prep");
    expect(isTomorrowPrepUtterance("print tomorrow's collateral")).toBe(true);
  });

  it("classifies JETRO, cash register, and bathroom as operations, with bathroom flagged housekeeping", () => {
    expect(classifyDayDirectorKind("drive to JETRO")).toBe("operations");
    expect(classifyDayDirectorKind("find a cash register under $100")).toBe("operations");
    expect(classifyDayDirectorKind("clean my bathroom for an hour or two")).toBe("operations");
    expect(isHousekeepingUtterance("clean my bathroom for an hour or two")).toBe(true);
    expect(isHousekeepingUtterance("drive to JETRO")).toBe(false);
  });

  it("does not invent growth from ordinary route language", () => {
    expect(classifyDayDirectorKind("John — I'm picking him up and dropping him off now")).toBe("operations");
    expect(classifyDayDirectorKind("Lauren Jackson in Los Feliz")).toBe("operations");
  });
});
