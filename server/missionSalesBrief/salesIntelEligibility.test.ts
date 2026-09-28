import { describe, expect, it, vi } from "vitest";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";

function teaching(overrides: Partial<SalesIntelTeaching>): SalesIntelTeaching {
  return {
    id: "t-1",
    sourceArtifactId: "src-1",
    transcriptId: "tr-1",
    teachingKey: "key-1",
    creatorName: "Someone",
    creatorHandle: null,
    category: "discovery",
    title: "Ask what stopped it",
    principle: "Find the real blocker before repeating the pitch.",
    whenToUse: ["When the real blocker is not yet known."],
    whenNotToUse: ["When the buyer already gave a clear next step."],
    exampleLanguage: [
      { kind: "paraphrased_principle", text: "Ask what stopped it before pitching again." },
    ],
    confidence: 0.9,
    extractionVersion: "v1",
    extractionProvider: "test",
    extractionModel: "test",
    promptVersion: "v1",
    transcriptStartMs: null,
    transcriptEndMs: null,
    reviewState: "accepted",
    reviewedBy: null,
    reviewedAt: null,
    version: 1,
    active: true,
    supersededAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as SalesIntelTeaching;
}

const mocks = vi.hoisted(() => ({ listAllAcceptedTeachings: vi.fn() }));
vi.mock("../salesIntel/salesIntelTeachingStore", () => ({
  listAllAcceptedTeachings: mocks.listAllAcceptedTeachings,
}));

import { listEligibleSalesIntel, selectRelevantSalesIntel } from "./salesIntelEligibility";

describe("B/C — eligibility gate excludes unreviewed and rejected/inactive intel", () => {
  it("excludes a teaching that is not accepted, even if the store returned it", async () => {
    mocks.listAllAcceptedTeachings.mockResolvedValue([
      teaching({ id: "accepted", reviewState: "accepted", active: true }),
      teaching({ id: "leaked-review-required", reviewState: "review_required", active: true }),
      teaching({ id: "leaked-rejected", reviewState: "rejected", active: true }),
      teaching({ id: "leaked-inactive", reviewState: "accepted", active: false }),
    ]);
    const eligible = await listEligibleSalesIntel();
    expect(eligible.map(t => t.id)).toEqual(["accepted"]);
  });
});

describe("D — one-framework-maximum relevance selection", () => {
  it("returns null when nothing eligible materially fits the situation", () => {
    const result = selectRelevantSalesIntel({
      eligible: [teaching({ category: "closing" })],
      situationText: "the account already loved the pitch, we just need to know why it stalled",
    });
    expect(result).toBeNull();
  });

  it("selects exactly one teaching when it materially fits", () => {
    const result = selectRelevantSalesIntel({
      eligible: [teaching({ category: "discovery" })],
      situationText: "we don't know why the deal stalled, need to find out the blocker",
    });
    expect(result?.teachingId).toBe("t-1");
    expect(result?.principle).toMatch(/real blocker/i);
    expect(result?.exampleLanguage).toContain(
      "Ask what stopped it before pitching again."
    );
  });

  it("never returns more than one, even with several matching candidates", () => {
    const eligible = [
      teaching({ id: "a", category: "discovery", confidence: 0.5 }),
      teaching({ id: "b", category: "objection_handling", confidence: 0.99 }),
    ];
    const result = selectRelevantSalesIntel({
      eligible,
      situationText: "why did the deal stall, is it a price objection or a blocker",
    });
    expect(result).not.toBeNull();
    expect(typeof result?.teachingId).toBe("string");
  });
});
