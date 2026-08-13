/**
 * Corridor packs as first-class runtime entities.
 *
 * Before this, every caller that wanted to boot the world had to know
 * corridor_01's individual asset URLs (`midUrl`, `farUrl`, `foregroundUrl`,
 * …). That coupling is why adding a second corridor meant editing the
 * renderer's call site rather than dropping in content. Here a corridor is
 * addressed by id:
 *
 *     const pack = await loadCorridorPack("corridor_01");
 *
 * …and the pack carries every URL and every piece of structural data the
 * runtime needs, already resolved and already validated.
 *
 * FAILING SAFELY IS THE POINT. A malformed, missing, or merely
 * still-being-authored corridor throws a specific, typed error BEFORE the
 * caller tears down the corridor the player is currently standing in. The
 * transition layer (corridorTransition.ts) relies on that ordering: load and
 * validate the next world first, swap only on success.
 */
import {
  isProductionPlayable,
  parseCorridorManifest,
  type CorridorCapabilities,
  type CorridorLandmark,
  type CorridorManifest,
  type CorridorPopulation,
  type CorridorStage,
  type CorridorVisualReview,
} from "../../../../shared/corridorManifest";

/** Where corridor packs live, mirroring the authored directory layout. */
export const CORRIDOR_ASSET_ROOT = "/assets/goldline";

export type ResolvedCorridorAssets = {
  far: string | null;
  mid: string | null;
  foreground: string | null;
  effects: string | null;
  portal: string | null;
  stronghold: string | null;
  waterfallVideo: string | null;
};

/**
 * A corridor after its manifest has been fetched, validated, and had every
 * relative path resolved against the pack's own directory. This is the only
 * shape the runtime consumes — it never re-reads the raw manifest.
 */
export type ResolvedCorridorPack = {
  id: string;
  version: number;
  stage: CorridorStage;
  visualReview: CorridorVisualReview;
  /** Directory the pack was loaded from; also where anchors/route JSON live. */
  basePath: string;
  assets: ResolvedCorridorAssets;
  data: {
    traversal: string;
    occlusion: string;
    goldRoute: string;
  };
  parallax: { far: number; mid?: number };
  landmarks: CorridorLandmark[];
  population: CorridorPopulation & { atlas: string | null };
  capabilities: CorridorCapabilities;
  loadPriority: { critical: string[]; deferred: string[] };
};

/** Base for every corridor-load failure, so callers can catch one type. */
export class CorridorLoadError extends Error {
  constructor(
    readonly corridorId: string,
    message: string
  ) {
    super(message);
    this.name = "CorridorLoadError";
  }
}

/** No manifest at the expected path, or the fetch itself failed. */
export class CorridorManifestNotFoundError extends CorridorLoadError {
  constructor(corridorId: string, detail: string) {
    super(
      corridorId,
      `corridor '${corridorId}' has no loadable manifest: ${detail}`
    );
    this.name = "CorridorManifestNotFoundError";
  }
}

/** Manifest was found but does not satisfy the authored contract. */
export class CorridorManifestInvalidError extends CorridorLoadError {
  constructor(
    corridorId: string,
    readonly issues: string[]
  ) {
    super(
      corridorId,
      `corridor '${corridorId}' manifest is invalid: ${issues.join("; ")}`
    );
    this.name = "CorridorManifestInvalidError";
  }
}

/**
 * Manifest is structurally valid but the corridor is still being authored.
 * Deliberately distinct from "invalid" — this is a corridor doing exactly
 * what it should, just not ready to be the live world.
 */
export class CorridorNotPlayableError extends CorridorLoadError {
  constructor(
    corridorId: string,
    readonly stage: CorridorStage
  ) {
    super(
      corridorId,
      `corridor '${corridorId}' is stage '${stage}' and cannot be served as the live world`
    );
    this.name = "CorridorNotPlayableError";
  }
}

function joinPath(basePath: string, relative: string): string {
  const trimmedBase = basePath.replace(/\/+$/, "");
  const trimmedRelative = relative.replace(/^\/+/, "");
  return `${trimmedBase}/${trimmedRelative}`;
}

export function corridorBasePath(
  corridorId: string,
  root = CORRIDOR_ASSET_ROOT
): string {
  return `${root.replace(/\/+$/, "")}/${corridorId}`;
}

/**
 * Turns a validated manifest into runtime-ready absolute URLs. Split out from
 * the fetch so it can be unit-tested against a literal manifest object with
 * no network at all.
 */
export function resolveCorridorPack(
  manifest: CorridorManifest,
  basePath: string
): ResolvedCorridorPack {
  const resolveAsset = (value: string | null): string | null =>
    value === null ? null : joinPath(basePath, value);

  return {
    id: manifest.id,
    version: manifest.version,
    stage: manifest.stage,
    visualReview: manifest.visualReview,
    basePath,
    assets: {
      far: resolveAsset(manifest.assets.far),
      mid: resolveAsset(manifest.assets.mid),
      foreground: resolveAsset(manifest.assets.foreground),
      effects: resolveAsset(manifest.assets.effects),
      portal: resolveAsset(manifest.assets.portal),
      stronghold: resolveAsset(manifest.assets.stronghold),
      waterfallVideo: resolveAsset(manifest.assets.waterfallVideo),
    },
    data: {
      traversal: joinPath(basePath, manifest.data.traversal),
      occlusion: joinPath(basePath, manifest.data.occlusion),
      goldRoute: joinPath(basePath, manifest.data.goldRoute),
    },
    parallax: manifest.parallax,
    landmarks: manifest.landmarks,
    population: {
      ...manifest.population,
      atlas: resolveAsset(manifest.population.atlas),
    },
    capabilities: manifest.capabilities,
    loadPriority: manifest.loadPriority,
  };
}

