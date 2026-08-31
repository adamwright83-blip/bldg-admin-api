import { describe, expect, it } from "vitest";
import { parseFieldJournalExtraction } from "./fieldJournal";

const item = (value: string) => ({
  value,
  provenance: "operator_reported",
  confidence: "medium",
  transcriptExcerpt: value,
});

describe("Field Journal extraction schema", () => {
  it("accepts multiple entities and keeps raw evidence references", () => {
    const parsed = parseFieldJournalExtraction({
      entities: ["The Louise", "The Pearl"].map((name, index) => ({
        clientEntityKey: `property-${index}`,
        kind: "potential_property",
        propertyName: item(name),
        addressClue: null,
        neighborhood: null,
        websiteDomain: null,
        contactName: null,
        contactTitle: null,
        email: null,
        phone: null,
        amenities: [],
        architecture: [],
      })),
      actions: [],
      outcomes: [],
      followUps: [],
      coaching: { objections: [], worked: [], failed: [], reflections: [] },
      corrections: [],
    });
    expect(parsed.entities.map(entity => entity.propertyName?.value)).toEqual(["The Louise", "The Pearl"]);
  });

  it("does not include authoritative reorder or won outcome types", () => {
    expect(() => parseFieldJournalExtraction({
      entities: [], actions: [], followUps: [], corrections: [],
      coaching: { objections: [], worked: [], failed: [], reflections: [] },
      outcomes: [{ entityClientKey: null, type: "authoritative_reorder", evidence: item("ordered"), explicitlyReported: true }],
    })).toThrow();
  });
});
