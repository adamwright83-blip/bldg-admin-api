import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SCENE_ART, statePlateAsset } from "./sceneAssets";
import type { EnvironmentState } from "./sceneTypes";

const CANONICAL_TERRITORIES = [
  "koreatown",
  "century-city",
  "beverly-hills",
  "west-hollywood",
  "hollywood",
  "los-feliz",
  "silver-lake",
  "east-hollywood",
  "mid-city",
  "echo-park",
  "downtown",
] as const;
const STATES: EnvironmentState[] = ["healthy", "cooling", "infested", "locked"];
const PUBLIC_ROOT = join(__dirname, "../../../../../public");

describe("SCENE_ART registry", () => {
  it("points the V6 base to the registered pilot base world", () => {
    expect(SCENE_ART.base).toBe(
      "/assets/goldline/lantern-city/v6/world-neutral.png"
    );
  });
  it("resolves all 11 canonical territories x 4 states — 44 mappings", () => {
    const seen = new Set<string>();
    let count = 0;
    for (const territoryId of CANONICAL_TERRITORIES) {
      for (const state of STATES) {
        const path = statePlateAsset(territoryId, state);
        expect(path, `${territoryId}/${state} must not be null`).not.toBeNull();
        expect(path).toBe(
          `/assets/goldline/lantern-city/v6/territories/${territoryId}/${state}.png`
        );
        // No two territory/state pairs may resolve to the same path — no
        // state aliasing a sibling state, no territory aliasing another
        // territory's asset.
        expect(seen.has(path!), `duplicate path: ${path}`).toBe(false);
        seen.add(path!);
        count++;
      }
    }
    expect(count).toBe(44);
    expect(seen.size).toBe(44);
  });
  it("every one of the 44 production paths resolves to a real committed file", () => {
    for (const territoryId of CANONICAL_TERRITORIES) {
      for (const state of STATES) {
        const path = statePlateAsset(territoryId, state)!;
        const onDisk = join(PUBLIC_ROOT, path);
        expect(existsSync(onDisk), `missing file on disk: ${onDisk}`).toBe(
          true
        );
      }
    }
  });
  it("leaves every non-canonical territory entirely null, never falling back to another territory's plate", () => {
    for (const territoryId of [
      "hollywood-hills-west",
      "arts-district",
      "westlake",
      "not-a-real-territory",
    ]) {
      for (const state of STATES) {
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
