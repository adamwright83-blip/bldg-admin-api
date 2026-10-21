import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

describe("PlayableLetterDesk and CozyNeighborhoodEncounter integration", () => {
  it("mounts both PlayableLetterDesk (Phase 3) and CozyMessageComposer (Phase 1) behind experienceMode toggle", () => {
    const encounter = read("./CozyNeighborhoodEncounter.tsx");
    expect(encounter).toContain("PlayableLetterDesk");
    expect(encounter).toContain("CozyMessageComposer");
    expect(encounter).toContain("experienceMode === \"playable\"");
    expect(encounter).toContain("experienceMode === \"classic\"");
    expect(encounter).toContain("✍️ Playable Letter Desk (Phase 3)");
    expect(encounter).toContain("📄 Classic Composer (Phase 1)");
  });

  it("mounts the persistent NeighborhoodCourtyardFeature in the courtyard plate", () => {
    const encounter = read("./CozyNeighborhoodEncounter.tsx");
    expect(encounter).toContain("NeighborhoodCourtyardFeature");
    expect(encounter).toContain("chosenFeature={neighborhoodMemory.featureChoice}");
    expect(encounter).toContain("onChooseFeature={handleChooseCourtyardFeature}");
  });

  it("supports isolated synthetic preview mode with all 8 realistic states", () => {
    const encounter = read("./CozyNeighborhoodEncounter.tsx");
    expect(encounter).toContain("SYNTHETIC_SILVER_LAKE_TARGETS");
    expect(encounter).toContain("isSyntheticPreview");
    expect(encounter).toContain("🧪 Synthetic Preview");
    expect(encounter).toContain("Real Mission Data");
  });

  it("threads memory notes and encounter counts into PlayableLetterDesk", () => {
    const encounter = read("./CozyNeighborhoodEncounter.tsx");
    expect(encounter).toContain("memoryNote={memoryNote}");
    expect(encounter).toContain("encounterCount={neighborhoodMemory.encounterCounts");
    expect(encounter).toContain("onDraftCompleted={handleDraftCompleted}");
  });

  it("verifies PlayableLetterDesk exposes approach selector, letter paper, dispatch shelf, and actions", () => {
    const desk = read("./PlayableLetterDesk.tsx");
    expect(desk).toContain("approachSelectorSection");
    expect(desk).toContain("parchmentLetter");
    expect(desk).toContain("dispatchShelfSection");
    expect(desk).toContain("talk-to-text-button");
    expect(desk).toContain("data-testid={`schedule-slot-${slot}`}");
    expect(desk).toContain("custom-schedule-button");
    expect(desk).toContain("open-in-sms-button");
    expect(desk).toContain("send-now-button");
    expect(desk).toContain("getVillagerPersonality");
  });

  it("verifies NeighborhoodCourtyardFeature provides tea table and reading bench options with persistence", () => {
    const feature = read("./NeighborhoodCourtyardFeature.tsx");
    expect(feature).toContain("tea_table");
    expect(feature).toContain("NEIGHBORHOOD_FEATURES.tea_table.name");
    expect(feature).toContain("NEIGHBORHOOD_FEATURES.reading_bench.name");
    expect(feature).toContain("neighborhood-courtyard-spot");
    expect(feature).toContain("choose-tea-table");
    expect(feature).toContain("choose-reading-bench");
  });
});
