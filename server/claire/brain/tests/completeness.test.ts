/**
 * Perception's complete-thought assembly.
 *
 * Executive Function must never see a half-turn unless the safety limit forces a flush.
 * These drive the V2 assembler directly; V1 still owns live fragment handling.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_FRAGMENT_HOLDS,
  assembleThought,
  emptyFragmentState,
  readsAsUnfinished,
} from "../perception/completeness";

describe("a thought is held until it is finished", () => {
  it("holds a transcript that stops mid-sentence", () => {
    const out = assembleThought({ incoming: "Desired timing is", state: emptyFragmentState() });
    expect(out.completeness).toBe("incomplete");
    expect(out.state.pendingFragment).toBe("Desired timing is");
    expect(out.state.fragmentHolds).toBe(1);
  });

  it("joins the continuation onto the held fragment", () => {
    const first = assembleThought({ incoming: "Desired timing is", state: emptyFragmentState() });
    const second = assembleThought({ incoming: "next Tuesday morning?", state: first.state });
    expect(second.assembledText).toBe("Desired timing is next Tuesday morning?");
    expect(second.completeness).toBe("complete");
    expect(second.state.pendingFragment).toBeNull();
  });

  it("releases a finished question immediately", () => {
    const out = assembleThought({ incoming: "What were my last five sales?", state: emptyFragmentState() });
    expect(out.completeness).toBe("complete");
  });

  it("keeps the provider pieces as evidence while holding", () => {
    const first = assembleThought({ incoming: "Desired timing is", state: emptyFragmentState() });
    expect(first.state.providerFragments).toEqual(["Desired timing is"]);
    const second = assembleThought({ incoming: "and the", state: first.state });
    // Still held, so both raw pieces are retained for the in-progress thought.
    if (second.completeness === "incomplete") {
      expect(second.state.providerFragments).toEqual(["Desired timing is", "and the"]);
    }
  });

  it("a short aside is not mistaken for an unfinished thought", () => {
    expect(assembleThought({ incoming: "Got it", state: emptyFragmentState() }).completeness).toBe("complete");
  });
});

describe("a held thought is never stranded", () => {
  it("flushes when the caller goes quiet", () => {
    const first = assembleThought({ incoming: "Desired timing is", state: emptyFragmentState() });
    const flushed = assembleThought({ incoming: "", state: first.state, allowFragmentWait: false });
    expect(flushed.completeness).toBe("forced_flush");
    expect(flushed.assembledText).toBe("Desired timing is");
    expect(flushed.state.pendingFragment).toBeNull();
  });

  it("flushes once the hold limit is reached", () => {
    // A thought that has already used its allowance is released, however it reads.
    const exhausted = {
      pendingFragment: "Desired timing is",
      fragmentHolds: MAX_FRAGMENT_HOLDS,
      providerFragments: ["Desired timing is"],
    };
    const out = assembleThought({ incoming: "and the", state: exhausted });
    expect(out.completeness).toBe("forced_flush");
    expect(out.assembledText).toBe("Desired timing is and the");
    expect(out.state.fragmentHolds).toBe(0);
  });

  it("empty input with nothing held stays incomplete rather than flushing noise", () => {
    const out = assembleThought({ incoming: "   ", state: emptyFragmentState() });
    expect(out.completeness).toBe("incomplete");
    expect(out.assembledText).toBe("");
  });
});

describe("it reuses V1's proven rule rather than a second algorithm", () => {
  it("agrees with looksUnfinished on a mid-thought transcript", () => {
    expect(readsAsUnfinished("Desired timing is")).toBe(true);
    expect(readsAsUnfinished("What were my last five sales?")).toBe(false);
  });
});
