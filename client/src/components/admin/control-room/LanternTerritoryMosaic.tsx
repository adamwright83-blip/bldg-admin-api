import { useEffect, useMemo, useState } from "react";
import "./lantern-territory-mosaic.css";

type TerritoryMosaicEntry = {
  territoryId: string;
  name: string;
  src: string;
  atlasBBoxPct: { left: number; top: number; width: number; height: number };
  naturalWidth: number;
  naturalHeight: number;
};

type TerritoryMosaicManifest = {
  version: number;
  attribution?: string;
  territories: TerritoryMosaicEntry[];
};

const MANIFEST_URL =
  "/assets/admin/control-room/world/territories-v2/manifest.json";

/**
 * The HD city surface is a puzzle assembled from one continuous registered
 * master. Each piece is cut with Goldline's real projected territory mask, so
 * the browser never has to infer or hand-tune a neighborhood position.
 *
 * The old atlas remains underneath as a safety plate. If the generated package
 * has not landed yet (or a single request fails), the world still renders
 * truthfully instead of showing an empty rectangle.
 */
export function LanternTerritoryMosaic() {
  const [manifest, setManifest] = useState<TerritoryMosaicManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL, { cache: "force-cache" })
      .then(response => {
        if (!response.ok) throw new Error(`mosaic manifest ${response.status}`);
        return response.json() as Promise<TerritoryMosaicManifest>;
      })
      .then(data => {
        if (!cancelled && Array.isArray(data.territories) && data.territories.length) {
          setManifest(data);
        }
      })
      .catch(() => {
        // Intentional silent fallback to the geography-aligned safety atlas.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pieces = useMemo(
    () => manifest?.territories ?? [],
    [manifest]
  );

  if (!pieces.length) return null;

  return (
    <div
      className="lc-territory-mosaic"
      data-territory-count={pieces.length}
      aria-hidden="true"
    >
      {pieces.map(piece => (
        <img
          key={piece.territoryId}
          src={piece.src}
          alt=""
          className="lc-territory-mosaic-piece"
          draggable={false}
          decoding="async"
          style={{
            left: `${piece.atlasBBoxPct.left}%`,
            top: `${piece.atlasBBoxPct.top}%`,
            width: `${piece.atlasBBoxPct.width}%`,
            height: `${piece.atlasBBoxPct.height}%`,
          }}
        />
      ))}
      {manifest?.attribution ? (
        <span className="lc-territory-mosaic-attribution">
          {manifest.attribution}
        </span>
      ) : null}
    </div>
  );
}
