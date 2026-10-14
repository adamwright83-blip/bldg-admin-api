import { describe, expect, it } from "vitest";
import { coverageVerdict } from "./sourceBindings";

describe("coverage verdict: payment proof vs readability", () => {
  const base = {
    required: ["laundry_butler", "cleancloud"] as const,
    evidence: {} as never,
    // Production shape after the Oct 14 restore: both loaded, both flagged for missing receipts.
    loadedSources: ["laundry_butler", "cleancloud"] as const,
    failedSources: ["laundry_butler", "cleancloud"] as const,
  };
  it("revenue claims still treat unverified payment sources as unreadable", () => {
    expect(coverageVerdict({ ...base, required: [...base.required], loadedSources: [...base.loadedSources], failedSources: [...base.failedSources] }).kind).toBe("unreadable");
  });
  it("customer questions do not call loaded sources unreadable", () => {
    const v = coverageVerdict({
      ...base,
      required: [...base.required],
      loadedSources: [...base.loadedSources],
      failedSources: [...base.failedSources],
      paymentProofMatters: false,
      evidence: { laundry_butler: { state: "unknown" }, cleancloud: { state: "unknown" } } as never,
    });
    expect(v.kind).not.toBe("unreadable");
  });
  it("a source that did not load is unreadable for every question", () => {
    expect(coverageVerdict({ ...base, required: [...base.required], loadedSources: ["cleancloud"], failedSources: ["laundry_butler"], paymentProofMatters: false }).kind).toBe("unreadable");
  });
});
