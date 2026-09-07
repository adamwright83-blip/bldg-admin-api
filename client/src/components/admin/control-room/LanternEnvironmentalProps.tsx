import type { CSSProperties } from "react";
import type { TerritoryVisualState } from "@shared/lanternTerritoryVisualState";
import { stableHash } from "@shared/lanternTerritoryVisualState";
import { LANTERN_CITY_V5_ASSETS } from "@/components/goldline/lanternCityV5Assets";

type BBox = { left: number; top: number; width: number; height: number };

const PROP_SETS: Record<
  Exclude<
    TerritoryVisualState,
    "healthy" | "at_risk" | "cooling" | "lost_ground" | "locked_opportunity"
  >,
  readonly (keyof typeof LANTERN_CITY_V5_ASSETS.decayProps)[]
> = {
  overgrown: ["overgrowthVinesA", "overgrowthVinesB"],
  infested: ["ratHero", "ratSwarm", "cockroachHero", "neglectTrash", "toxicFumesA"],
  closed_construction: [
    "constructionScaffold",
    "constructionPlywood",
    "constructionBarriers",
    "constructionBoarded",
  ],
};

function propPlacement(
  territoryId: string,
  state: TerritoryVisualState,
  assetKey: string,
  bbox: BBox
) {
  const seed = stableHash(`${territoryId}:${state}:${assetKey}`);
  const x = bbox.left + ((seed % 1000) / 1000) * bbox.width * 0.7 + bbox.width * 0.1;
  const y = bbox.top + (((seed / 1000) % 1000) / 1000) * bbox.height * 0.7 + bbox.height * 0.1;
  const scale = 0.45 + ((seed % 40) / 100);
  return { x, y, scale };
}

export function LanternEnvironmentalProps({
  territoryId,
  state,
  atlasBBoxPct,
}: {
  territoryId: string;
  state: TerritoryVisualState;
  atlasBBoxPct: BBox;
}) {
  if (
    state === "healthy" ||
    state === "at_risk" ||
    state === "cooling" ||
    state === "lost_ground" ||
    state === "locked_opportunity"
  ) {
    return null;
  }

  const keys = PROP_SETS[state];
  const chosen = keys.filter((_, index) => stableHash(`${territoryId}:${state}:${index}`) % 3 !== 0);
  const limited = chosen.slice(0, state === "infested" ? 3 : 2);

  return (
    <div className="lc-environmental-props" data-territory-id={territoryId} aria-hidden>
      {limited.map(key => {
        const src = LANTERN_CITY_V5_ASSETS.decayProps[key];
        const place = propPlacement(territoryId, state, key, atlasBBoxPct);
        return (
          <img
            key={key}
            src={src}
            alt=""
            loading="lazy"
            draggable={false}
            style={
              {
                left: `${place.x}%`,
                top: `${place.y}%`,
                ["--lc-prop-scale" as string]: place.scale,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}
