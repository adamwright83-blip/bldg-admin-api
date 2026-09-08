import type { CSSProperties, SyntheticEvent } from "react";
import { LANTERN_CITY_V5_ASSETS as ASSETS } from "@/components/goldline/lanternCityV5Assets";
import {
  frontierAssetSrc,
  lostGroundAssetForFrontierKind,
} from "@/components/goldline/lanternCityV5Assets";
import {
  clusterLanternState,
  lanternAssetForClusterState,
} from "../lanternCustomerPresentation";
import { CanonicalBuildingArt } from "../CanonicalBuildingArt";
import type { TowerDamageState } from "@shared/towerWars";
import type { CanonicalBuildingId } from "../buildingArt";
import type { CityScene, Rect, SceneObject, ScenePlate } from "./sceneTypes";
import { SCENE_ART } from "./sceneAssets";
import styles from "./lantern-city-v6.module.css";
export const rectStyle = (r: Rect): CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.width,
  height: r.height,
});
export function TerritoryStatePlate({ plate }: { plate: ScenePlate }) {
  return (
    <div
      className={styles.plate}
      style={rectStyle(plate.bounds)}
      data-state-plate={plate.territoryId}
      data-art-status={plate.src ? "supplied" : "missing"}
      data-environment={plate.state}
      aria-hidden
    >
      {plate.src ? <img src={plate.src} alt="" /> : null}
    </div>
  );
}
export function CustomerLantern({ object }: { object: SceneObject }) {
  return object.cluster ? (
    <img
      className={styles.lanternArt}
      src={
        SCENE_ART.lanterns[clusterLanternState(object.cluster)] ??
        lanternAssetForClusterState(clusterLanternState(object.cluster))
      }
      alt=""
      draggable={false}
    />
  ) : null;
}
/**
 * The stronghold tower and its attached live customer light are two
 * independent hit targets, not a nested interactive control: the tower
 * button enters Tower Wars, the light button opens the customer inspector.
 * They are siblings inside a non-interactive positioning wrapper (see
 * LanternCitySceneRenderer), never one nested inside the other.
 */
