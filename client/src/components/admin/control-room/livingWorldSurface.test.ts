import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

const atlas = read("./LanternCityAtlas.tsx");
const inspector = read("./WorldEntityInspector.tsx");
/** Collapsed whitespace, so prose assertions survive reformatting. */
const inspectorProse = inspector.replace(/\s+/g, " ");
const service = readFileSync(
  join(__dirname, "../../../../../server/goldlineWorld/cityWorldService.ts"),
  "utf8"
);

describe("Lantern City is the living world", () => {
  it("lets one building be one building by matching identity on the server", () => {
    // A second normaliser in the browser could disagree with the resolver that
    // owns physical identity and split one building across two markers.
    expect(atlas).not.toMatch(/const normalizeAddress\s*=/);
    expect(atlas).not.toContain('aliasType === "normalized_address"');
    expect(service).toContain("normalizePhysicalAlias");
  });

  it("wears history and knowledge on the building itself", () => {
    expect(atlas).toContain("WorldMarkerAtmosphere");
    expect(atlas).toContain("lc-veil");
    expect(atlas).toContain("lc-marks");
    expect(atlas).toContain("presentation.marks.map");
  });

  it("says every visible atmosphere out loud as well", () => {
    // Uncertainty that can only be seen is uncertainty some users never get.
    expect(atlas).toContain("describeWorldPresentation");
    expect(atlas).toContain("aria-label={markerLabel(");
    expect(inspector).toContain("presentation.veilExplanation");
  });

  it("lets attention emphasise a place without rewriting it", () => {
    expect(atlas).toContain("orderByProminence");
    expect(atlas).toContain("attention-${presentation.prominenceTier}");
    // Attention may reorder and highlight. It must not mutate any record.
    expect(atlas).not.toMatch(/attention[\s\S]{0,120}mutate\(/);
  });

  it("reveals a deep-linked place instead of silently selecting it", () => {
    expect(atlas).toContain("scrollIntoView");
    expect(atlas).toContain("is-revealing");
    expect(atlas).toContain("setRevealing");
  });

  it("embodies the pursued place as a building rather than a glyph", () => {
    expect(atlas).toContain("lc-pursued-building");
    expect(atlas).toContain("lc-mini-building");
    // The old flame glyph stood in for a building that can now be drawn.
    expect(atlas).not.toContain("lc-pursued-flame");
    expect(atlas).not.toContain("♨");
  });
});

describe("recovery stays honest at both ends", () => {
  it("offers no control that marks a customer recovered", () => {
    expect(inspector).not.toMatch(/mark(ed)?[ _]?recovered/i);
    expect(inspector).not.toContain("markRecovered");
  });

  it("says plainly that the action leaves the customer dormant", () => {
    expect(inspector).toContain("SIGNAL SENT");
    expect(inspectorProse).toContain("this customer is still dormant");
    expect(inspector).toContain("LANTERN RELIT");
  });

  it("relights only on an authoritative paid order", () => {
    expect(inspector).toContain('intervention?.status === "recovered"');
    expect(inspector).toContain("intervention.recoveredOrderId");
  });

  it("refuses to attach a world event to a guessed building", () => {
    const lookup = readFileSync(
      join(__dirname, "../../../../../server/goldlineWorld/entityLookup.ts"),
      "utf8"
    );
    // An address bound to two entities is a conflict, not a coin flip.
    expect(lookup).toContain("unique.size === 1");
  });
});

describe("the inspector keeps one place as the anchor", () => {
  it("does not render panels that have nothing real to say", () => {
    expect(inspector).toContain("residents.length ?");
    expect(inspector).toContain("entity?.evidence.length ?");
    expect(inspector).toContain("projection?.historyMarks.length ?");
  });

  it("states that viewing a place does not manufacture history", () => {
    expect(inspectorProse).toContain(
      "Viewing this place does not manufacture one."
    );
  });

  it("keeps the commercial record from implying a won account", () => {
    expect(inspectorProse).toContain("does not imply a won account");
  });
});
