import { describe, expect, it } from "vitest";
import { buildJoystickDraftPreview } from "./joystickAcquisition";

describe("JOYSTICK draft preview truth boundary", () => {
  it("uses only declared answers and optional geocoded declaration", () => {
    const preview = buildJoystickDraftPreview({
      answers: {
        daily_work: "I run plumbing service calls",
        service_area: "Pasadena",
        avoidance: "following up on estimates",
      },
      geocode: {
        canonicalAddress: "Pasadena, CA, USA",
        latitude: 34.1478,
        longitude: -118.1445,
      },
      now: new Date("2026-10-02T00:00:00Z"),
    });
    expect(preview.area.provenance).toBe("geocoded_declaration");
    expect(preview.work.provenance).toBe("operator_declared");
    expect(preview.avoidance.provenance).toBe("operator_declared");
    expect(preview.recommendedAction.provenance).toBe("generated_recommendation");
    expect(JSON.stringify(preview)).not.toMatch(/revenue|customer pin|missed follow-up|appointment/i);
  });

  it("does not require geocoding to preserve a truthful declared area", () => {
    const preview = buildJoystickDraftPreview({
      answers: {
        daily_work: "I clean homes",
        service_area: "the west side",
        avoidance: "asking past customers for referrals",
      },
    });
    expect(preview.area).toMatchObject({
      declared: "the west side",
      canonicalAddress: null,
      provenance: "operator_declared",
    });
  });
});
