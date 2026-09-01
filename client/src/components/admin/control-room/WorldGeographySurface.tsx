import React, { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { GOLDLINE_LA_LANDMARKS, projectLatLngToLanternAtlas } from "@shared/lanternCity";
import {
  CANONICAL_BUILDING_GEOGRAPHY,
  LOS_ANGELES_ESTABLISHING,
  canonicalGeographyFor,
} from "@shared/canonicalGeography";
import type { CanonicalBuildingId } from "./buildingArt";
import { CityTowerButton } from "./CityTowerButton";
import { WorldAtmosphereOverlay } from "./WorldAtmosphereOverlay";
import { GoogleMapsRealityLayer, type GeographicCameraTarget, type GeographicEntity, type RealityRendererType } from "./GoogleMapsRealityLayer";
import { RealityWindow } from "./RealityWindow";
import { GoogleAttributionSafeZone } from "./GoogleAttributionSafeZone";
import { useWorldCamera } from "./useWorldCamera";

const ATLAS_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas-v2.webp";

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
  battleState?: { pressureBuilding: CanonicalBuildingId | null; revenueCue: CanonicalBuildingId | null; revenues: Record<CanonicalBuildingId, number | null> };
  /**
   * Entities the caller wants placed by real coordinate while Google is
   * drawing. They are handed to the renderer, never positioned with atlas
   * percentages.
   */
  geographicEntities?: GeographicEntity[];
  /**
   * Announces whether Google is currently the base layer, so callers can hide
   * their own atlas-percentage overlays instead of pinning them over real
   * geography they do not correspond to.
   */
  onGoogleVisibilityChange?: (googleVisible: boolean) => void;
  focusPoint?: { x: number; y: number } | null;
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
    name: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.name,
    latitude: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.latitude,
    longitude: CANONICAL_BUILDING_GEOGRAPHY.century_park_east.longitude,
    neighborhood: "Century City",
  },
  {
    id: "opus_la",
    name: CANONICAL_BUILDING_GEOGRAPHY.opus_la.name,
    latitude: CANONICAL_BUILDING_GEOGRAPHY.opus_la.latitude,
    longitude: CANONICAL_BUILDING_GEOGRAPHY.opus_la.longitude,
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
  battleState,
  geographicEntities,
  onGoogleVisibilityChange,
  focusPoint,
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

  // Position comes from canonical geography; zoom/tilt are presentation choices.
  const cameraTarget: GeographicCameraTarget = useMemo(() => {
    const geo = canonicalGeographyFor(selectedBuildingId);
    if (geo) {
      return {
        latitude: geo.latitude,
        longitude: geo.longitude,
        heading: geo.facadeHeading,
        zoom: 16,
        tilt: 55,
      };
    }
    return {
      latitude: LOS_ANGELES_ESTABLISHING.latitude,
      longitude: LOS_ANGELES_ESTABLISHING.longitude,
      zoom: 12,
      tilt: 45,
      heading: 0,
    };
  }, [selectedBuildingId]);

  // Google is the base layer only when 3D view is chosen AND a key exists.
  const googleVisible = viewMode === "reality_3d" && Boolean(mapsApiKey);
  useEffect(() => {
    onGoogleVisibilityChange?.(googleVisible);
  }, [googleVisible, onGoogleVisibilityChange]);

  // Canonical towers travel to the renderer as coordinates, never percentages.
  const towerEntities: GeographicEntity[] = useMemo(
    () =>
      CANONICAL_TOWERS.map(tower => ({
        id: tower.id,
        latitude: tower.latitude,
        longitude: tower.longitude,
        label: tower.name,
        kind: "canonical_tower" as const,
        onSelect: () => {
          onSelectBuilding?.(tower.id);
          onNavigate?.(`/growth/tower-wars?building=${tower.id}`);
        },
      })),
    [onSelectBuilding, onNavigate]
  );

  /*
    Google draws and owns its own camera, so ours only takes over the
    illustrated atlas. Two cameras fighting for one gesture is worse than none.
  */
  const cameraIsLive = !googleVisible;
  const camera = useWorldCamera({ disabled: googleVisible });

  // Focusing a building is a camera move, not a page navigation: the world
  // stays mounted underneath so closing the inspector returns to this exact view.
  useEffect(() => {
    if (!cameraIsLive) return;
    if (!selectedBuildingId) {
      camera.restore();
      return;
    }
    const tower = CANONICAL_TOWERS.find(item => item.id === selectedBuildingId);
    if (!tower) return;
    const point = projectLatLngToLanternAtlas(tower);
    if (point.outOfBounds) return;
    camera.focusOn({ x: point.x / 100, y: point.y / 100 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuildingId, cameraIsLive]);

  useEffect(() => {
    if (!cameraIsLive) return;
    if (focusPoint) camera.focusOn({ x: focusPoint.x / 100, y: focusPoint.y / 100 });
    else if (!selectedBuildingId) camera.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPoint?.x, focusPoint?.y, cameraIsLive]);

  return (
    <div
      className={`cr-world-geography-surface mode-${mode} view-${viewMode} ${className}`}
      data-day-phase={atmosphere?.dayPhase ?? "day"}
    >
      {/*
        The world container. Everything spatial lives inside it, so the camera
        moves one thing and every real place keeps the position its coordinate
        gave it. Fixed interface is deliberately rendered after this block,
        outside the transform, so panning never drags the controls and an
        arcade explosion never shakes the HUD.
      */}
      <div
        className={`cr-world-camera${camera.isDragging ? " is-dragging" : ""}`}
        ref={camera.bind.ref}
      >
      <div className="cr-world-space" style={{ transform: cameraIsLive ? camera.transform : undefined }}>
      {/* 1. Base Layer: Authored Atlas Skin vs Google Reality 3D Layer */}
      {viewMode === "reality_3d" && mapsApiKey ? (
        <GoogleMapsRealityLayer
          apiKey={mapsApiKey}
          target={cameraTarget}
          mode="maps_js_3d"
          className="cr-world-reality-engine"
          entities={[...towerEntities, ...(geographicEntities ?? [])]}
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
      {showOpportunityLayer && opportunity && !googleVisible ? (
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
          {GOLDLINE_LA_LANDMARKS.map(district => {
            const point = projectLatLngToLanternAtlas(district);
            return (
            <span
              key={district.name}
              className="cr-world-neighborhood-label"
              style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
              }}
            >
              {district.name}
            </span>
          )})}
        </div>
      ) : null}

      {/*
        5. Canonical building towers.

        These are positioned with projectLatLngToLanternAtlas() percentages,
        which are meaningful only against the illustrated atlas JPG — and are
        additionally clamped into an 8–94% box, so the position is a
        composition choice rather than a location. That is fine over the
        painting and false over real geography, so while Google is drawing the
        world the authored anchors are not rendered at all; the same towers are
        placed by real coordinate inside the renderer instead (towerEntities).
      */}
      {!googleVisible ? (
      <div className="cr-world-towers-layer">
        {CANONICAL_TOWERS.map(tower => {
          const pt = projectLatLngToLanternAtlas(tower);
          if (pt.outOfBounds) return null;

          return (
            <div
              key={tower.id}
                className={`cr-world-tower-anchor ${selectedBuildingId === tower.id ? "is-selected" : ""} ${battleState?.pressureBuilding === tower.id ? "is-pressure" : ""} ${battleState?.revenueCue === tower.id ? "is-revenue-cue" : ""}`}
              style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
            >
              <CityTowerButton
                buildingId={tower.id}
                className={`pwc-building ${tower.id === "opus_la" ? "opus" : "cpe"}`}
                onNavigate={path => {
                  onSelectBuilding?.(tower.id);
                  if (mapsApiKey) setViewMode("reality_3d");
                  onNavigate?.(path);
                }}
                subtitle={`${tower.neighborhood} · TODAY ${battleState?.revenues[tower.id] == null ? "—" : `$${(battleState.revenues[tower.id]! / 100).toFixed(0)}`} · battle truth`}
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
      ) : null}

      {/* Additional UI elements (lanterns, search, controls passed as children) */}
      {children}
      </div>

      {/*
        Fixed world controls. These sit outside the transform on purpose — they
        are the interface to the world, not part of it.
      */}
      {cameraIsLive ? (
        <div className="cr-world-camera-controls">
          <button type="button" onClick={() => camera.zoomBy(1.35)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => camera.zoomBy(1 / 1.35)} aria-label="Zoom out">−</button>
          <button type="button" onClick={camera.reset} aria-label="Reset the view to the whole city">
            Whole city
          </button>
        </div>
      ) : null}
      </div>

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
