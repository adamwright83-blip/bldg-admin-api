import { useMemo } from "react";
import type { CSSProperties } from "react";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import {
  atlasPolygon,
  deriveTerritoryOccupancy,
  territoryCenter,
  type TerritoryOccupancy,
} from "@shared/lanternTerritories";
import {
  frontierAssetSrc,
  frontierKindForTerritory,
  lostGroundAssetForFrontierKind,
  LANTERN_CITY_V5_ASSETS,
} from "@/components/goldline/lanternCityV5Assets";
import {
  deriveTerritoryVisualState,
} from "@shared/lanternTerritoryVisualState";

const MAX_VISIBLE_FRONTIER = 5;

export function FrontierWorldLayer({
  customerLocations,
  totalCustomers,
  atlasReady,
  conqueredTerritoryIds,
  lostGroundTerritoryIds,
  onConfront,
}: {
  customerLocations: readonly { latitude: number; longitude: number }[];
  totalCustomers: number;
  atlasReady: boolean;
  conqueredTerritoryIds?: ReadonlySet<string>;
  lostGroundTerritoryIds?: ReadonlySet<string>;
  onConfront?: (occupation: TerritoryOccupancy) => void;
}) {
  const occupancy = useMemo(
    () =>
      deriveTerritoryOccupancy({
        customers: customerLocations,
        totalCustomers,
        atlasReady,
        conqueredTerritoryIds,
      }),
    [customerLocations, totalCustomers, atlasReady, conqueredTerritoryIds]
  );

  if (occupancy.suppressed) return null;

  const debug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("territoryDebug") === "1";

  const frontier = occupancy.territories
    .filter(row => row.guarded)
    .slice(0, MAX_VISIBLE_FRONTIER);

  const lostGround = occupancy.territories.filter(row => {
    if (row.customerCount > 0) return false;
    if (row.guarded) return false;
    return lostGroundTerritoryIds?.has(row.territory.id) ?? false;
  });

  return (
    <>
      {frontier.map(occupation => {
        const { territory } = occupation;
        const anchor = territory.presentation.guardianAnchor;
        const kind = frontierKindForTerritory(territory.id);
        return (
          <div
            className="lc-frontier-object"
            data-territory-id={territory.id}
            data-frontier-kind={kind}
            key={`frontier-${territory.id}`}
            style={
              {
                left: `${anchor.xPct}%`,
                top: `${anchor.yPct}%`,
                ["--lc-frontier-scale" as string]: anchor.scale,
              } as CSSProperties
            }
          >
            <img
              className="lc-frontier-freedom-art"
              src={frontierAssetSrc(kind)}
              alt=""
              draggable={false}
            />
            <img
              className="lc-frontier-lock-art"
              src={LANTERN_CITY_V5_ASSETS.frontier.lock}
              alt=""
              draggable={false}
            />
            <button
              className="lc-frontier-hit"
              type="button"
              onClick={() => onConfront?.(occupation)}
              aria-label={`${territory.name}: What could be — locked frontier objective`}
            />
          </div>
        );
      })}

      {lostGround.map(occupation => {
        const { territory } = occupation;
        const center = territoryCenter(territory);
        const point = projectLatLngToLanternAtlas(center);
        if (point.outOfBounds) return null;
        const kind = frontierKindForTerritory(territory.id);
        const state = deriveTerritoryVisualState({
          territoryId: territory.id,
          active: 0,
          dimming: 0,
          dark: 0,
          guarded: false,
          conquered: false,
          pressureReturned: true,
        });
        return (
          <div
            className="lc-lost-ground-object"
            data-territory-id={territory.id}
            data-visual-state={state}
            key={`lost-${territory.id}`}
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <img
              src={lostGroundAssetForFrontierKind(kind)}
              alt=""
              draggable={false}
            />
            <span className="lc-lost-ground-label">What was</span>
          </div>
        );
      })}

      {debug ? (
        <>
          <svg
            className="gl-territory-debug"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {occupancy.territories.map(row =>
              atlasPolygon(row.territory).map((ring, i) => (
                <polygon
                  className={
                    row.guarded
                      ? "is-guarded"
                      : row.customerCount
                        ? "has-customers"
                        : row.conquered
                          ? "is-lost"
                          : "is-clear"
                  }
                  key={`${row.territory.id}-${i}`}
                  points={ring.map(p => `${p.x},${p.y}`).join(" ")}
                />
              ))
            )}
          </svg>
          <aside className="gl-territory-debug-ledger">
            <strong>TERRITORY TRUTH</strong>
            {occupancy.territories
              .filter(
                row =>
                  row.guarded ||
                  row.customerCount > 0 ||
                  row.territory.presentation.majorLabel
              )
              .map(row => (
                <span key={row.territory.id}>
                  <b>{row.territory.id}</b> customers: {row.customerCount} ·
                  GUARDED: {row.guarded ? "YES" : "NO"}
                </span>
              ))}
          </aside>
        </>
      ) : null}
    </>
  );
}

/** @deprecated Use FrontierWorldLayer — veil metaphor retired in v5. */
export const WorldVeilLayer = FrontierWorldLayer;
