import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "VendorCastingSprintPage.tsx"), "utf8");

describe("VendorCastingSprintPage -- Slice 75c manual form demotion", () => {
  it("frames the manual vendor-facts entry as a fallback, not the primary path", () => {
    expect(source).toMatch(/Fallback: manually import\/correct a vendor/);
    expect(source).toMatch(/Use only when HELD cannot source or parse a vendor automatically\./);
  });

  it("collapses the manual vendor-facts form behind a details/summary element", () => {
    expect(source).toMatch(/<details className="rounded-lg border border-black\/10 bg-white p-3">\s*<summary[^>]*>\s*Fallback: manually import\/correct a vendor/);
  });

  it("does not remove the underlying form controls", () => {
    expect(source).toMatch(/Business name \*/);
    expect(source).toMatch(/Generate outreach draft/);
    expect(source).toMatch(/Create Real Candidate/);
  });

  it("does not change any send/candidate-creation logic", () => {
    expect(source).toMatch(/submitDraftRequest/);
    expect(source).toMatch(/confirmCreateRealCandidate/);
  });
});
