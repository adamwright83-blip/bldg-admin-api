import { describe, expect, it } from "vitest";
import { buildCandidateDraftOutreach } from "./vendorCandidateDraftOutreachPolicy";

describe("buildCandidateDraftOutreach", () => {
  it("renders deterministic, safe-to-copy draft copy including the founder escalation line", () => {
    const draft = buildCandidateDraftOutreach({ businessName: "Sunset Mobile Grooming", geographyHint: "90027 and nearby high-rise buildings" });
    expect(draft.safeToCopy).toBe(true);
    expect(draft.forbiddenClaimsDetected).toEqual([]);
    expect(draft.body).toContain("Adam Wright");
    expect(draft.body).toContain("mobile grooming or building-service appointments");
  });

  it("never claims guaranteed volume or that a resident is currently booking", () => {
    const draft = buildCandidateDraftOutreach({ businessName: "Pawhamas Resort", geographyHint: "90027" });
    expect(draft.body).not.toMatch(/guarantee(?:d)?\s+volume|currently booking|booked|confirmed|accepted|dispatch/i);
  });

  it("does not mention OPUS LA or Century Park East", () => {
    const draft = buildCandidateDraftOutreach({ businessName: "K-9 Tubs", geographyHint: "90027" });
    expect(draft.body).not.toMatch(/OPUS LA|Century Park East/i);
  });

  it("is fully deterministic -- same input always produces the same output", () => {
    const first = buildCandidateDraftOutreach({ businessName: "Pet Purrspective", geographyHint: "90027" });
    const second = buildCandidateDraftOutreach({ businessName: "Pet Purrspective", geographyHint: "90027" });
    expect(first).toEqual(second);
  });

  it("never imports or calls an outreach/send adapter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "vendorCandidateDraftOutreachPolicy.ts"), "utf8");
    expect(source).not.toMatch(/agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid|fetch\(/i);
  });
});
