import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import {
  DIRECTIONAL_POSE_FILES,
  resolveDirectionalPoseKey,
} from "./GoldlineGame";

describe("DIRECTIONAL_POSE_FILES", () => {
  it("declares exactly the 4 cardinal idle directions and 4x5-frame walk cycles — the honest subset the source art actually supports", () => {
    const keys = Object.keys(DIRECTIONAL_POSE_FILES);
    const idleKeys = keys.filter(k => k.startsWith("idle-"));
    const walkKeys = keys.filter(k => k.startsWith("walk-"));
    expect(idleKeys.sort()).toEqual(
      ["idle-front", "idle-back", "idle-left", "idle-right"].sort()
    );
    expect(walkKeys).toHaveLength(20); // 4 directions x 5 frames
    for (const dir of ["front", "back", "left", "right"]) {
      for (let i = 1; i <= 5; i += 1) {
        expect(keys).toContain(`walk-${dir}-0${i}`);
      }
    }
    // No diagonal directions — the idle row had genuine diagonal poses but
    // no matching walk-cycle coverage, so shipping them would create an
    // idle-only direction the walk cycle can never reach.
    expect(keys.some(k => k.includes("diagonal"))).toBe(false);
  });

  it("every declared file lives under the directional/ subpath", () => {
    for (const file of Object.values(DIRECTIONAL_POSE_FILES)) {
      expect(file.startsWith("directional/")).toBe(true);
    }
  });
});

describe("resolveDirectionalPoseKey", () => {
  const textures = new Map([
    ["idle-front", Texture.WHITE],
    ["walk-left-01", Texture.WHITE],
  ]);

  it("resolves idle to the facing-specific key when the texture is loaded", () => {
    expect(resolveDirectionalPoseKey("idle", "idle", "front", 0, textures)).toBe(
      "idle-front"
    );
  });

  it("resolves walk to the facing+frame-specific key when the texture is loaded", () => {
    expect(
      resolveDirectionalPoseKey("run_01", "walk", "left", 0, textures)
    ).toBe("walk-left-01");
  });

  it("falls back to the base key when no directional texture was loaded for that facing — never breaks movement", () => {
    expect(
      resolveDirectionalPoseKey("idle", "idle", "back", 0, textures)
    ).toBe("idle");
    expect(
      resolveDirectionalPoseKey("run_02", "walk", "right", 1, textures)
    ).toBe("run_02");
  });

  it("never resolves a directional variant for jump/climb/vault/land — canonical action frames stay reachable and untouched by facing", () => {
    const fullTextures = new Map(
      Object.keys(DIRECTIONAL_POSE_FILES).map(k => [k, Texture.WHITE])
    );
    for (const state of [
      "jump_start",
      "jump_air",
      "land",
      "vault",
      "climb",
    ] as const) {
      expect(
        resolveDirectionalPoseKey(state, state, "left", 0, fullTextures)
      ).toBe(state);
    }
  });

  it("falls back safely with zero textures loaded at all — a total load failure never breaks movement", () => {
    const empty = new Map<string, Texture>();
    expect(resolveDirectionalPoseKey("idle", "idle", "front", 0, empty)).toBe(
      "idle"
    );
    expect(resolveDirectionalPoseKey("run_03", "run", "right", 2, empty)).toBe(
      "run_03"
    );
  });

  it("run reuses the same directional walk frames as walk, exactly mirroring how run_0N is already reused between the two states", () => {
    expect(resolveDirectionalPoseKey("run_02", "run", "left", 1, textures)).toBe(
      resolveDirectionalPoseKey("run_02", "walk", "left", 1, textures)
    );
  });
});
