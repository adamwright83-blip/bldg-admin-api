import React, { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { GOLDLINE_LA_LANDMARKS, projectLatLngToLanternAtlas } from "@shared/lanternCity";
import {
  CANONICAL_BUILDING_GEOGRAPHY,
} from "@shared/canonicalGeography";
import type { CanonicalBuildingId } from "./buildingArt";
import { CityTowerButton } from "./CityTowerButton";
import type { BuildingVitality } from "./lanternVitality";
import { WorldAtmosphereOverlay } from "./WorldAtmosphereOverlay";
import type { GeographicEntity } from "./GoogleMapsRealityLayer";
import { RealityWindow } from "./RealityWindow";
import { useWorldCamera } from "./useWorldCamera";
import { FactionBattlefieldLayer } from "./FactionBattlefieldLayer";
import type { TowerDamageState } from "@shared/towerWars";

const ATLAS_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas-v4.png";

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
   * How each building's customers are doing, keyed by canonical building id.
   *
   * Optional, and absent means "not known" rather than "nothing happening":
   * callers without customer data render the towers exactly as before instead
   * of showing every window as quiet.
   */
  buildingVitality?: Map<string, BuildingVitality>;
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
  /** Guardian encounter owns gestures so a boss tap cannot drag the city. */
  gesturesDisabled?: boolean;
  /**
   * Draw the world as the 1v1 COMBAT OVERWORLD: combat tower plates and the
   * faction lighting pass. Lantern City turns this on; the small Home overview
   * frame does not, because a hero plate and a 26%-wide light pool are illegible
   * in a 430px box.
   *
   * Purely a presentation switch. It changes no coordinate, no projection and no
   * navigation — the same towers stand in the same real places either way.
   */
  combatPresentation?: boolean;
  /**
   * Authoritative Tower Wars damage per building, from `towerWars.today`.
   *
   * Absent, or absent for one building, means UNKNOWN — the tower keeps its
   * clean plate and says the damage is unknown, rather than claiming pristine.
   */
  buildingDamage?: Partial<Record<CanonicalBuildingId, TowerDamageState>>;
  /**
   * Attacks each building genuinely launched today, from `towerWars.today`.
   * Absent means unknown, and unknown draws no projectile at all.
   */
  buildingAttacks?: Partial<Record<CanonicalBuildingId, number>>;
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
  buildingVitality,
  geographicEntities,
  onGoogleVisibilityChange,
  focusPoint,
  gesturesDisabled = false,
  combatPresentation = false,
  buildingDamage,
  buildingAttacks,
}: WorldGeographySurfaceProps) {
  const [realityBuildingId, setRealityBuildingId] = useState<CanonicalBuildingId | null>(null);
  /*
    Which tower the operator's attention is on, so its faction light can
    intensify with the hover. Local presentation state only — it never leaves
    this component and never reaches a query.
  */
  const [emphasisedBuildingId, setEmphasisedBuildingId] =
    useState<CanonicalBuildingId | null>(null);

  // Query live atmosphere & runtime config from backend
  const atmosphereQuery = trpc.system.google.atmosphere.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const opportunityQuery = trpc.system.google.opportunityPressure.useQuery(undefined, {
    staleTime: 300_000,
  });

  const atmosphere = atmosphereQuery.data ?? null;
  const opportunity = opportunityQuery.data?.projection ?? null;

  // One strategic world. Google is only mounted inside deliberate RealityWindow.
  const googleVisible = false;
  const territoryDebug =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("territoryDebug") === "1";
  useEffect(() => {
    onGoogleVisibilityChange?.(googleVisible);
  }, [googleVisible, onGoogleVisibilityChange]);

  /*
    Google draws and owns its own camera, so ours only takes over the
    illustrated atlas. Two cameras fighting for one gesture is worse than none.
  */
  const cameraIsLive = !googleVisible;
  const inspecting = Boolean(focusPoint) || Boolean(selectedBuildingId);
  const [mapAcceptsPointers, setMapAcceptsPointers] = useState(true);
  useEffect(() => {
    if (inspecting) {
      setMapAcceptsPointers(false);
      return;
    }
    let cancelled = false;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) setMapAcceptsPointers(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [inspecting]);
  const suppressMap = inspecting || !mapAcceptsPointers;
  const camera = useWorldCamera({
    disabled: googleVisible || gesturesDisabled || suppressMap,
  });

  // Inspect is a camera mode, not a page navigation. Enter snapshots the free
  // pose once; exit snaps back to it. Closing the inspector cannot click
  // through into a pan because the host ignores pointers while inspecting.
  useEffect(() => {
    if (!cameraIsLive) return;
    if (focusPoint) {
      camera.enterInspect({ x: focusPoint.x / 100, y: focusPoint.y / 100 });
      return;
    }
    if (selectedBuildingId) {
      const tower = CANONICAL_TOWERS.find(item => item.id === selectedBuildingId);
      if (!tower) return;
      const point = projectLatLngToLanternAtlas(tower);
      if (point.outOfBounds) return;
      camera.enterInspect({ x: point.x / 100, y: point.y / 100 });
      return;
    }
    camera.exitInspect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusPoint?.x, focusPoint?.y, selectedBuildingId, cameraIsLive]);

  return (
    <div
      className={`cr-world-geography-surface mode-${mode} view-atlas ${className}`}
      data-day-phase="day"
    >
      {/*
        The world container. Everything spatial lives inside it, so the camera
        moves one thing and every real place keeps the position its coordinate
        gave it. Fixed interface is deliberately rendered after this block,
        outside the transform, so panning never drags the controls and an
        arcade explosion never shakes the HUD.
      */}
      <div
        className={`cr-world-camera${camera.isDragging ? " is-dragging" : ""}${suppressMap ? " is-inspecting" : ""}`}
        data-camera-mode={camera.mode}
        ref={camera.bind.ref}
      >
      <div className="cr-world-space" style={{ transform: cameraIsLive ? camera.transform : undefined }}>
      {/* 1. Base Layer: Authored Atlas Skin vs Google Reality 3D Layer */}
        <div className="cr-world-skin-container">
          <img
            src={ATLAS_IMAGE}
            alt="Fictional daylight Los Angeles kingdom atlas; real entities are positioned from geographic evidence"
            className="cr-world-skin-img"
          />
          <div className="cr-world-skin-shade" />
        </div>

      {/* 2. Living Atmosphere Overlay: real clouds, AQI haze, rain */}
      <WorldAtmosphereOverlay atmosphere={atmosphere} />

      {/*
        2b. The battlefield lighting pass.

        Sits above the atlas skin and BELOW every marker, so gold and violet
        light the city that real lanterns and real towers then stand in. It is
        anchored entirely on the canonical buildings' own coordinates — see
        FactionBattlefieldLayer.
      */}
      {combatPresentation && !googleVisible ? (
        <FactionBattlefieldLayer emphasised={emphasisedBuildingId} />
      ) : null}

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
      {showNeighborhoods ? (
        <div className="cr-world-neighborhoods" aria-hidden="true">
          {GOLDLINE_LA_LANDMARKS.map(district => {
            const point = projectLatLngToLanternAtlas(district);
            /*
              ONE PLACE, ONE NAME.

              Century Park East really is in Century City and OPUS LA really is
              in Koreatown, so the neighbourhood label and the tower's own
              nameplate land on the same patch of map and were printed on top of
              each other. Both are true; the tower's name is the more specific
              of the two, so it is the one that survives.

              Suppressed only in the combat presentation, and only for a label
              that is genuinely sitting on a rendered tower — the label is not
              moved, and it returns the moment the tower is not there.
            */
            if (
              combatPresentation &&
              CANONICAL_TOWERS.some(tower => {
                const towerPoint = projectLatLngToLanternAtlas(tower);
                return (
                  !towerPoint.outOfBounds &&
                  Math.abs(towerPoint.x - point.x) < 3 &&
                  Math.abs(towerPoint.y - point.y) < 5
                );
              })
            )
              return null;
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
              data-faction={combatPresentation ? (tower.id === "opus_la" ? "violet" : "gold") : undefined}
              style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
              onPointerEnter={() => setEmphasisedBuildingId(tower.id)}
              onPointerLeave={() =>
                setEmphasisedBuildingId(current => (current === tower.id ? null : current))
              }
              onFocus={() => setEmphasisedBuildingId(tower.id)}
              onBlur={() =>
                setEmphasisedBuildingId(current => (current === tower.id ? null : current))
              }
            >
              <CityTowerButton
                buildingId={tower.id}
                className={`pwc-building ${tower.id === "opus_la" ? "opus" : "cpe"}`}
                onNavigate={path => {
                  onSelectBuilding?.(tower.id);
                  onNavigate?.(path);
                }}
                subtitle={
                  /*
                    In the combat world the neighbourhood is already written on
                    the map two centimetres away, so repeating it under the
                    nameplate says nothing. The line becomes the affordance
                    instead — it states exactly what clicking the building does,
                    which is the one thing the composition cannot show.
                  */
                  combatPresentation
                    ? "Enter Tower Wars"
                    : `${tower.neighborhood} · THIS WEEK ${battleState?.revenues[tower.id] == null ? "—" : `$${(battleState.revenues[tower.id]! / 100).toFixed(0)}`} · battle truth`
                }
                vitality={buildingVitality?.get(tower.id)}
                combat={combatPresentation}
                damage={buildingDamage?.[tower.id] ?? null}
                attacksToday={buildingAttacks?.[tower.id] ?? null}
              />
              <button
                type="button"
                className="cr-reality-trigger-btn"
                onClick={() => setRealityBuildingId(tower.id)}
                title={`Open real place evidence for ${tower.name}`}
                aria-label={`Open real place evidence for ${tower.name}`}
              >
                ⌖ Spyglass
              </button>
            </div>
          );
        })}
      </div>
      ) : null}
      {territoryDebug && !googleVisible ? (
        <div className="cr-geography-debug-towers" aria-hidden="true">
          {CANONICAL_TOWERS.map(tower => {
            const point = projectLatLngToLanternAtlas(tower);
            if (point.outOfBounds) return null;
            return (
              <span
                key={tower.id}
                data-tower-id={tower.id}
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                <i />
                <b>{tower.id}</b>
                <small>{tower.latitude.toFixed(4)}, {tower.longitude.toFixed(4)}</small>
              </span>
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

      {/* Google attribution stays owned by actual Google surfaces in RealityWindow. */}
    </div>
  );
}
