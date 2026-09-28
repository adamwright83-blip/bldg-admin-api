import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../BuildMissionSheet.tsx", import.meta.url),
  "utf8"
);

describe("BuildMissionSheet Google Places autocomplete", () => {
  it("fires the Places request directly after two typed characters", () => {
    expect(source).toContain('query.length < 2');
    expect(source).toContain("utils.system.commercialMission.placeSuggestions");
    expect(source).toContain(".fetch({ query })");
    expect(source).toContain("setPlaceSuggestions(results as PlaceSuggestion[])");
  });

  it("does not rely on the inert useQuery autocomplete wiring", () => {
    expect(source).not.toContain(
      "trpc.system.commercialMission.placeSuggestions.useQuery"
    );
  });

  it("keeps the selected Google Place ID authoritative for mission creation", () => {
    expect(source).toContain("{ placeId: selectedPlace.placeId }");
    expect(source).toContain("setSearchNearValue(suggestion.text)");
  });
});
