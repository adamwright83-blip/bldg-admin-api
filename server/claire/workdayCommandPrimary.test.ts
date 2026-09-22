import { describe, expect, it } from "vitest";
import { decorateCommitmentProposal } from "./voiceCommitmentLoop";
import type { DayDirectorProposal } from "../../shared/dayDirector";

function proposal(): DayDirectorProposal {
  return {
    promptKey: "commitment:x",
    title: "Finish Zeely static Instagram ad",
    kind: "operations",
    quantity: null,
    sourceText: "Monday's priority is finishing the Zeely static Instagram ad, sending it to Russell for approval",
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
  };
}

describe("future-dated explicit primary", () => {
  it("binds Friday speech to Monday and marks it primary growth", () => {
    const decorated = decorateCommitmentProposal(
      proposal(),
      "Monday's priority is finishing the Zeely static Instagram ad, sending it to Russell for approval",
      "2026-09-18"
    );
    expect(decorated.targetBusinessDate).toBe("2026-09-21");
    expect(decorated.kind).toBe("growth");
    expect(decorated.command?.role).toBe("primary");
    expect(decorated.command?.promisedTo).toBe("Russell");
  });
});
