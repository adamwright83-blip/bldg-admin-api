import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  deriveTerritoryOccupancy,
  classifyTerritory,
  LANTERN_TERRITORIES,
  territoryCenter,
} from "@shared/lanternTerritories";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import {
  deriveTerritoryVisualState,
  gelOpacityForState,
  gelTintForState,
  territoryStateHasEvidence,
  territoryVisualStateLabel,
  type TerritoryVisualState,
} from "@shared/lanternTerritoryVisualState";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";
import { territoryMaskSrc } from "@shared/territoryMaskPackage";
import type { GeographicCustomer } from "./customerGeography";
import { LanternEnvironmentalProps } from "./LanternEnvironmentalProps";
import { useFeatheredTerritoryMasks } from "./useFeatheredTerritoryMasks";

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

/**
 * Where a territory's nameplate sits: the projected centroid of its real
 * WGS84 geometry, through the same projection every lantern uses. Never
 * estimated from the painting.
 */
function nameplatePoint(territoryId: string) {
  const territory = LANTERN_TERRITORIES.find(row => row.id === territoryId);
  if (!territory) return null;
  const point = projectLatLngToLanternAtlas(territoryCenter(territory));
  if (point.outOfBounds) return null;
  return { x: point.x, y: point.y };
}

const TOWER_POINTS = Object.values(CANONICAL_BUILDING_GEOGRAPHY)
  .map(geo => projectLatLngToLanternAtlas(geo))
  .filter(point => !point.outOfBounds)
  .map(point => ({ x: point.x, y: point.y }));

/**
 * Label placement only — geography is untouched. A nameplate is a caption,
 * and a caption must not sit on top of a stronghold or another caption:
 *  - at a tower's base it drops below the tower's own name,
 *  - inside the tower's silhouette it steps sideways, away from the tower,
 *  - two captions that would stack step apart vertically.
 */
function placeNameplates<T extends { territoryId: string }>(
  rows: readonly T[]
): Array<T & { x: number; y: number }> {
  const placed: Array<T & { x: number; y: number }> = [];
  for (const row of rows) {
    const point = nameplatePoint(row.territoryId);
    if (!point) continue;
    let { x, y } = point;
    for (const tower of TOWER_POINTS) {
      const dx = x - tower.x;
      const dy = y - tower.y;
      // The tower's own nameplate + subtitle span ~13% of the atlas width.
      if (Math.abs(dx) < 13 && dy > -6 && dy < 5) {
        y = tower.y + 7.5;
      } else if (Math.abs(dx) < 11 && dy <= -6 && dy > -26) {
        x = dx >= 0 ? tower.x + 11 : tower.x - 11;
      }
    }
    // The command deck owns the bottom ~20% of the viewport: plates that land
    // there step up onto the visible map instead of under the deck.
    y = Math.min(78, y);
    for (const other of placed) {
      if (Math.abs(other.x - x) < 11 && Math.abs(other.y - y) < 6.5) {
        y = other.y > 71 ? other.y - 6.5 : other.y + 6.5;
      }
    }
    // Keep the plate (≈11% wide at its widest chip) inside the atlas.
    x = Math.min(93.5, Math.max(6.5, x));
    y = Math.min(78, Math.max(4, y));
    placed.push({ ...row, x, y });
  }
  return placed;
}

