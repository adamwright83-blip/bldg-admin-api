import { describe, it, expect } from "vitest";
import { SCENE_ART, statePlateAsset } from "./sceneAssets";

describe("SCENE_ART registry", () => {
  it("points the V6 base to the registered pilot base world", () => {
    expect(SCENE_ART.base).toBe(
      "/assets/goldline/lantern-city/v6/world-neutral.png"
    );
  });
  it("resolves the four registered pilot territory/state plates", () => {
    expect(statePlateAsset("koreatown", "healthy")).toBe(
      "/assets/goldline/lantern-city/v6/territories/koreatown/healthy.png"
    );
    expect(statePlateAsset("east-hollywood", "cooling")).toBe(
      "/assets/goldline/lantern-city/v6/territories/east-hollywood/cooling.png"
    );
    expect(statePlateAsset("mid-city", "infested")).toBe(
      "/assets/goldline/lantern-city/v6/territories/mid-city/infested.png"
    );
    expect(statePlateAsset("hollywood", "locked")).toBe(
      "/assets/goldline/lantern-city/v6/territories/hollywood/locked.png"
    );
  });
  it("leaves an unsupplied state on a registered territory as null, never falling back to a sibling state", () => {
    expect(statePlateAsset("koreatown", "cooling")).toBeNull();
    expect(statePlateAsset("koreatown", "infested")).toBeNull();
    expect(statePlateAsset("koreatown", "locked")).toBeNull();
    expect(statePlateAsset("east-hollywood", "healthy")).toBeNull();
    expect(statePlateAsset("mid-city", "healthy")).toBeNull();
    expect(statePlateAsset("hollywood", "healthy")).toBeNull();
  });
  it("leaves every unsupplied territory as null, never falling back to another territory's plate", () => {
    for (const territoryId of [
      "beverly-hills",
      "west-hollywood",
      "hollywood-hills-west",
      "silver-lake",
      "downtown",
      "century-city",
    ]) {
      for (const state of [
        "healthy",
        "cooling",
        "infested",
        "locked",
      ] as const) {
        expect(statePlateAsset(territoryId, state)).toBeNull();
      }
    }
  });
  it("has not wired the customer lantern family or stronghold art yet", () => {
    expect(SCENE_ART.lanterns.active).toBeNull();
    expect(SCENE_ART.lanterns.dimming).toBeNull();
    expect(SCENE_ART.lanterns.dark).toBeNull();
    expect(SCENE_ART.strongholds.opus_la).toBeNull();
    expect(SCENE_ART.strongholds.century_park_east).toBeNull();
    expect(SCENE_ART.lock).toBeNull();
  });
});
