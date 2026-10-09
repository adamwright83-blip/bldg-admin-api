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

  it("generates specific personalized briefings for commercial service archetypes (ACCEPTANCE 2)", () => {
    const carpetCleaner = buildJoystickDraftPreview({
      answers: {
        daily_work: "Commercial carpet cleaner maintaining office buildings and medical suites",
        service_area: "Pasadena and the San Gabriel Valley",
        avoidance: "Following up on sent quotes and calling back cold facility managers",
      },
    });
    expect(carpetCleaner.briefing.text).toContain("Commercial carpet cleaner maintaining office buildings and medical suites");
    expect(carpetCleaner.briefing.text).toContain("Pasadena and the San Gabriel Valley");
    expect(carpetCleaner.briefing.text).toContain("Following up on sent quotes and calling back cold facility managers");
    expect(carpetCleaner.briefing.text).not.toContain("generic placeholder");

    const fitnessStudio = buildJoystickDraftPreview({
      answers: {
        daily_work: "Boutique fitness studio running group HIIT and personal training sessions",
        service_area: "Downtown Austin",
        avoidance: "Reaching out to members who stopped booking 30 days ago",
      },
    });
    expect(fitnessStudio.briefing.text).toContain("Boutique fitness studio running group HIIT and personal training sessions");
    expect(fitnessStudio.briefing.text).toContain("Downtown Austin");
    expect(fitnessStudio.briefing.text).toContain("Reaching out to members who stopped booking 30 days ago");

    const petGroomer = buildJoystickDraftPreview({
      answers: {
        daily_work: "Mobile pet groomer providing doorstep bathing and haircut services",
        service_area: "Scottsdale and East Phoenix",
        avoidance: "Collecting Google reviews after completing appointments",
      },
    });
    expect(petGroomer.briefing.text).toContain("Mobile pet groomer providing doorstep bathing and haircut services");
    expect(petGroomer.briefing.text).toContain("Scottsdale and East Phoenix");
    expect(petGroomer.briefing.text).toContain("Collecting Google reviews after completing appointments");
  });
});
