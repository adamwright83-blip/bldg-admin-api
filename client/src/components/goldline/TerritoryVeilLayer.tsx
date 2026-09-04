/**
 * White-gold territory veil.
 *
 * Presentation only. Membership is physicalEntityIds; this layer paints a
 * sun-bleached crust over real atlas positions and opens apertures where
 * Chronicle already recorded the configured action. Looking at it does nothing.
 */

import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import { challengeSummary, type TerritoryDefinition, type TerritoryDerivedState } from "@shared/goldlineTerritories";
import { buildVeilGeometry, polygonToSvgPath } from "@shared/goldlineTerritoryGeometry";
import type { CityWorldEntity } from "../../../../server/goldlineWorld/cityWorldService";

export function TerritoryVeilLayer({
  definition,
  state,
  entities,
  reducedMotion = false,
}: {
  definition: TerritoryDefinition;
  state: TerritoryDerivedState;
  entities: readonly CityWorldEntity[];
  reducedMotion?: boolean;
}) {
  const members = definition.members.flatMap(member => {
    const entity = entities.find(item => item.id === member.physicalEntityId);
    const latitude = entity?.location?.latitude;
    const longitude = entity?.location?.longitude;
    if (typeof latitude !== "number" || typeof longitude !== "number") return [];
    const atlas = projectLatLngToLanternAtlas({ latitude, longitude });
    if (atlas.outOfBounds) return [];
    return [{ physicalEntityId: member.physicalEntityId, atlas: { x: atlas.x, y: atlas.y } }];
  });
  if (!members.length) return null;
  const geometry = buildVeilGeometry({ mode: definition.geometryMode, members });
  const path = polygonToSvgPath(geometry.polygon);
  const cleared = state.cleared;
  const progress = state.members.length
    ? state.completedMemberIds.length / state.members.length
    : 0;

  return (
    <div
      className={`gl-territory-veil readiness-${state.readiness}${cleared ? " is-cleared" : ""}${reducedMotion ? " is-reduced" : ""}`}
      data-testid={`goldline-territory-${definition.id}`}
      data-territory-id={definition.id}
      data-guardian-id={definition.guardianId}
      style={{ pointerEvents: "none" }}
    >
      <svg
        className="gl-territory-veil-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id={`veil-fill-${definition.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="rgba(255,248,230,0.72)" />
            <stop offset="55%" stopColor="rgba(232,210,150,0.55)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.4)" />
          </linearGradient>
          <filter id={`veil-dust-${definition.id}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2" />
            <feColorMatrix values="0 0 0 0 0.95  0 0 0 0 0.88  0 0 0 0 0.7  0 0 0 0.18 0" />
          </filter>
          <mask id={`veil-mask-${definition.id}`}>
            <rect width="100" height="100" fill="white" />
            {geometry.memberApertures.map(aperture => {
              const opened = state.completedMemberIds.includes(aperture.physicalEntityId) || cleared;
              const radius = opened ? aperture.radius * (cleared ? 3.4 : 1) : aperture.radius * 0.18;
              return (
                <circle
                  key={aperture.physicalEntityId}
                  cx={aperture.point.x}
                  cy={aperture.point.y}
                  r={radius}
                  fill="black"
                  data-aperture={aperture.physicalEntityId}
                  data-opened={opened ? "true" : "false"}
                />
              );
            })}
          </mask>
        </defs>
        {path ? (
          <path
            d={path}
            fill={`url(#veil-fill-${definition.id})`}
            mask={`url(#veil-mask-${definition.id})`}
            className="gl-territory-crust"
            opacity={cleared ? 0 : 0.92 - progress * 0.25}
          />
        ) : null}
        {geometry.memberApertures.map(aperture => {
          const opened = state.completedMemberIds.includes(aperture.physicalEntityId);
          if (!opened || cleared) return null;
          return (
            <g key={`crack-${aperture.physicalEntityId}`} className="gl-territory-crack">
              <path
                d={`M ${aperture.point.x - 1.1} ${aperture.point.y} L ${aperture.point.x} ${aperture.point.y - 1.6} L ${aperture.point.x + 1.1} ${aperture.point.y}`}
                stroke="#e8c15a"
                strokeWidth="0.35"
                fill="none"
              />
            </g>
          );
        })}
      </svg>
      <span className="sr-only">{challengeSummary({ definition, state })}</span>
    </div>
  );
}
