import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("internal proposal admin preview", () => {
  it("uses read-only proposal endpoints and exact truth language", () => {
    const source = readFileSync(new URL("./ProposalReviewPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("proposalReview.list.useQuery");
    expect(source).toContain("proposalReview.get.useQuery");
    expect(source).not.toContain("useMutation");
    for (const text of ["Available, not booked", "Approve HELD to try to book",
      "Nothing is confirmed until provider acceptance is verified", "Provider not accepted",
      "Not paid", "Not dispatched", "Not completed"]) expect(source).toContain(text);
  });

  it("does not expose raw JSON or execution CTAs", () => {
    const source = readFileSync(new URL("./ProposalReviewPage.tsx", import.meta.url), "utf8");
    expect(source).not.toMatch(/JSON\.stringify|job_card_snapshot_json|eligibility_decision_json|fit_decision_json/);
    expect(source).not.toMatch(/Confirm booking|Book now|Authorize payment|Dispatch now|Approve proposal/);
    expect(source).toContain("Fit sentence withheld");
    expect(source).toContain("Not ready for presentation");
  });
});
