import { useMemo, type CSSProperties } from "react";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import {
  frontierAssetForTerritory,
  LANTERN_CITY_ASSETS,
} from "../lanternCityAssets";
import {
  atlasPolygon,
  classifyTerritory,
  deriveTerritoryOccupancy,
  type TerritoryOccupancy,
} from "@shared/lanternTerritories";

export function WorldVeilLayer({
  customerLocations,
  totalCustomers,
  atlasReady,
  conqueredTerritoryIds,
  onConfront,
}: {
  customerLocations: readonly { latitude: number; longitude: number }[];
  totalCustomers: number;
  atlasReady: boolean;
  conqueredTerritoryIds?: ReadonlySet<string>;
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
  const guarded = occupancy.territories.filter(row => row.guarded).slice(0, 5);
  const debug =
    new URLSearchParams(location.search).get("territoryDebug") === "1";
  return (
    <>
      <div className="gl-future-objective" aria-hidden="true">
        <img src={LANTERN_CITY_ASSETS.futureCage.src} alt="" />
        <span>A brighter tomorrow awaits</span>
      </div>
      {guarded.map(occupation => {
        const { territory } = occupation,
          a = territory.presentation.guardianAnchor,
          asset = frontierAssetForTerritory(territory.id);
        if (!asset) return null;
        return (
          <div
            className="gl-freedom-object"
            data-territory-id={territory.id}
            data-asset-id={asset.id}
            data-state={asset.state}
            key={territory.id}
            style={
              {
                left: `${a.xPct}%`,
                top: `${a.yPct}%`,
                "--freedom-object-scale": asset.recommendedScale,
              } as CSSProperties
            }
          >
            <img
              className="gl-freedom-object-art"
              src={asset.src}
              alt=""
            />
            <button
              className="gl-freedom-object-hit"
              type="button"
              onClick={() => onConfront?.(occupation)}
              aria-label={`${territory.name}: locked freedom objective`}
            />
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
                        : "is-clear"
                  }
                  key={`${row.territory.id}-${i}`}
                  points={ring.map(p => `${p.x},${p.y}`).join(" ")}
                />
              ))
            )}
            {customerLocations.map((customer, index) => {
              const point = projectLatLngToLanternAtlas(customer);
              const territory = classifyTerritory(
                customer.latitude,
                customer.longitude
              );
              return (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r=".55"
                  data-territory-id={territory?.id ?? "unclassified"}
                />
              );
            })}
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
            {occupancy.unclassified ? (
              <em>unclassified customers: {occupancy.unclassified}</em>
            ) : null}
          </aside>
        </>
      ) : null}
    </>
  );
}
