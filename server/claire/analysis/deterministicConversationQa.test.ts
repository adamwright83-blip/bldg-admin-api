import { describe, expect, it } from "vitest";
import type { ConversationTurn } from "../conversation/types";
import { deterministicConversationQa } from "./deterministicConversationQa";

function turns(lines: Array<["OPERATOR" | "CLAIRE", string]>): ConversationTurn[] {
  return lines.map(([speaker, text], index) => ({
    id: index + 1,
    sessionId: "s1",
    ordinal: index + 1,
    speaker,
    text,
    source: "test",
    idempotencyKey: `t-${index + 1}`,
    providerMetadata: null,
    occurredAt: new Date(2026, 8, 20, 10, index).toISOString(),
  }));
}

describe("deterministic Claire post-call QA", () => {
  it("flags the actual September failure classes without an evaluator model", () => {
    const findings = deterministicConversationQa(
      turns([
        ["OPERATOR", "What were my last five sales?"],
        ["CLAIRE", "Your latest paid sale was Thomas Hartmann."],
        ["OPERATOR", "What should I do about Dana Tuesday?"],
        ["CLAIRE", "GUMBALL is behind and Mission 6 needs a synthetic verification follow-up."],
        ["OPERATOR", "I'm good."],
        ["CLAIRE", "I can't verify that properly right now."],
      ])
    );
    expect(findings.map(finding => finding.category)).toEqual(
      expect.arrayContaining([
        "list_cardinality_collapsed",
        "targeted_question_route_contamination",
        "synthetic_artifact_leak",
        "acknowledgement_misrouted",
      ])
    );
  });

  it("flags a cleared proposal that resurfaces", () => {
    const findings = deterministicConversationQa(
      turns([
        ["OPERATOR", "Actually don't do that."],
        ["CLAIRE", "Okay. I won't add it."],
        ["OPERATOR", "What were yesterday's sales?"],
        ["CLAIRE", "I'm still holding your list; say yes when you want it on the Day Line."],
      ])
    );
    expect(findings.some(finding => finding.category === "cleared_proposal_reappeared")).toBe(true);
  });

  it("does not flag a clean acknowledgement or scoped advice response", () => {
    const findings = deterministicConversationQa(
      turns([
        ["OPERATOR", "What should I do about Dana Tuesday?"],
        ["CLAIRE", "The Louise has an open follow-up. Calling Dana Tuesday is reasonable."],
        ["OPERATOR", "I'm good."],
        ["CLAIRE", "All right."],
        ["OPERATOR", "I gotta go."],
        ["CLAIRE", "Drive safe."],
      ])
    );
    expect(findings).toEqual([]);
  });
});