/**
 * The renderer's asset argument shape, built FROM a pack.
 *
 * This is the seam that used to force every caller to know corridor_01's
 * individual URLs. Callers now say `loadCorridorPack(id)` and hand the result
 * here; the only thing they still supply is the Run-1 fallback pair, which is
 * bundled art rather than corridor content.
 */
export type CorridorGameAssets = {
  worldUrl: string;
  operatorUrl: string;
  anchorsBasePath: string;
  midUrl?: string;
  farUrl?: string;
  foregroundUrl?: string;
  effectsUrl?: string;
  portalUrl?: string;
  strongholdUrl?: string;
  characterBasePath?: string;
  parallaxFar?: number;
  population: CorridorPopulation & { atlas: string | null };
};

/**
 * Bundled fallback art. Not corridor content — these ship with the app so the
 * world can always boot, even against a corridor whose optional plates fail.
 */
export type CorridorRuntimeFallbacks = {
  worldUrl: string;
  operatorUrl: string;
  characterBasePath?: string;
};

/** Translates a resolved pack into the renderer's asset arguments. */
export function corridorGameAssets(
  pack: ResolvedCorridorPack,
  fallbacks: CorridorRuntimeFallbacks
): CorridorGameAssets {
  return {
    worldUrl: fallbacks.worldUrl,
    operatorUrl: fallbacks.operatorUrl,
    // Structural data always lives beside the manifest it was declared in,
    // so anchors/route follow the pack rather than a hardcoded corridor path.
    anchorsBasePath: pack.basePath,
    midUrl: pack.assets.mid ?? undefined,
    farUrl: pack.assets.far ?? undefined,
    foregroundUrl: pack.assets.foreground ?? undefined,
    effectsUrl: pack.assets.effects ?? undefined,
    portalUrl: pack.assets.portal ?? undefined,
    strongholdUrl: pack.assets.stronghold ?? undefined,
    characterBasePath: fallbacks.characterBasePath,
    parallaxFar: pack.parallax.far,
    population: pack.population,
  };
}

export type LoadCorridorPackOptions = {
  /** Aborts an in-flight load whose corridor is no longer wanted. */
  signal?: AbortSignal;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Override the asset root (tests/fixtures). */
  root?: string;
  /**
   * When false, an `authoring` corridor resolves instead of throwing — used
   * by validation tooling that legitimately inspects unfinished corridors.
   * The runtime always leaves this true.
   */
  requirePlayable?: boolean;
};

/**
 * Fetches, validates and resolves a corridor pack by id.
 *
 * Throws (never returns a half-built pack) so the caller's existing world
 * stays untouched when the next corridor cannot be trusted.
 */
export async function loadCorridorPack(
  corridorId: string,
  options: LoadCorridorPackOptions = {}
): Promise<ResolvedCorridorPack> {
  const {
    signal,
    fetchImpl = globalThis.fetch,
    root = CORRIDOR_ASSET_ROOT,
    requirePlayable = true,
  } = options;

  const basePath = corridorBasePath(corridorId, root);
  const manifestUrl = joinPath(basePath, "manifest.json");

  let payload: unknown;
  try {
    const response = await fetchImpl(manifestUrl, { signal });
    if (!response.ok) {
      throw new CorridorManifestNotFoundError(
        corridorId,
        `HTTP ${response.status} for ${manifestUrl}`
      );
    }
    payload = await response.json();
  } catch (error) {
    // An abort is the caller's own decision, not a corridor defect — let it
    // propagate untouched so the transition layer can tell the two apart.
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    if (error instanceof CorridorLoadError) throw error;
    throw new CorridorManifestNotFoundError(
      corridorId,
      error instanceof Error ? error.message : String(error)
    );
  }

  const parsed = parseCorridorManifest(payload);
  if (!parsed.success) {
    throw new CorridorManifestInvalidError(
      corridorId,
      parsed.error.issues.map(
        issue => `${issue.path.join(".")}: ${issue.message}`
      )
    );
  }

  // A manifest that disagrees with the directory it was loaded from means the
  // pack was copied or renamed without being re-authored; refuse it rather
  // than serve a corridor under an identity it does not claim.
  if (parsed.data.id !== corridorId) {
    throw new CorridorManifestInvalidError(corridorId, [
      `id: manifest declares '${parsed.data.id}' but was loaded as '${corridorId}'`,
    ]);
  }

  if (requirePlayable && !isProductionPlayable(parsed.data)) {
    throw new CorridorNotPlayableError(corridorId, parsed.data.stage);
  }

  return resolveCorridorPack(parsed.data, basePath);
}
