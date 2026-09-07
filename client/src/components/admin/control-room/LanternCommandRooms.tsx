import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import type { TerritoryOccupancy } from "@shared/lanternTerritories";
import { frontierKindForTerritory } from "@shared/lanternFrontierPresentation";
import { frontierAssetSrc } from "@/components/goldline/lanternCityV5Assets";
import { COMBAT_TOWER_ART } from "./lanternCityCombat";

const BUILDINGS = [
  {
    id: "century_park_east" as const,
    path: "/growth/tower-wars?building=century_park_east",
    neighborhood: "Century City",
  },
  {
    id: "opus_la" as const,
    path: "/growth/tower-wars?building=opus_la",
    neighborhood: "Koreatown",
  },
];

export function LanternBuildingsRoom({
  onNavigate,
}: {
  onNavigate?: (path: string) => void;
}) {
  return (
    <div className="lc-v5-game-room-body lc-v5-buildings-room">
      <h2>Buildings</h2>
      <p>Canonical strongholds at their real coordinates.</p>
      <div className="lc-v5-building-list">
        {BUILDINGS.map(building => {
          const geo = CANONICAL_BUILDING_GEOGRAPHY[building.id];
          const art = COMBAT_TOWER_ART[building.id];
          return (
            <button
              key={building.id}
              type="button"
              className="lc-v5-building-card"
              onClick={() => onNavigate?.(building.path)}
            >
              <img src={art.hero} alt="" />
              <div>
                <strong>{geo.name}</strong>
                <span>{building.neighborhood}</span>
                <small>{geo.address}</small>
                <em>Enter Tower Wars</em>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LanternConquestRoom({
  frontierObjectives,
  onSelect,
}: {
  frontierObjectives: readonly TerritoryOccupancy[];
  onSelect: (occupation: TerritoryOccupancy) => void;
}) {
  return (
    <div className="lc-v5-game-room-body lc-v5-conquest-room">
      <h2>Conquest</h2>
      <p>What could be — blocked frontier territories with no legitimate customer presence yet.</p>
      {frontierObjectives.length ? (
        <ul className="lc-v5-frontier-list">
          {frontierObjectives.map(occupation => {
            const kind = frontierKindForTerritory(occupation.territory.id);
            return (
              <li key={occupation.territory.id}>
                <button type="button" onClick={() => onSelect(occupation)}>
                  <img src={frontierAssetSrc(kind)} alt="" />
                  <span>
                    <strong>{occupation.territory.name}</strong>
                    <small>Locked frontier · {kind.replace(/([A-Z])/g, " $1")}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>No major blocked frontiers are visible right now.</p>
      )}
    </div>
  );
}
