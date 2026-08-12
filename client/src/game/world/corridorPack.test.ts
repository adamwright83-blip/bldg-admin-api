import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CorridorManifestInvalidError,
  CorridorManifestNotFoundError,
  CorridorNotPlayableError,
  corridorBasePath,
  loadCorridorPack,
  resolveCorridorPack,
} from "./corridorPack";
import { parseCorridorManifest } from "../../../../shared/corridorManifest";

const CORRIDOR_01_DIR = resolve(
  __dirname,
  "../../../../client/public/assets/goldline/corridor_01"
);

function corridor01Manifest(): unknown {
  return JSON.parse(readFileSync(resolve(CORRIDOR_01_DIR, "manifest.json"), "utf8"));
}

/** Minimal fetch double: maps URL -> response, everything else 404s. */
function fetchFrom(routes: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!(url in routes)) {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => routes[url] } as Response;
  }) as unknown as typeof fetch;
}

describe("corridor pack resolution", () => {
  it("resolves every relative asset path against the pack directory", () => {
    const parsed = parseCorridorManifest(corridor01Manifest());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const pack = resolveCorridorPack(parsed.data, "/assets/goldline/corridor_01");

    expect(pack.assets.mid).toBe("/assets/goldline/corridor_01/mid.webp");
    expect(pack.assets.far).toBe("/assets/goldline/corridor_01/far.webp");
    expect(pack.data.goldRoute).toBe("/assets/goldline/corridor_01/gold_route.json");
    expect(pack.data.traversal).toBe("/assets/goldline/corridor_01/traversal.json");
  });

  it("keeps a null optional asset null rather than inventing a URL for it", () => {
    const parsed = parseCorridorManifest(corridor01Manifest());
    if (!parsed.success) throw new Error("fixture manifest should parse");
    const pack = resolveCorridorPack(parsed.data, "/assets/goldline/corridor_01");
    // corridor_01 genuinely has no waterfall video.
    expect(pack.assets.waterfallVideo).toBeNull();
  });

  it("derives the base path from the corridor id", () => {
    expect(corridorBasePath("corridor_02")).toBe("/assets/goldline/corridor_02");
  });
});

describe("loadCorridorPack", () => {
  const manifestUrl = "/assets/goldline/corridor_01/manifest.json";

  it("loads corridor_01 by id alone — no caller needs to know its asset URLs", async () => {
    const pack = await loadCorridorPack("corridor_01", {
      fetchImpl: fetchFrom({ [manifestUrl]: corridor01Manifest() }),
    });

    expect(pack.id).toBe("corridor_01");
    expect(pack.stage).toBe("playable");
    expect(pack.assets.mid).toBe("/assets/goldline/corridor_01/mid.webp");
  });

  it("throws a specific error when the manifest is missing entirely", async () => {
    await expect(
      loadCorridorPack("corridor_missing", { fetchImpl: fetchFrom({}) })
    ).rejects.toBeInstanceOf(CorridorManifestNotFoundError);
  });

  it("fails safely on a malformed manifest instead of returning a partial pack", async () => {
    const broken = { ...(corridor01Manifest() as Record<string, unknown>) };
    (broken.assets as Record<string, unknown>).mid = "";

    const promise = loadCorridorPack("corridor_01", {
      fetchImpl: fetchFrom({ [manifestUrl]: broken }),
    });

    await expect(promise).rejects.toBeInstanceOf(CorridorManifestInvalidError);
  });

  it("rejects a manifest whose declared id disagrees with the directory it came from", async () => {
    const renamed = { ...(corridor01Manifest() as Record<string, unknown>), id: "corridor_99" };

    await expect(
      loadCorridorPack("corridor_01", { fetchImpl: fetchFrom({ [manifestUrl]: renamed }) })
    ).rejects.toBeInstanceOf(CorridorManifestInvalidError);
  });

  it("refuses to serve an authoring-stage corridor as the live world", async () => {
    const authoring = {
      ...(corridor01Manifest() as Record<string, unknown>),
      id: "corridor_02",
      stage: "authoring",
      assets: {
        far: null,
        mid: null,
        foreground: null,
        effects: null,
        portal: null,
        stronghold: null,
        waterfallVideo: null,
      },
      capabilities: { coldCallPortal: false, stronghold: false, missionSources: [] },
    };
    const url = "/assets/goldline/corridor_02/manifest.json";

    await expect(
      loadCorridorPack("corridor_02", { fetchImpl: fetchFrom({ [url]: authoring }) })
    ).rejects.toBeInstanceOf(CorridorNotPlayableError);
  });

  it("still resolves an authoring corridor for tooling that asks for it explicitly", async () => {
    const authoring = {
      ...(corridor01Manifest() as Record<string, unknown>),
      id: "corridor_02",
      stage: "authoring",
      assets: {
        far: null,
        mid: null,
        foreground: null,
        effects: null,
        portal: null,
        stronghold: null,
        waterfallVideo: null,
      },
      capabilities: { coldCallPortal: false, stronghold: false, missionSources: [] },
    };
    const url = "/assets/goldline/corridor_02/manifest.json";

    const pack = await loadCorridorPack("corridor_02", {
      fetchImpl: fetchFrom({ [url]: authoring }),
      requirePlayable: false,
    });

    expect(pack.stage).toBe("authoring");
    // Structural data is present even though the art is not — that is exactly
    // what makes it an authoring corridor rather than a broken one.
    expect(pack.data.traversal).toBe("/assets/goldline/corridor_02/traversal.json");
    expect(pack.assets.mid).toBeNull();
  });

  it("propagates an abort rather than reporting it as a corridor defect", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;

    await expect(
      loadCorridorPack("corridor_01", { fetchImpl, signal: controller.signal })
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
