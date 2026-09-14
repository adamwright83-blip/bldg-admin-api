import { describe, expect, it } from "vitest";
import { CLAIRE_ATTESTABLE_EVENT_TYPES } from "./relationshipEmitters";

describe("attestable event surface never includes the automatic-only categories", () => {
  it("excludes operator_follow_through, shared_hard_win, and shared_failure", () => {
    expect(CLAIRE_ATTESTABLE_EVENT_TYPES).not.toContain("operator_follow_through");
    expect(CLAIRE_ATTESTABLE_EVENT_TYPES).not.toContain("shared_hard_win");
    expect(CLAIRE_ATTESTABLE_EVENT_TYPES).not.toContain("shared_failure");
  });

  it("covers every judgment-based event type the relationship policy can reference", () => {
    expect(CLAIRE_ATTESTABLE_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "operator_owned_mistake",
        "operator_respected_boundary",
        "operator_ignored_boundary",
        "claire_admitted_error",
        "claire_disclosure",
        "operator_handled_disclosure_well",
        "operator_handled_disclosure_poorly",
      ])
    );
  });
});
