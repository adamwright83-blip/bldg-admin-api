import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../BuildMissionSheet.tsx", import.meta.url),
  "utf8"
);

describe("BuildMissionSheet Google Places autocomplete", () => {
  it("fires the Places request directly after two typed characters", () => {
    expect(source).toContain("query.length < 2");
    expect(source).toContain("utils.system.commercialMission.placeSuggestions");
    expect(source).toContain(".fetch({ query })");
    expect(source).toContain("setPlaceSuggestions(results as PlaceSuggestion[])");
  });

  it("autocompletes both exact-property and nearby-location input", () => {
    const effect = source.slice(
      source.indexOf("useEffect(() => {", source.indexOf("autocompleteRequestRef")),
      source.indexOf("function close()")
    );
    expect(effect).not.toContain('targetMode !== "exact_property"');
    expect(source).toContain('aria-autocomplete="list"');
    expect(source).toContain('aria-label="Google Places suggestions"');
    expect(source).toContain('"Finding the location…"');
  });

  it("retries one transient Places failure and exposes a real failure state", () => {
    expect(source).toContain("const fetchSuggestions = () =>");
    expect(source).toContain(".catch(() => fetchSuggestions())");
    expect(source).toContain("setPlaceSuggestionsError(true)");
    expect(source).toContain(
      "Google Places could not load suggestions. Try typing again."
    );
  });

  it("rejects stale results and keeps the exact selected Place ID authoritative", () => {
    expect(source).toContain(
      "if (autocompleteRequestRef.current !== requestNumber) return"
    );
    expect(source).toContain("{ placeId: selectedPlace.placeId }");
  });

  it("uses the selected formatted location for nearby prospect discovery", () => {
    expect(source).toContain('targetMode === "nearby_discovery"');
    expect(source).toContain("suggestion.address || suggestion.text");
  });

  it("does not rely on the inert useQuery autocomplete wiring", () => {
    expect(source).not.toContain(
      "trpc.system.commercialMission.placeSuggestions.useQuery"
    );
  });
});
