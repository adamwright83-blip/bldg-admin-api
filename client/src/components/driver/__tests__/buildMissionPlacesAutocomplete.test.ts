import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../BuildMissionSheet.tsx", import.meta.url),
  "utf8"
);

describe("BuildMissionSheet Google Places autocomplete", () => {
  it("drives Places directly from the exact visible input value", () => {
    expect(source).toContain(
      "const placesQuery = searchNearValue.trim()"
    );
    expect(source).toContain("{ query: placesQuery }");
    expect(source).not.toContain("debouncedSearch");
    expect(source).not.toContain("deferredSearch");
    expect(source).not.toContain("useDeferredValue");
    expect(source).not.toContain("setTimeout(() =>");
  });

  it("offers Google Places suggestions in both exact-property and nearby-location modes", () => {
    const queryBlock = source.slice(
      source.indexOf("const placeSuggestions"),
      source.indexOf("useEffect(() =>")
    );
    expect(queryBlock).toContain("enabled:");
    expect(queryBlock).toContain("placesQuery.length >= 2");
    expect(queryBlock).not.toContain('targetMode === "exact_property"');

    const dropdownBlock = source.slice(
      source.indexOf('role="listbox"') - 250,
      source.indexOf("Nothing is called or messaged automatically")
    );
    expect(dropdownBlock).not.toContain(
      'targetMode === "exact_property" &&\n                !selectedPlace'
    );
    expect(dropdownBlock).toContain("Powered by Google");
  });

  it("uses the selected Place ID for exact targets and the selected address for nearby discovery", () => {
    expect(source).toContain(
      '? { placeId: selectedPlace.placeId }'
    );
    expect(source).toContain(
      'targetMode === "nearby_discovery"'
    );
    expect(source).toContain(
      "suggestion.address || suggestion.text"
    );
  });

  it("surfaces a Places failure instead of silently looking like a dead text field", () => {
    expect(source).toContain(
      "Google Places could not load suggestions. Keep typing or try again."
    );
  });
});