export function Stronghold({
  object,
  showLight,
  onSelectTower,
  onSelectLight,
}: {
  object: SceneObject;
  showLight: boolean;
  damage?: TowerDamageState;
  onSelectTower: (event: SyntheticEvent<HTMLElement>) => void;
  onSelectLight?: (event: SyntheticEvent<HTMLElement>) => void;
}) {
  return (
    <>
      {/*
       * CanonicalBuildingArt is the SAME component Home and Tower Wars use —
       * "a building cannot change identity, architecture or weapon merely
       * because the camera layer changed" (buildingArt.ts). It composes the
       * pristine plate plus the real approved weapon overlay (OPUS's giant
       * architectural golf driver, CPE's rooftop valet bazooka), which is
       * how the weapon reappears on the world map without inventing new
       * art. The weapon art can extend beyond the tower's own silhouette —
       * `.objectArtOverflow` deliberately does not clip it — while the
       * clickable Tower Wars hit area stays the full button underneath.
       */}
      <button
        type="button"
        className={`${styles.objectArt} ${styles.objectArtOverflow}`}
        style={{ height: object.artBounds.height }}
        data-scene-target="tower"
        aria-label={`${object.name}: Enter Tower Wars`}
        onClick={onSelectTower}
      >
        <div className={styles.canonicalBuildingHost}>
          <CanonicalBuildingArt buildingId={object.buildingId!} showWeapon />
        </div>
      </button>
      {showLight && object.cluster && object.cluster.total > 0 ? (
        <button
          type="button"
          className={styles.towerLight}
          aria-label={`${object.name} customers: ${object.cluster.total}`}
          data-scene-target="light"
          onClick={onSelectLight}
        >
          <CustomerLantern object={object} />
          <b>{object.cluster.total}</b>
        </button>
      ) : null}
    </>
  );
}
export function TerritoryLabel({ object }: { object: SceneObject }) {
  const frontierVerb = object.frontierKind
    ? {
        balloon: "OPEN THE BALLOON",
        helicopter: "REBUILD THE BIRD",
        toyFlight: "LIGHT THE WESTSIDE",
        excursion: "HOLD THE ROUTE",
        expedition: "RESTORE THE LIGHT",
      }[object.frontierKind]
    : null;
  return (
    <span className={styles.label} data-environment={object.environment}>
      <strong>{object.name}</strong>
      <small>{frontierVerb ?? object.status}</small>
    </span>
  );
}
export type SceneSelectTarget = "tower" | "light" | "default";
export function LanternCitySceneRenderer({
  scene,
  selectedId,
  damage,
  onSelect,
}: {
  scene: CityScene;
  selectedId?: string | null;
  damage?: Partial<Record<CanonicalBuildingId, TowerDamageState>>;
  onSelect: (
    object: SceneObject,
    element: HTMLElement,
    target?: SceneSelectTarget
  ) => void;
}) {
  return (
    <div
      className={styles.world}
      aria-label="Composed Lantern City"
      data-scene-world
    >
      <img
        className={styles.atlas}
        src={SCENE_ART.base ?? SCENE_ART.previewBase}
        alt="Los Angeles illustrated world"
        draggable={false}
      />
      {scene.plates.map(plate => (
        <TerritoryStatePlate key={plate.territoryId} plate={plate} />
      ))}
      <div className={styles.props} aria-hidden>
        {scene.props.map(prop => (
          <img
            key={prop.id}
            src={prop.src}
            alt=""
            style={rectStyle(prop.bounds)}
          />
        ))}
      </div>
      {scene.objects.map(object =>
        object.kind === "stronghold" ? (
          // Non-interactive positioning wrapper: the tower and its
          // attached customer light are sibling buttons inside it, never
          // one nested inside the other.
          <div
            key={object.id}
            className={styles.object}
            style={rectStyle(object.bounds)}
            data-scene-object={object.kind}
            data-scene-id={object.id}
            data-territory-id={object.territoryId}
            data-world-anchor={`${object.worldAnchor.x},${object.worldAnchor.y}`}
            data-display-anchor={`${object.displayAnchor.x},${object.displayAnchor.y}`}
            data-selected={selectedId === object.id}
          >
            <Stronghold
              object={object}
              showLight={scene.controls.lanterns}
              damage={damage?.[object.buildingId!]}
              onSelectTower={event =>
                onSelect(object, event.currentTarget, "tower")
              }
              onSelectLight={event =>
                onSelect(object, event.currentTarget, "light")
              }
            />
            {scene.controls.labels ? <TerritoryLabel object={object} /> : null}
          </div>
        ) : (
          <button
            key={object.id}
            type="button"
            className={styles.object}
            style={rectStyle(object.bounds)}
            data-scene-object={object.kind}
            data-scene-id={object.id}
            data-territory-id={object.territoryId}
            data-world-anchor={`${object.worldAnchor.x},${object.worldAnchor.y}`}
            data-display-anchor={`${object.displayAnchor.x},${object.displayAnchor.y}`}
            data-selected={selectedId === object.id}
            aria-label={
              object.frontierKind
                ? `${object.name}: frontier objective`
                : `${object.name}: ${object.status}`
            }
            onClick={event => onSelect(object, event.currentTarget, "default")}
          >
            <span
              className={styles.objectArt}
              style={{ height: object.artBounds.height }}
            >
              {object.kind === "lantern" ? (
                <CustomerLantern object={object} />
              ) : null}
              {object.frontierKind ? (
                <>
                  <img
                    className={styles.frontierArt}
                    src={
                      object.frontierLostGround
                        ? lostGroundAssetForFrontierKind(object.frontierKind)
                        : frontierAssetSrc(object.frontierKind)
                    }
                    alt=""
                    draggable={false}
                  />
                </>
              ) : object.kind === "lock" ? (
                <img src={SCENE_ART.lock ?? ASSETS.frontier.lock} alt="" />
              ) : null}
              {object.kind === "prospect" ? (
                <img src={ASSETS.lanterns.opportunity} alt="" />
              ) : null}
              {object.kind === "second_light" ? (
                <img
                  className={styles.secondLightArt}
                  src={ASSETS.lanterns.quiet}
                  alt=""
                />
              ) : null}
            </span>
            {scene.controls.labels ? <TerritoryLabel object={object} /> : null}
          </button>
        )
      )}
    </div>
  );
}
