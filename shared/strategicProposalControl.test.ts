import { describe, expect, it } from "vitest";
import { parseStrategicProposalControl } from "./strategicProposalControl";
import { isClaireRoleFeedback } from "./claireRoleFeedback";
describe("prepared proposal authority cannot broaden conversational scope", () => {
  it.each([
    "Only add the second one.",
    "make item 2 a mission",
    "make the second item a mission",
  ])("binds %s to exactly item two", text => {
    expect(parseStrategicProposalControl(text)).toEqual({
      kind: "approve",
      selection: [2],
    });
  });
  it.each([
    "yes",
    "go ahead",
    "approve only the second one and all the others",
    "make that a mission",
    "move that mission next week",
  ])("withholds approval for ambiguous %s", text => {
    expect(parseStrategicProposalControl(text)?.kind).not.toBe("approve");
  });
  it("keeps an explicit new task outside the prepared-item protocol", () => {
    expect(
      parseStrategicProposalControl(
        "make Call Hudson about the invoice a mission"
      )
    ).toBeNull();
  });
  it("distinguishes tomorrow deferral from refusal", () => {
    expect(
      parseStrategicProposalControl("Not now. We'll discuss it tomorrow.")
    ).toEqual({ kind: "defer" });
    expect(
      parseStrategicProposalControl("No, I don't want to do that.")
    ).toEqual({ kind: "reject" });
  });
  it("admits direct responsibility feedback without granting work authority", () => {
    const text = "You should be preparing these decisions for me.";
    expect(isClaireRoleFeedback(text)).toBe(true);
    expect(parseStrategicProposalControl(text)).toBeNull();
    expect(
      isClaireRoleFeedback(
        "If you should be preparing these decisions for me, what would happen?"
      )
    ).toBe(false);
    expect(
      isClaireRoleFeedback(
        'She said "You should be preparing these decisions for me."'
      )
    ).toBe(false);
    expect(
      isClaireRoleFeedback("You should add that to the Day Line for work")
    ).toBe(false);
  });
});
