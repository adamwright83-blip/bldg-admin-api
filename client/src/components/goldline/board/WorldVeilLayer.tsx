import { useMemo, type CSSProperties } from "react";
import { GuardianActor } from "../GuardianActor";
import { BOARD_OVERLAYS } from "@shared/goldlineBoardKit";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
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
  const guarded = occupancy.territories.filter(row => row.guarded);
  const debug =
    new URLSearchParams(location.search).get("territoryDebug") === "1";
  return (
    <>
      <svg
        className="gl-world-veil"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          {guarded.map(({ territory }) => (
            <mask
              id={`territory-${territory.id}`}
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="100"
              height="100"
              key={territory.id}
            >
              <filter
                id={`territory-feather-${territory.id}`}
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
              >
                <feGaussianBlur stdDeviation="1.1" />
              </filter>
              {atlasPolygon(territory).map((ring, i) => (
                <polygon
                  key={i}
                  fill="white"
                  filter={`url(#territory-feather-${territory.id})`}
                  points={ring.map(p => `${p.x},${p.y}`).join(" ")}
                />
              ))}
            </mask>
          ))}
        </defs>
        {guarded.map(({ territory }) => {
          const b = territory.presentation.cloudBounds;
          return (
            <image
              key={territory.id}
              className="gl-territory-cloud"
              href={BOARD_OVERLAYS.fog}
              x={b.xPct - b.widthPct * 0.65}
              y={b.yPct - b.heightPct * 0.7}
              width={Math.max(8, b.widthPct * 1.3)}
              height={Math.max(8, b.heightPct * 1.4)}
              preserveAspectRatio="xMidYMid slice"
              mask={`url(#territory-${territory.id})`}
            />
          );
        })}
      </svg>
      {guarded.map(occupation => {
        const { territory } = occupation,
          a = territory.presentation.guardianAnchor,
          l = territory.presentation.lockAnchor;
        return (
          <div
            className="gl-veil-guardian"
            data-territory-id={territory.id}
            key={territory.id}
            style={
              {
                left: `${a.xPct}%`,
                top: `${a.yPct}%`,
                "--territory-guardian-scale": a.scale,
              } as CSSProperties
            }
          >
            <GuardianActor
              guardianId={territory.initialGuardianId!}
              phase="notice"
            />
            <img
              className="gl-territory-lock"
              src="/assets/goldline/guardians/v1/lock-seal.png"
              alt=""
              style={
                {
                  left: `${50 + (l.xPct - a.xPct) * 5}%`,
                  top: `${50 + (l.yPct - a.yPct) * 5}%`,
                  "--territory-lock-scale": l.scale,
                } as CSSProperties
              }
            />
            <button
              className="gl-veil-guardian-hit"
              type="button"
              onClick={() => onConfront?.(occupation)}
              aria-label={`${territory.name} is locked by its Cloud Guardian`}
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
