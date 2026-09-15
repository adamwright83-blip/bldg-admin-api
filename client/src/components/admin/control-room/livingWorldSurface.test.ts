import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  describeWorldPresentation,
  orderByProminence,
  presentWorldState,
} from "@shared/goldlineWorldPresentation";
import { projectPhysicalWorldState } from "@shared/goldlineWorld";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

const scene = read("./LanternCitySceneV6/LanternCityScene.tsx");
const renderer = read("./LanternCitySceneV6/LanternCitySceneRenderer.tsx");
const inspector = read("./WorldEntityInspector.tsx");
/** Collapsed whitespace, so prose assertions survive reformatting. */
const inspectorProse = inspector.replace(/\s+/g, " ");
const service = readFileSync(
  join(__dirname, "../../../../../server/goldlineWorld/cityWorldService.ts"),
  "utf8"
);

describe("Lantern City is the living world", () => {
  it("lets one building be one building by matching identity on the server", () => {
    expect(scene).not.toMatch(/const normalizeAddress\s*=/);
    expect(scene).not.toContain('aliasType === "normalized_address"');
    expect(service).toContain("normalizePhysicalAlias");
  });

  it("wears history and knowledge on the building itself", () => {
    expect(inspector).toContain("presentation.veilExplanation");
    expect(inspector).toContain("owi-knowledge");
    expect(renderer).toContain("CanonicalBuildingArt");
  });

  it("says every visible atmosphere out loud as well", () => {
    const projection = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [],
      residentCount: 0,
      activeResidentCount: 0,
      epistemicState: "unknown",
    });
    const presentation = presentWorldState(projection);
    const spoken = describeWorldPresentation("OPUS LA", presentation);
    expect(spoken).toContain("OPUS LA");
    expect(spoken.length).toBeGreaterThan("OPUS LA".length);
    expect(inspector).toContain("presentation.veilExplanation");
    expect(renderer).toContain("aria-label=");
  });

  it("lets attention emphasise a place without rewriting it", () => {
    const base = presentWorldState(
      projectPhysicalWorldState({
        physicalEntityId: "building-1",
        events: [],
        residentCount: 0,
        activeResidentCount: 0,
        epistemicState: "unknown",
      })
    );
    const items = [
      { id: "quiet", presentation: { ...base, prominence: 0.1 } },
      { id: "loud", presentation: { ...base, prominence: 0.9 } },
    ];
    const ranked = orderByProminence(items, item => item.presentation);
    expect(ranked.map(item => item.id)).toEqual(["loud", "quiet"]);
    expect(items[0]?.id).toBe("quiet");
    expect(scene).not.toMatch(/attention[\s\S]{0,120}mutate\(/);
    expect(scene).toContain("composeLanternCityScene");
  });

  it("reveals a deep-linked place instead of silently selecting it", () => {
    expect(scene).toMatch(/\.get\(\s*"entity"\s*\)/);
    expect(scene).toContain("requestedEntityId && entity");
    expect(scene).toContain("WorldEntityInspector");
  });

  it("embodies the pursued place as a building rather than a glyph", () => {
    expect(renderer).toContain("CanonicalBuildingArt");
    expect(renderer).toContain('object.kind === "prospect"');
    expect(scene).not.toContain("lc-pursued-flame");
    expect(renderer).not.toContain("♨");
    expect(scene).not.toContain("♨");
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
