import { useEffect, useMemo, useState } from "react";
import { deriveTerritoryOccupancy, classifyTerritory } from "@shared/lanternTerritories";
import {
  deriveTerritoryVisualState,
  gelOpacityForState,
  territoryVisualStateLabel,
  type TerritoryVisualState,
} from "@shared/lanternTerritoryVisualState";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";
import { territoryMaskSrc } from "@shared/territoryMaskPackage";
import type { GeographicCustomer } from "./customerGeography";
import { LanternEnvironmentalProps } from "./LanternEnvironmentalProps";

type TerritoryPlate = {
  territoryId: string;
  name: string;
  atlasBBoxPct: { left: number; top: number; width: number; height: number };
};

type Props = {
  customers: readonly GeographicCustomer[];
  atlasReady: boolean;
  businessDate: string;
  conqueredTerritoryIds?: ReadonlySet<string>;
  lostGroundTerritoryIds?: ReadonlySet<string>;
  selectedTerritoryId?: string | null;
  hoveredTerritoryId?: string | null;
};

function cadenceMixForTerritory(
  customers: readonly GeographicCustomer[],
  territoryId: string
) {
  const mix = { active: 0, dimming: 0, dark: 0 };
  for (const customer of customers) {
    if (!customer.location) continue;
    const territory = classifyTerritory(
      customer.location.latitude,
      customer.location.longitude
    );
    if (territory?.id !== territoryId) continue;
    mix[customer.cadence.state] += 1;
  }
  return mix;
}

export function LanternTerritoryStateLayer({
  customers,
  atlasReady,
  businessDate,
  conqueredTerritoryIds,
  lostGroundTerritoryIds,
  selectedTerritoryId,
  hoveredTerritoryId,
}: Props) {
  const [plates, setPlates] = useState<TerritoryPlate[]>([]);
  const debug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("territoryDebug") === "1";

  useEffect(() => {
    let live = true;
    fetch("/assets/admin/control-room/world/territories-v2/manifest.json")
      .then(response => response.json())
      .then(data => {
        if (!live) return;
        setPlates(
          (data.territories ?? []).map(
            (row: {
              territoryId: string;
              name: string;
              atlasBBoxPct: TerritoryPlate["atlasBBoxPct"];
            }) => ({
              territoryId: row.territoryId,
              name: row.name,
              atlasBBoxPct: row.atlasBBoxPct,
            })
          )
        );
      })
      .catch(() => {
        /* atlas master remains visible without gels */
      });
    return () => {
      live = false;
    };
  }, []);

  const occupancy = useMemo(
    () =>
      deriveTerritoryOccupancy({
        customers: customers.flatMap(customer =>
          customer.location
            ? [
                {
                  latitude: customer.location.latitude,
                  longitude: customer.location.longitude,
                },
              ]
            : []
        ),
        totalCustomers: customers.length,
        atlasReady,
        conqueredTerritoryIds,
      }),
    [customers, atlasReady, conqueredTerritoryIds]
  );

  const rows = useMemo(() => {
    return plates.map(plate => {
      const row = occupancy.territories.find(
        item => item.territory.id === plate.territoryId
      );
      const mix = cadenceMixForTerritory(customers, plate.territoryId);
      const state = deriveTerritoryVisualState({
        territoryId: plate.territoryId,
        active: mix.active,
        dimming: mix.dimming,
        dark: mix.dark,
        guarded: row?.guarded ?? false,
        conquered: row?.conquered ?? false,
        pressureReturned: lostGroundTerritoryIds?.has(plate.territoryId) ?? false,
      });
      return { plate, state };
    });
  }, [plates, occupancy, customers, businessDate, lostGroundTerritoryIds]);

  if (!plates.length) return null;

  return (
    <div
      className="lc-territory-state-layer"
      aria-hidden={!debug}
      data-business-date={businessDate}
    >
      {rows.map(({ plate, state }) => {
        const gel =
          LANTERN_CITY_V5_ASSETS.territoryGels[
            state as keyof typeof LANTERN_CITY_V5_ASSETS.territoryGels
          ];
        const b = plate.atlasBBoxPct;
        const emphasized =
          selectedTerritoryId === plate.territoryId ||
          hoveredTerritoryId === plate.territoryId;
        return (
          <div
            key={plate.territoryId}
            className={`lc-territory-gel state-${state}${emphasized ? " is-emphasized" : ""}`}
            data-territory-id={plate.territoryId}
            data-visual-state={state}
            style={{
              left: `${b.left}%`,
              top: `${b.top}%`,
              width: `${b.width}%`,
              height: `${b.height}%`,
              ["--lc-gel-opacity" as string]: gelOpacityForState(state),
              WebkitMaskImage: `url(${territoryMaskSrc(plate.territoryId)})`,
              maskImage: `url(${territoryMaskSrc(plate.territoryId)})`,
            }}
            title={
              debug
                ? `${plate.name}: ${territoryVisualStateLabel(state)}`
                : undefined
            }
          >
            <img src={gel} alt="" draggable={false} loading="lazy" />
            <LanternEnvironmentalProps
              territoryId={plate.territoryId}
              state={state}
              atlasBBoxPct={b}
            />
          </div>
        );
      })}
    </div>
  );
}

export type { TerritoryVisualState };