function nameplateStatus(
  state: TerritoryVisualState,
  total: number,
  guarded: boolean
): string {
  if (state === "locked_opportunity") {
    return guarded ? "What could be · Locked" : "Locked";
  }
  if (state === "lost_ground") return "What was · Re-earn";
  const label = territoryVisualStateLabel(state);
  return total > 0 ? `${label} · ${total}` : label;
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
      const input = {
        territoryId: plate.territoryId,
        active: mix.active,
        dimming: mix.dimming,
        dark: mix.dark,
        guarded: row?.guarded ?? false,
        conquered: row?.conquered ?? false,
        pressureReturned: lostGroundTerritoryIds?.has(plate.territoryId) ?? false,
      };
      const state = deriveTerritoryVisualState(input);
      const total = mix.active + mix.dimming + mix.dark;
      return {
        plate,
        state,
        total,
        guarded: input.guarded,
        hasEvidence: territoryStateHasEvidence(input),
      };
    });
  }, [plates, occupancy, customers, businessDate, lostGroundTerritoryIds]);

  const masks = useFeatheredTerritoryMasks(
    useMemo(() => plates.map(plate => plate.territoryId), [plates])
  );

  // Until customers are classified, the whole city would read as "locked".
  // Hold the gels back rather than flash a false state.
  if (!plates.length || occupancy.suppressed) return null;

  const gelRows = rows.filter(row => row.hasEvidence);
  const nameplateRows = rows.filter(
    row =>
      row.total > 0 ||
      row.state === "lost_ground" ||
      (row.state === "locked_opportunity" && row.guarded) ||
      selectedTerritoryId === row.plate.territoryId ||
      hoveredTerritoryId === row.plate.territoryId
  );

  // Three sibling layers in atlas space so each can take its own z-index:
  // gels (1) → props (2) → nameplates (10). Nesting them inside the gel layer
  // would trap the nameplates in the gel stacking context under the lanterns.
  return (
    <>
    <div
      className="lc-territory-state-layer"
      aria-hidden={!debug}
      data-business-date={businessDate}
      data-gel-count={gelRows.length}
    >
      {gelRows.map(({ plate, state }) => {
        const gel =
          LANTERN_CITY_V5_ASSETS.territoryGels[
            state as keyof typeof LANTERN_CITY_V5_ASSETS.territoryGels
          ];
        const b = plate.atlasBBoxPct;
        const emphasized =
          selectedTerritoryId === plate.territoryId ||
          hoveredTerritoryId === plate.territoryId;
        const tint = gelTintForState(state);
        const feathered = masks[plate.territoryId];
        const maskUrl = `url(${feathered ?? territoryMaskSrc(plate.territoryId)})`;
        return (
          <div
            key={plate.territoryId}
            className={`lc-territory-gel state-${state}${emphasized ? " is-emphasized" : ""}${feathered ? " is-feathered" : ""}`}
            data-territory-id={plate.territoryId}
            data-visual-state={state}
            style={
              {
                left: `${b.left}%`,
                top: `${b.top}%`,
                width: `${b.width}%`,
                height: `${b.height}%`,
                "--lc-gel-opacity": gelOpacityForState(state),
                "--lc-gel-tint": tint.color,
                "--lc-gel-tint-opacity": tint.opacity,
                WebkitMaskImage: maskUrl,
                maskImage: maskUrl,
              } as CSSProperties
            }
            title={
              debug
                ? `${plate.name}: ${territoryVisualStateLabel(state)}`
                : undefined
            }
          >
            <span className="lc-territory-gel-tint" />
            <img
              className="lc-territory-gel-texture"
              src={gel}
              alt=""
              draggable={false}
              loading="lazy"
            />
          </div>
        );
      })}
    </div>

      {/* Props live in atlas space, above every gel and below the lanterns. */}
      <div className="lc-environmental-props-layer" aria-hidden>
        {gelRows.map(({ plate, state }) => (
          <LanternEnvironmentalProps
            key={plate.territoryId}
            territoryId={plate.territoryId}
            state={state}
            atlasBBoxPct={plate.atlasBBoxPct}
          />
        ))}
      </div>

      <div className="lc-territory-nameplates" aria-hidden>
        {placeNameplates(
          nameplateRows.map(row => ({ ...row, territoryId: row.plate.territoryId }))
        ).map(({ plate, state, total, guarded, x, y }) => {
          const emphasized =
            selectedTerritoryId === plate.territoryId ||
            hoveredTerritoryId === plate.territoryId;
          return (
            <div
              key={plate.territoryId}
              className={`lc-territory-nameplate state-${state}${emphasized ? " is-emphasized" : ""}`}
              data-territory-id={plate.territoryId}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <span className="lc-territory-nameplate-name">{plate.name}</span>
              <span className="lc-territory-nameplate-status">
                {nameplateStatus(state, total, guarded)}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

export type { TerritoryVisualState };
