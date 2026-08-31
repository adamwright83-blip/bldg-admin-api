import React, { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import type { CanonicalBuildingId } from "./buildingArt";
import { CityTowerButton } from "./CityTowerButton";
import { WorldAtmosphereOverlay } from "./WorldAtmosphereOverlay";
import { GoogleMapsRealityLayer, type GeographicCameraTarget, type RealityRendererType } from "./GoogleMapsRealityLayer";
import { RealityWindow } from "./RealityWindow";
import { GoogleAttributionSafeZone } from "./GoogleAttributionSafeZone";

const ATLAS_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas.jpg";

export type WorldGeographySurfaceProps = {
  mode?: "overview" | "lantern_atlas" | "reality_approach";
  selectedBuildingId?: CanonicalBuildingId | null;
  onSelectBuilding?: (id: CanonicalBuildingId) => void;
  onNavigate?: (path: string) => void;
  showNeighborhoods?: boolean;
  showOpportunityLayer?: boolean;
  showLanterns?: boolean;
  children?: React.ReactNode;
  className?: string;
};

const CANONICAL_TOWERS: Array<{
  id: CanonicalBuildingId;
  name: string;
  latitude: number;
  longitude: number;
  neighborhood: string;
}> = [
  {
    id: "century_park_east",
    name: "Century Park East",
    latitude: 34.0591,
    longitude: -118.4147,
    neighborhood: "Century City",
  },
  {
    id: "opus_la",
    name: "OPUS LA",
    latitude: 34.0618,
    longitude: -118.3011,
    neighborhood: "Koreatown",
  },
];

export function WorldGeographySurface({
  mode = "overview",
  selectedBuildingId,
  onSelectBuilding,
  onNavigate,
  showNeighborhoods = true,
  showOpportunityLayer = true,
  showLanterns = false,
  children,
  className = "",
}: WorldGeographySurfaceProps) {
  const [realityBuildingId, setRealityBuildingId] = useState<CanonicalBuildingId | null>(null);
  const [viewMode, setViewMode] = useState<"atlas" | "reality_3d">("atlas");

  // Query live atmosphere & runtime config from backend
  const atmosphereQuery = trpc.system.google.atmosphere.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const opportunityQuery = trpc.system.google.opportunityPressure.useQuery(undefined, {
    staleTime: 300_000,
  });

  const runtimeConfigQuery = trpc.system.google.runtimeConfig.useQuery(undefined, {
    staleTime: Infinity,
  });

  const mapsApiKey = runtimeConfigQuery.data?.mapsJavascriptApiKey;
  const atmosphere = atmosphereQuery.data ?? null;
  const opportunity = opportunityQuery.data?.projection ?? null;

  const cameraTarget: GeographicCameraTarget = useMemo(() => {
    if (selectedBuildingId === "opus_la") {
      return { latitude: 34.0618, longitude: -118.3011, zoom: 16, tilt: 55, heading: 195 };
    }
    if (selectedBuildingId === "century_park_east") {
      return { latitude: 34.0591, longitude: -118.4147, zoom: 16, tilt: 55, heading: 140 };
    }
    return { latitude: 34.0522, longitude: -118.2437, zoom: 12, tilt: 45, heading: 0 };
  }, [selectedBuildingId]);

  return (
    <div
      className={`cr-world-geography-surface mode-${mode} view-${viewMode} ${className}`}
      data-day-phase={atmosphere?.dayPhase ?? "day"}
    >
      {/* 1. Base Layer: Authored Atlas Skin vs Google Reality 3D Layer */}
      {viewMode === "reality_3d" && mapsApiKey ? (
        <GoogleMapsRealityLayer
          apiKey={mapsApiKey}
          target={cameraTarget}
          mode="maps_js_3d"
          className="cr-world-reality-engine"
        />
      ) : (
        <div className="cr-world-skin-container">
          <img
            src={ATLAS_IMAGE}
            alt="Authoritative Los Angeles customer geography"
            className="cr-world-skin-img"
          />
          <div className="cr-world-skin-shade" />
        </div>
      )}

      {/* 2. Living Atmosphere Overlay: real clouds, AQI haze, rain */}
      <WorldAtmosphereOverlay atmosphere={atmosphere} />

      {/* 3. Places Aggregate Opportunity Density / Territory Glow */}
      {showOpportunityLayer && opportunity ? (
        <div className="cr-opportunity-layer" aria-hidden="true">
          {opportunity.districts.map(district => (
            <div
              key={district.districtId}
              className={`cr-district-glow pressure-${district.opportunityPressure}`}
              style={{
                left: `${district.atlasAnchor.x}%`,
                top: `${district.atlasAnchor.y}%`,
                opacity: district.intensityScore * 0.75,
              }}
              title={`${district.name}: ${district.opportunityPressure.replace(/_/g, " ")}`}
            />
          ))}
        </div>
      ) : null}

      {/* 4. Strategic Neighborhood Labels */}
      {showNeighborhoods && viewMode === "atlas" ? (
        <div className="cr-world-neighborhoods" aria-hidden="true">
          {opportunity?.districts.map(district => (
            <span
              key={district.districtId}
              className="cr-world-neighborhood-label"
              style={{
                left: `${district.atlasAnchor.x}%`,
                top: `${district.atlasAnchor.y}%`,
              }}
            >
              {district.name}
            </span>
          )) ?? null}
        </div>
      ) : null}

      {/* 5. Canonical Building Towers (at real coordinates) */}
      <div className="cr-world-towers-layer">
        {CANONICAL_TOWERS.map(tower => {
          const pt = projectLatLngToLanternAtlas(tower);
          const edgeSafe = {
            x: Math.min(94, Math.max(8, pt.x)),
            y: Math.min(92, Math.max(8, pt.y)),
          };

          return (
            <div
              key={tower.id}
              className={`cr-world-tower-anchor ${selectedBuildingId === tower.id ? "is-selected" : ""}`}
              style={{ left: `${edgeSafe.x}%`, top: `${edgeSafe.y}%` }}
            >
              <CityTowerButton
                buildingId={tower.id}
                className={`pwc-building ${tower.id === "opus_la" ? "opus" : "cpe"}`}
                onNavigate={path => {
                  onSelectBuilding?.(tower.id);
                  onNavigate?.(path);
                }}
                subtitle={`${tower.neighborhood} · TODAY battle truth`}
              />
              <button
                type="button"
                className="cr-reality-trigger-btn"
                onClick={() => setRealityBuildingId(tower.id)}
                title={`Open real place evidence for ${tower.name}`}
                aria-label={`Open real place evidence for ${tower.name}`}
              >
                ⌖ Reality
              </button>
            </div>
          );
        })}
      </div>

      {/* Additional UI elements (lanterns, search, controls passed as children) */}
      {children}

      {/* Reality Window for Grounded Real Place identity */}
      {realityBuildingId ? (
        <RealityWindow
          buildingId={realityBuildingId}
          onClose={() => setRealityBuildingId(null)}
        />
      ) : null}

      {/* Switch between Authored Atlas and 3D Reality Layer if Maps JS is configured */}
      {mapsApiKey ? (
        <div className="cr-world-view-switcher">
          <button
            type="button"
            className={viewMode === "atlas" ? "is-active" : ""}
            onClick={() => setViewMode("atlas")}
          >
            One World Atlas
          </button>
          <button
            type="button"
            className={viewMode === "reality_3d" ? "is-active" : ""}
            onClick={() => setViewMode("reality_3d")}
          >
            3D Reality View
          </button>
        </div>
      ) : null}

      {/* Protected Google Attribution */}
      <GoogleAttributionSafeZone visible={viewMode === "reality_3d"} />
    </div>
  );
}
