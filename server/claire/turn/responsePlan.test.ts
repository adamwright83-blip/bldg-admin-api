import { describe, expect, it } from "vitest";
import { interpretTurn } from "./interpretTurn";
import { planClaireResponse, renderClaireResponsePlan } from "./responsePlan";

describe("typed Claire response plan", () => {
  it("keeps business judgment separate from action authority", () => {
    const interpretation = interpretTurn("What should I do about Dana Tuesday?");
    const plan = planClaireResponse({
      text: "Call Dana Tuesday because the follow-up is overdue.",
      kind: "answered",
      interpretation,
    });
    expect(plan.segments).toEqual([
      { kind: "business_judgment", text: "Call Dana Tuesday because the follow-up is overdue." },
    ]);
    expect(plan.segments.some(segment => segment.kind === "action_proposal")).toBe(false);
    expect(renderClaireResponsePlan(plan)).toBe("Call Dana Tuesday because the follow-up is overdue.");
  });

  it("classifies an authorized proposal as action-only rather than business truth", () => {
    const interpretation = interpretTurn("I need to call Dana Tuesday.");
    const plan = planClaireResponse({
      text: "Want me to put that on the Day Line?",
      kind: "follow_up_proposed",
      interpretation,
    });
    expect(plan.segments[0]?.kind).toBe("action_proposal");
    expect(plan.actionAuthorityDecidedUpstream).toBe(true);
  });

  it("represents factual queries and call control independently", () => {
    const interpretation = interpretTurn("What were my last five sales?");
    const fact = planClaireResponse({ text: "Five sales.", kind: "answered", interpretation });
    expect(fact.segments[0]?.kind).toBe("business_fact");

    const leaving = interpretTurn("I gotta go.");
    const end = planClaireResponse({ text: "Drive safe.", kind: "answered", interpretation: leaving, endCall: true });
    expect(end.segments.some(segment => segment.kind === "call_control")).toBe(true);
  });
});
