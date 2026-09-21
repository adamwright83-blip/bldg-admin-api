import { describe, expect, it } from "vitest";
import { emptyWorkdayReconciliation, speakMorningCommandOpening, speakMorningReconciliationAsk } from "../../shared/claireWorkday";
import { demotePrimaryCommand, readCommandMetadata } from "../../shared/claireWorkdayCommand";

describe("Monday reconciliation lifecycle", () => {
  it("asks for missing pickups before locking the morning", () => {
    expect(speakMorningReconciliationAsk()).toMatch(/pickups or dropoffs/i);
  });

  it("starts unasked and only completes when marked", () => {
    const state = emptyWorkdayReconciliation();
    expect(state.status).toBe("not_started");
    expect(state.completedAt).toBeNull();
    const asked = { ...state, status: "asked" as const, askedAt: "2026-09-21T15:00:00.000Z" };
    expect(asked.status).not.toBe("complete");
    const complete = { ...asked, status: "complete" as const, completedAt: "2026-09-21T15:10:00.000Z" };
    expect(complete.status).toBe("complete");
    expect(speakMorningReconciliationAsk()).toBe(speakMorningReconciliationAsk());
    expect(
      speakMorningCommandOpening("morning_reconciliation", emptyWorkdayReconciliation(), [])
    ).toBe(speakMorningReconciliationAsk());
    expect(
      speakMorningCommandOpening(
        "morning_reconciliation",
        { status: "complete", askedAt: "t", completedAt: "t" },
        []
      )
    ).not.toBe(speakMorningReconciliationAsk());
  });
});

describe("sole primary demotion", () => {
  it("clears the previous primary role when the operator replaces it", () => {
    const previous = readCommandMetadata({
      command: { role: "primary", designatedBy: "operator", designatedAt: "2026-09-18T20:00:00.000Z" },
    });
    const demoted = demotePrimaryCommand(previous, "2026-09-21T15:00:00.000Z");
    expect(demoted.role).toBeNull();
    expect(demoted.demotedReason).toBe("replaced_by_operator");
    expect(demoted.demotedAt).toBe("2026-09-21T15:00:00.000Z");
  });
});
