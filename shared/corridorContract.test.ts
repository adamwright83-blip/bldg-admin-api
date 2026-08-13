import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isProductionPlayable,
  missingOptionalArt,
  parseCorridorManifest,
  productionClosureBlockers,
} from "./corridorManifest";

const ASSET_ROOT = resolve(__dirname, "../client/public/assets/goldline");

function manifestFor(corridorId: string) {
  const path = resolve(ASSET_ROOT, corridorId, "manifest.json");
  const parsed = parseCorridorManifest(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `${corridorId} manifest invalid: ${parsed.error.issues
        .map(i => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }
  return parsed.data;
}

function fileExists(corridorId: string, relative: string): boolean {
  return existsSync(resolve(ASSET_ROOT, corridorId, relative));
}

describe("corridor_01 remains a valid, production-playable pack", () => {
  const manifest = manifestFor("corridor_01");

  it("is stage 'playable'", () => {
    expect(manifest.stage).toBe("playable");
    expect(isProductionPlayable(manifest)).toBe(true);
    expect(manifest.visualReview.status).toBe("approved");
  });

  it("has every required structural data file on disk", () => {
    expect(fileExists("corridor_01", manifest.data.traversal)).toBe(true);
    expect(fileExists("corridor_01", manifest.data.occlusion)).toBe(true);
    expect(fileExists("corridor_01", manifest.data.goldRoute)).toBe(true);
  });

  it("has the mid plate a playable corridor cannot do without", () => {
    expect(manifest.assets.mid).not.toBeNull();
    expect(fileExists("corridor_01", manifest.assets.mid!)).toBe(true);
  });

  it("declares only capabilities it actually has the art for", () => {
    expect(manifest.capabilities.coldCallPortal).toBe(true);
    expect(manifest.assets.portal).not.toBeNull();
    expect(manifest.capabilities.stronghold).toBe(true);
    expect(manifest.assets.stronghold).not.toBeNull();
  });

  it("keeps its declared landmarks consistent with its authored traversal anchors", () => {
    const traversal = JSON.parse(
      readFileSync(
        resolve(ASSET_ROOT, "corridor_01", manifest.data.traversal),
        "utf8"
      )
    ) as {
      anchors: Array<{
        id: string;
        position: { progress: number; lateral: number };
      }>;
    };

    for (const landmark of manifest.landmarks) {
      const anchor = traversal.anchors.find(a => a.id === landmark.id);
      // A landmark the manifest advertises must correspond to a real authored
      // anchor at the same place — otherwise the manifest is describing a
      // corridor that does not exist.
      expect(
        anchor,
        `no traversal anchor for landmark '${landmark.id}'`
      ).toBeTruthy();
      expect(anchor!.position.progress).toBeCloseTo(
        landmark.position.progress,
        5
      );
      expect(anchor!.position.lateral).toBeCloseTo(
        landmark.position.lateral,
        5
      );
    }
  });
});

describe("corridor_02 is a production-playable pack without fake optional art", () => {
  const manifest = manifestFor("corridor_02");

  it("validates against the same schema corridor_01 uses", () => {
    expect(manifest.id).toBe("corridor_02");
    expect(manifest.version).toBeGreaterThanOrEqual(1);
  });

  it("records explicit human approval and is production-playable", () => {
    expect(manifest.stage).toBe("playable");
    expect(isProductionPlayable(manifest)).toBe(true);
    expect(manifest.visualReview).toEqual({
      status: "approved",
      reviewedAt: "2026-08-13T16:00:46.000Z",
      reviewer: "product-owner",
    });
  });

  it("carries REAL structural data — the part that makes a corridor coherent", () => {
    expect(fileExists("corridor_02", manifest.data.traversal)).toBe(true);
    expect(fileExists("corridor_02", manifest.data.occlusion)).toBe(true);
    expect(fileExists("corridor_02", manifest.data.goldRoute)).toBe(true);
  });

  it("ships the supplied production-source environment plates", () => {
    for (const asset of [
      manifest.assets.mid,
      manifest.assets.far,
      manifest.assets.foreground,
      manifest.assets.effects,
    ]) {
      expect(asset).not.toBeNull();
      expect(fileExists("corridor_02", asset!)).toBe(true);
    }
    expect(missingOptionalArt(manifest)).toEqual([
      "portal",
      "stronghold",
      "waterfallVideo",
    ]);
  });

  it("has authored population space backed by the production atlas", () => {
    expect(manifest.population.ambient.length).toBeGreaterThanOrEqual(5);
    expect(manifest.population.missionAnchorPoints.length).toBeGreaterThan(0);
    expect(manifest.population.assetStage).toBe("production");
    expect(manifest.population.atlas).toBe("../population/coastal_roles.webp");
    expect(fileExists("corridor_02", manifest.population.atlas)).toBe(true);
  });

  it("has no machine-checkable production closure blockers", () => {
    expect(productionClosureBlockers(manifest)).toEqual([]);
  });

  it("does not invent optional portal, Stronghold, or video art", () => {
    for (const name of [
      "portal_coldcall.webp",
      "stronghold.webp",
      "waterfall.webm",
    ]) {
      expect(
        fileExists("corridor_02", name),
        `unexpected art file ${name}`
      ).toBe(false);
    }
  });

  it("claims no capability it has no art to back", () => {
    expect(manifest.capabilities.coldCallPortal).toBe(false);
    expect(manifest.capabilities.stronghold).toBe(false);
  });

  it("documents the promotion and still-absent optional art", () => {
    const readme = readFileSync(
      resolve(ASSET_ROOT, "corridor_02", "README.md"),
      "utf8"
    );
    expect(readme).toMatch(/PLAYABLE/);
    expect(readme).toMatch(/mid\.webp/);
    expect(readme).toMatch(/product owner approved/i);
    expect(readme).toMatch(/Portal and Stronghold capabilities remain `false`/);
  });
});

describe("the schema refuses to let an unfinished corridor claim playability", () => {
  it("rejects stage 'playable' with no mid plate", () => {
    const authoring = JSON.parse(
      readFileSync(resolve(ASSET_ROOT, "corridor_02", "manifest.json"), "utf8")
    ) as Record<string, unknown>;

    const result = parseCorridorManifest({
      ...authoring,
      stage: "playable",
      assets: {
        ...(authoring.assets as Record<string, unknown>),
        mid: null,
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(i => i.path.join(".") === "assets.mid")
      ).toBe(true);
    }
  });

  it("rejects a capability claim with no backing art", () => {
    const authoring = JSON.parse(
      readFileSync(resolve(ASSET_ROOT, "corridor_02", "manifest.json"), "utf8")
    ) as Record<string, unknown>;

    const result = parseCorridorManifest({
      ...authoring,
      capabilities: {
        coldCallPortal: true,
        stronghold: false,
        missionSources: [],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects playable promotion without explicit human visual approval", () => {
    const current = JSON.parse(
      readFileSync(resolve(ASSET_ROOT, "corridor_01", "manifest.json"), "utf8")
    ) as Record<string, unknown>;
    const result = parseCorridorManifest({
      ...current,
      visualReview: { status: "pending", reviewedAt: null, reviewer: null },
    });
    expect(result.success).toBe(false);
  });
});
