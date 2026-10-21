import { describe, expect, it } from "vitest";
import { describePacificWallTime, nextPacificSlot } from "./letterDeskSchedule";

describe("Letter Desk Pacific send slots", () => {
  it("after midnight, 10:00 AM is this morning, not the day after", () => {
    // Tue 2026-10-20 02:12 PDT
    const slot = nextPacificSlot(10, 0, new Date("2026-10-20T09:12:00Z"));
    expect(slot).toEqual({ value: "2026-10-20T10:00", dayWord: "Today", label: "Tue, Oct 20 · 10:00 AM" });
  });

  it("once 10:00 AM has passed, it is tomorrow", () => {
    // Mon 2026-10-19 21:19 PDT
    const slot = nextPacificSlot(10, 0, new Date("2026-10-20T04:19:00Z"));
    expect(slot).toEqual({ value: "2026-10-20T10:00", dayWord: "Tomorrow", label: "Tue, Oct 20 · 10:00 AM" });
    expect(nextPacificSlot(14, 0, new Date("2026-10-20T04:19:00Z")).label).toBe("Tue, Oct 20 · 2:00 PM");
  });

  it("crosses month ends and labels exact wall times", () => {
    expect(nextPacificSlot(10, 0, new Date("2026-11-01T01:00:00Z")).value).toBe("2026-11-01T10:00"); // Oct 31 18:00 PDT
    expect(describePacificWallTime("2026-12-31T23:30")).toBe("Thu, Dec 31 · 11:30 PM");
    expect(describePacificWallTime("2026-10-21T00:05")).toBe("Wed, Oct 21 · 12:05 AM");
    // a stored instant is shown in Pacific time
    expect(describePacificWallTime("2026-10-20T17:00:00.000Z")).toBe("Tue, Oct 20 · 10:00 AM");
  });
});
