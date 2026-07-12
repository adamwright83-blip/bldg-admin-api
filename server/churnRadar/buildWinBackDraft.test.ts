import { describe, expect, it } from "vitest";
import { buildWinBackDraft } from "./buildWinBackDraft";

const score = {
  customerKey: "sarah",
  customerName: "Sarah Johnson",
  score: 88,
  grade: "high" as const,
  expectedCadenceDays: 14,
  daysSinceLastOrder: 74,
  daysLate: 60,
  averageOrderValueCents: 8600,
  estimatedMonthlyImpactCents: 18400,
  recentVolumeChangePct: -40,
  reasons: ["Order cadence slowed"],
  recommendedAction: "contact_now" as const,
};

describe("buildWinBackDraft", () => {
  it("uses only grounded facts and requires human approval", () => {
    const draft = buildWinBackDraft({
      score,
      storeName: "Sunset Laundry",
      senderName: "Adam",
      lastServiceLabel: "fluff-and-fold",
    });

    expect(draft.message).toContain("Sarah");
    expect(draft.message).toContain("74 days");
    expect(draft.message).toContain("fluff-and-fold");
    expect(draft.requiresHumanApproval).toBe(true);
    expect(draft.message.length).toBeLessThanOrEqual(320);
    expect(draft.message).not.toMatch(/free|discount|% off/i);
  });

  it("includes an unresolved issue only when supplied", () => {
    const draft = buildWinBackDraft({
      score,
      storeName: "Sunset Laundry",
      senderName: "Adam",
      unresolvedIssueSummary: "the missing pillowcase question",
    });

    expect(draft.message).toContain("missing pillowcase question");
    expect(draft.factsUsed.join(" ")).toContain("unresolved issue");
  });
});
