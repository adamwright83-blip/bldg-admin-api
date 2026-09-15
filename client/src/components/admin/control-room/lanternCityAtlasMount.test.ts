import { describe, expect, it } from "vitest";
import LanternCityAtlasDefault from "./LanternCityAtlas";
import LanternCityScene from "./LanternCitySceneV6/LanternCityScene";

/**
 * REGRESSION FOR THE 612af8c CLASS OF FAILURE.
 *
 * A helper was inserted between `export default` and the component, so the
 * module's default export silently became `lanternPhaseSeconds` and the
 * component was never exported. The route rendered a function that returns a
 * number, and Lantern City went blank.
 *
 * Live Lantern City now default-exports `LanternCityScene`. The Atlas module
 * is a re-export shim and must keep that same component as its default.
 */
describe("Lantern City module contract", () => {
  it("default-exports the live scene component itself", () => {
    expect(typeof LanternCityScene).toBe("function");
    expect(LanternCityScene.name).toBe("LanternCityScene");
    expect(LanternCityAtlasDefault).toBe(LanternCityScene);
  });

  it("does not default-export a plain value helper", () => {
    const asHelper = LanternCityScene as unknown as (k: string) => unknown;
    let result: unknown;
    try {
      result = asHelper("cluster-key");
    } catch {
      result = undefined;
    }
    expect(typeof result).not.toBe("number");
  });

  it("is a component, not a hook or class factory", () => {
    expect(LanternCityScene.length).toBeLessThanOrEqual(2);
  });
});
