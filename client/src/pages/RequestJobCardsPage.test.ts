import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { visibleRequestFacts } from "./RequestJobCardsPage";

describe("Slice 48 request job-card review", () => {
  it("shows present facts without serializing raw JSON", () => {
    expect(visibleRequestFacts({
      requestedDate: "2026-06-26", requestedWindow: "afternoon", deadlineDate: null,
      serviceDetails: "Full groom", vehicleDetails: null, origin: null, destination: null,
      buildingSlug: "the-wright", address: null, unit: "4B",
      dog: { name: "Milo", breed: "Poodle", size: null, ageOrLifeStage: null, temperament: null, handlingNotes: null },
    })).toEqual(expect.arrayContaining([["Requested date", "2026-06-26"], ["Dog breed", "Poodle"]]));
  });

  it("is read-only and preserves explicit truth language", () => {
    const source = readFileSync(new URL("./RequestJobCardsPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("requestJobCards.list.useQuery");
    expect(source).not.toContain("useMutation");
    for (const text of ["Not booked", "Not provider accepted", "Not paid", "Not dispatched", "Not completed", "Clarification needed", "Source status only"]) {
      expect(source).toContain(text);
    }
    expect(source).not.toMatch(/JSON\.stringify|rawJson|requestJson/);
  });
});
