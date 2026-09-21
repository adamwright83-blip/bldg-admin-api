/**
 * Corrections and proposals.
 *
 * A correction must be attributable to WHAT is being corrected — without letting a
 * pending item redefine an unrelated new utterance. A proposal must say what it is
 * proposing, or the operator cannot know what they are agreeing to.
 */

import { describe, expect, it } from "vitest";
import { decideTurn } from "../executive/decide";
import { proposalText, proposedWorkTitle } from "../executive/proposal";
import { perceiveTurn } from "../perception/perceive";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";

const CTX = {
  conversationKey: "claire-call:correction",
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
};

function perceive(text: string) {
  return perceiveTurn({ rawText: text, completeness: "complete" });
}

function withPending() {
  return snapshotWorkingMemory({ pendingBriefing: { parsed: { items: [{}] }, createdAt: 1 } }, CTX);
}

describe("correction target is identified, not guessed", () => {
  it("a correctness challenge targets the prior claim", () => {
    expect(perceive("Are you sure?").correctionTarget).toBe("prior_claim");
    expect(perceive("Check that again.").correctionTarget).toBe("prior_claim");
  });

  it("a provenance question targets the prior claim", () => {
    expect(perceive("Where did that number come from?").correctionTarget).toBe("prior_claim");
  });

  it("a correction naming an anchor targets the prior query", () => {
    const perceived = perceive("No, I meant the four before Thomas.");
    expect(perceived.correction).toBe(true);
    expect(perceived.correctionTarget).toBe("prior_query");
  });

  it("an exclusion correction targets the prior query", () => {
    const perceived = perceive("No, not Thomas.");
    if (perceived.correction) expect(perceived.correctionTarget).toBe("prior_query");
  });

  it("a plain day revision targets the pending item", () => {
    const perceived = perceive("Wait, change Dana to Wednesday.");
    expect(perceived.correction).toBe(true);
    expect(perceived.correctionTarget).toBe("pending_item");
  });

  it("an utterance that is not a correction has no target", () => {
    expect(perceive("What were my last five sales?").correctionTarget).toBeNull();
    expect(perceive("Good morning.").correctionTarget).toBeNull();
  });
});

describe("pending state binds corrections without reinterpreting new speech", () => {
  it("'Wait, change Dana to Wednesday.' revises the pending item", async () => {
    const decision = await decideTurn(perceive("Wait, change Dana to Wednesday."), withPending());
    expect(decision.attention.pendingDisposition).toBe("revise");
  });

  it("'No, Wednesday.' revises rather than starting a new interpretation", async () => {
    const decision = await decideTurn(perceive("No, Wednesday."), withPending());
    expect(decision.attention.pendingDisposition).toBe("revise");
  });

  it("'No.' rejects and clears", async () => {
    const decision = await decideTurn(perceive("No."), withPending());
    expect(decision.attention.pendingDisposition).toBe("reject");
  });

  it("an unrelated business question supersedes instead of being absorbed", async () => {
    const decision = await decideTurn(
      perceive("Forget that. What were my last five sales?"),
      withPending()
    );
    expect(decision.attention.pendingDisposition).toBe("supersede");
    expect(decision.attention.lanes).toContain("business");
  });

  it("a hanging pending does not reinterpret a greeting", async () => {
    const decision = await decideTurn(perceive("Good morning."), withPending());
    expect(decision.attention.pendingDisposition).not.toBe("confirm");
  });
});

describe("a proposal says what it is proposing", () => {
  it("derives the work from the operator's own words", () => {
    expect(proposedWorkTitle(perceive("I need to call Dana Tuesday."))).toBe("Call Dana Tuesday");
  });

  it("handles other commitment phrasings", () => {
    expect(proposedWorkTitle(perceive("I should email Marcus tomorrow."))).toBe("Email Marcus tomorrow");
    expect(proposedWorkTitle(perceive("Remind me to send the quote Friday."))).toBe("Send the quote Friday");
  });

  it("takes the committing clause out of a mixed utterance", () => {
    expect(proposedWorkTitle(perceive("Dana hasn't replied, but I need to call her Tuesday."))).toBe(
      "Call her Tuesday"
    );
  });

  it("invents nothing when there is no work to name", () => {
    expect(proposedWorkTitle(perceive("Good morning."))).toBeNull();
    expect(proposalText(null)).toBe("Want me to put that on your Day Line?");
  });

  it("the plan carries an understandable ask, not empty text", async () => {
    const decision = await decideTurn(
      perceive("I need to call Dana Tuesday."),
      snapshotWorkingMemory({}, CTX)
    );
    const proposal = decision.responsePlan.segments.find(s => s.type === "ActionProposalSegment");
    expect(proposal).toBeDefined();
    expect(proposal?.text).toContain("Call Dana Tuesday");
    expect(proposal?.text.trim().length).toBeGreaterThan(10);
  });

  it("the grant records what was proposed, and still cannot mutate", async () => {
    const decision = await decideTurn(
      perceive("I need to call Dana Tuesday."),
      snapshotWorkingMemory({}, CTX)
    );
    const grant = decision.actionGrants[0];
    expect(grant.scope.titles).toEqual(["Call Dana Tuesday"]);
    expect(grant.constraints.mutationAllowed).toBe(false);
    expect(grant.constraints.shadowOnly).toBe(true);
  });

  it("a refusal produces no proposal at all", async () => {
    const decision = await decideTurn(perceive("No, don't do that."), withPending());
    expect(decision.responsePlan.segments.some(s => s.type === "ActionProposalSegment")).toBe(false);
  });
});
