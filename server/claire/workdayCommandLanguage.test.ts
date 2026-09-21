import { describe, expect, it } from "vitest";
import {
  detectPrimaryDesignation,
  detectExternalPromisee,
  detectRecurrenceWeekday,
  detectUnknownCargoIdentity,
  detectReconciliationComplete,
  itemMatchesPrimary,
  resolveCommitmentBusinessDate,
} from "./workdayCommandLanguage";

describe("Daily Command operator language", () => {
  it("treats explicit priority language as primary and ignores mere importance", () => {
    expect(
      detectPrimaryDesignation(
        "Monday's priority is finishing the static Instagram ad in Zeely, sending it to Russell for approval"
      )
    ).toBe(true);
    expect(detectPrimaryDesignation("Make Zeely my mission Monday")).toBe(true);
    expect(detectPrimaryDesignation("That's the main thing tomorrow")).toBe(true);
    expect(detectPrimaryDesignation("I need to evaluate Zeely for Instagram ads")).toBe(false);
    expect(detectPrimaryDesignation("This is important")).toBe(false);
  });

  it("resolves Monday from Friday onto Monday, not Friday", () => {
    expect(
      resolveCommitmentBusinessDate(
        "Monday's priority is finishing the Zeely static Instagram ad",
        "2026-09-18"
      )
    ).toBe("2026-09-21");
  });

  it("keeps a same-day Monday designation on Monday", () => {
    expect(resolveCommitmentBusinessDate("Monday's priority is Zeely", "2026-09-21")).toBe("2026-09-21");
  });

  it("extracts an external promisee from operator-supplied language only", () => {
    expect(
      detectExternalPromisee("I told Russell I'd finish the ad today and send it to him for approval")
    ).toBe("Russell");
    expect(detectExternalPromisee("Maybe I'll work on the ad")).toBeNull();
  });

  it("requires explicit recurrence language", () => {
    expect(detectRecurrenceWeekday("John is a weekly Monday 8-9 pickup")).toBe("monday");
    expect(detectRecurrenceWeekday("John was here last Monday too")).toBeNull();
  });

  it("preserves unknown cargo identity", () => {
    expect(
      detectUnknownCargoIdentity(
        "I have another Century Park East dry-cleaning order in the car, but I can't remember the tenant's name"
      )
    ).toBe(true);
    expect(detectUnknownCargoIdentity("Sophia's dry cleaning is in the car")).toBe(false);
  });

  it("matches the designated subject inside a multi-item dump", () => {
    const utterance =
      "John pickup then bathroom then Monday's priority is finishing the Zeely static Instagram ad";
    expect(itemMatchesPrimary("Finish Zeely static ad", utterance)).toBe(true);
    expect(itemMatchesPrimary("Clean bathroom", utterance)).toBe(false);
    expect(itemMatchesPrimary("John pickup", utterance)).toBe(false);
  });

  it("detects a completed morning reconciliation", () => {
    expect(detectReconciliationComplete("That's all — nothing else on the line")).toBe(true);
    expect(detectReconciliationComplete("How much did John spend?")).toBe(false);
  });
});
