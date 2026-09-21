/**
 * The renderer phrases. It does not think.
 *
 * These tests fix the boundary: what the renderer may do to a ResponsePlan, and what
 * it may never add on its own.
 */

import { describe, expect, it } from "vitest";
import { assertRenderedFromPlan, renderWithCharacter } from "../response/characterRenderer";
import { mintCallControlGrant, mintPersonalDisclosureGrant } from "../executive/grants";
import { perceiveTurn } from "../perception/perceive";
import type { AttentionPlan } from "../contracts/attention";
import type { ResponsePlan, ResponseSegment } from "../contracts/responsePlan";

const attention: AttentionPlan = {
  lanes: ["business"],
  retrieve: ["workingMemory"],
  doNotRetrieve: [],
  boardEligible: false,
  pendingDisposition: "none",
  priorClaim: "none",
  continueOrderedQuery: false,
  rationale: [],
};

function plan(segments: ResponseSegment[]): ResponsePlan {
  return { perceivedTurn: perceiveTurn({ rawText: "x", completeness: "complete" }), attention, segments };
}

const fact: ResponseSegment = {
  type: "BusinessFactSegment",
  text: "Dana hasn't replied since Tuesday",
  evidence: [{ evidenceId: "ev-1" }],
  origin: "authoritative_reader",
};

const endCall: ResponseSegment = {
  type: "CallControlSegment",
  text: "Right — go",
  endCall: true,
  grant: mintCallControlGrant({
    endCall: true,
    basis: "operator_leave_taking",
    sourceTurnAssembledText: "I gotta go",
  }),
};

describe("the renderer phrases", () => {
  it("joins segment text into speakable prose", () => {
    const { speak } = renderWithCharacter(plan([fact]));
    expect(speak).toBe("Dana hasn't replied since Tuesday.");
  });

  it("puts business before leave-taking so a hangup never buries the answer", () => {
    const { speak, endCall: ends } = renderWithCharacter(plan([endCall, fact]));
    expect(speak.indexOf("Dana")).toBeLessThan(speak.indexOf("go"));
    expect(ends).toBe(true);
  });

  it("skips empty segments rather than emitting filler", () => {
    const { speak } = renderWithCharacter(plan([{ type: "ConversationalSegment", text: "   " }, fact]));
    expect(speak).toBe("Dana hasn't replied since Tuesday.");
  });

  it("reports the executive's call-control decision rather than making one", () => {
    expect(renderWithCharacter(plan([fact])).endCall).toBe(false);
    expect(renderWithCharacter(plan([fact, endCall])).endCall).toBe(true);
  });

  it("renders a personal disclosure alongside a business fact without dropping either", () => {
    const disclosure: ResponseSegment = {
      type: "PersonalDisclosureSegment",
      text: "Quiet weekend",
      grant: mintPersonalDisclosureGrant({ entitlementId: "e1", basis: "earned_rapport", rung: "1" }),
    };
    const { speak } = renderWithCharacter(plan([fact, disclosure]));
    expect(speak).toContain("Dana");
    expect(speak).toContain("Quiet weekend");
  });
});

describe("a model phraser is governed by the same boundary", () => {
  it("accepts phrasing that keeps every authored claim", () => {
    const { speak } = renderWithCharacter(plan([fact]), { surface: "voice" }, () =>
      "Dana hasn't replied since Tuesday — nothing since."
    );
    expect(speak).toContain("Dana hasn't replied since Tuesday");
  });

  it("discards phrasing that invents a number", () => {
    const { speak } = renderWithCharacter(plan([fact]), { surface: "voice" }, () =>
      "Dana hasn't replied since Tuesday, and there are 3 others waiting."
    );
    // Falls back to the deterministic rendering rather than speaking the invention.
    expect(speak).toBe("Dana hasn't replied since Tuesday.");
  });

  it("discards phrasing that drops an authored claim", () => {
    const { speak } = renderWithCharacter(plan([fact]), { surface: "voice" }, () => "All quiet.");
    expect(speak).toBe("Dana hasn't replied since Tuesday.");
  });

  it("a throwing phraser falls back rather than failing the turn", () => {
    const { speak } = renderWithCharacter(plan([fact]), { surface: "voice" }, () => {
      throw new Error("phraser unavailable");
    });
    expect(speak).toBe("Dana hasn't replied since Tuesday.");
  });

  it("a phraser cannot change the executive's call-control decision", () => {
    const { endCall } = renderWithCharacter(plan([fact]), { surface: "voice" }, () => "Dana hasn't replied since Tuesday. Bye.");
    expect(endCall).toBe(false);
  });
});

describe("the renderer does not think", () => {
  it("rejects a number the plan never authorised", () => {
    expect(() =>
      assertRenderedFromPlan(plan([fact]), "Dana hasn't replied since Tuesday. Revenue was $4,200.")
    ).toThrow(/introduced a number/);
  });

  it("rejects dropping authored content", () => {
    expect(() => assertRenderedFromPlan(plan([fact]), "All good.")).toThrow(/dropped authored/);
  });

  it("accepts its own faithful output", () => {
    const rendered = renderWithCharacter(plan([fact, endCall]));
    expect(() => assertRenderedFromPlan(plan([fact, endCall]), rendered.speak)).not.toThrow();
  });

  it("allows numbers that the plan itself already carried", () => {
    const withNumber: ResponseSegment = { ...fact, text: "Revenue was $4,200 across 12 orders" };
    const rendered = renderWithCharacter(plan([withNumber]));
    expect(() => assertRenderedFromPlan(plan([withNumber]), rendered.speak)).not.toThrow();
    expect(rendered.speak).toContain("4,200");
  });
});
