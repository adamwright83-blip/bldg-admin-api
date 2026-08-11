import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCorridorManifest } from "./corridorManifest";

describe("parseCorridorManifest", () => {
  it("accepts corridor_01's real manifest.json", () => {
    const raw = JSON.parse(
      readFileSync(
        resolve(__dirname, "../client/public/assets/goldline/corridor_01/manifest.json"),
        "utf8",
      ),
    );
    const result = parseCorridorManifest(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("corridor_01");
      expect(result.data.assets.mid).toBe("mid.webp");
      expect(result.data.assets.waterfallVideo).toBeNull();
      expect(result.data.qualityVariants.map(v => v.id)).toEqual(["premium", "reduced"]);
    }
  });

  it("rejects a manifest missing the required mid layer", () => {
    const result = parseCorridorManifest({
      id: "corridor_broken",
      version: 1,
      assets: {
        far: "far.webp",
        mid: "",
        foreground: null,
        effects: null,
        portal: null,
        stronghold: null,
        waterfallVideo: null,
      },
      data: { traversal: "traversal.json", occlusion: "occlusion.json", goldRoute: "gold_route.json" },
      parallax: { far: 0.1 },
      qualityVariants: [{ id: "premium" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects parallax values outside the authored range", () => {
    const result = parseCorridorManifest({
      id: "corridor_broken",
      version: 1,
      assets: {
        far: "far.webp",
        mid: "mid.webp",
        foreground: null,
        effects: null,
        portal: null,
        stronghold: null,
        waterfallVideo: null,
      },
      data: { traversal: "traversal.json", occlusion: "occlusion.json", goldRoute: "gold_route.json" },
      parallax: { far: 0.9 },
      qualityVariants: [{ id: "premium" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty qualityVariants array", () => {
    const result = parseCorridorManifest({
      id: "corridor_broken",
      version: 1,
      assets: {
        far: "far.webp",
        mid: "mid.webp",
        foreground: null,
        effects: null,
        portal: null,
        stronghold: null,
        waterfallVideo: null,
      },
      data: { traversal: "traversal.json", occlusion: "occlusion.json", goldRoute: "gold_route.json" },
      parallax: { far: 0.1 },
      qualityVariants: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown quality variant id", () => {
    const result = parseCorridorManifest({
      id: "corridor_broken",
      version: 1,
      assets: {
        far: "far.webp",
        mid: "mid.webp",
        foreground: null,
        effects: null,
        portal: null,
        stronghold: null,
        waterfallVideo: null,
      },
      data: { traversal: "traversal.json", occlusion: "occlusion.json", goldRoute: "gold_route.json" },
      parallax: { far: 0.1 },
      qualityVariants: [{ id: "ultra" }],
    });
    expect(result.success).toBe(false);
  });
});
