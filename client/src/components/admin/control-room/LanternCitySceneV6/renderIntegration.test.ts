import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");

describe("Lantern City V6 render integration", () => {
  it("uses approved frontier verbs without retired chip or lock copy", () => {
    const renderer = read("./LanternCitySceneRenderer.tsx");
    expect(renderer).toContain("OPEN THE BALLOON");
    expect(renderer).toContain("REBUILD THE BIRD");
    expect(renderer).not.toMatch(/GUARDED|LOCKED/);
    expect(renderer).not.toContain("frontierLockBadge");
  });

  it("renders dossier forecast and the explicit at-risk definition without weather", () => {
    const hud = read("./LanternCityHUD.tsx");
    expect(hud).toContain("dossier.decayForecast");
    expect(hud).toContain("At risk = customers currently in dimming cadence.");
    expect(hud).not.toMatch(/weather/i);
  });

  it("uses shared Arsenal truth, connects only Signal Flare, and disables unmatched tools", () => {
    const arsenal = read("../RekindlingArsenal.tsx");
    expect(arsenal).toMatch(/ARSENAL_TOOLS/);
    expect(arsenal).toMatch(/cooldownVerdict/);
    expect(arsenal).toMatch(/goldenSealCost/);
    expect(arsenal).toMatch(/rekindlingStateFor/);
    expect(arsenal).toContain('id === "signal_flare"');
    expect(arsenal).toContain("disabled={!enabled}");
    expect(arsenal).toContain("Action path not yet connected.");
    expect(arsenal).not.toMatch(/useMutation/);
  });
});
