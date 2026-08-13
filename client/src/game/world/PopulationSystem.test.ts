import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCorridorManifest } from "../../../../shared/corridorManifest";
import { PopulationSystem } from "./PopulationSystem";

function populationFixture() {
  const raw = JSON.parse(
    readFileSync(
      resolve(
        __dirname,
        "../../../public/assets/goldline/corridor_01/manifest.json"
      ),
      "utf8"
    )
  );
  const parsed = parseCorridorManifest(raw);
  if (!parsed.success) throw new Error("corridor_01 population must validate");
  return parsed.data.population;
}

describe("PopulationSystem", () => {
  it("shows five authored ambient figures in the opening scene", () => {
    const system = new PopulationSystem(populationFixture());
    system.update({ now: 0, width: 412, height: 923, playerProgress: 0.06 });
    expect(system.visibleAmbientCount).toBeGreaterThanOrEqual(5);
    system.destroy();
  });

  it("sleeps ambient figures beyond their authored visibility radius", () => {
    const system = new PopulationSystem(populationFixture());
    system.update({ now: 0, width: 412, height: 923, playerProgress: 0.06 });
    const openingCount = system.visibleAmbientCount;
    system.update({ now: 200, width: 412, height: 923, playerProgress: 0.82 });
    expect(system.visibleAmbientCount).toBeLessThan(openingCount);
    system.destroy();
  });

  it("mounts only an authoritative mission and destroys idempotently", () => {
    const system = new PopulationSystem(populationFixture());
    expect(system.missionEmbodiment).toBeNull();
    system.setMission({
      missionId: 71,
      missionKey: "mission:71",
      archetype: "STALLER",
      state: "active",
      affordance: "VISIT",
      worldSignal: "threshold",
    });
    expect(system.missionEmbodiment?.missionId).toBe(71);
    system.setMission(null);
    expect(system.missionEmbodiment).toBeNull();
    system.setAgentPresence([
      { agentId: "SCOUT", hasAuthoritativeSignal: false },
      { agentId: "INTEL", hasAuthoritativeSignal: true },
    ]);
    expect(() => {
      system.destroy();
      system.destroy();
    }).not.toThrow();
  });
});
