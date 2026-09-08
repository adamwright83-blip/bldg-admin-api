import type { CSSProperties } from "react";
import { LANTERN_CITY_V5_ASSETS as ASSETS } from "@/components/goldline/lanternCityV5Assets";
import {
  clusterLanternState,
  lanternAssetForClusterState,
} from "../lanternCustomerPresentation";
import { combatTowerArtFor } from "../lanternCityCombat";
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
export function Stronghold({
  object,
  damage,
  showLight,
}: {
  object: SceneObject;
  showLight: boolean;
  damage?: TowerDamageState;
}) {
  const art = combatTowerArtFor(object.buildingId!, damage ?? null);
  return (
    <>
      <img
        className={styles.towerArt}
        src={
          (!art.showingDamage && SCENE_ART.strongholds[object.buildingId!]) ||
          art.src
        }
        alt={art.description}
        draggable={false}
      />
      {showLight && object.cluster && object.cluster.total > 0 ? (
        <span className={styles.towerLight}>
          <CustomerLantern object={object} />
          <b>{object.cluster.total}</b>
        </span>
      ) : null}
    </>
  );
}
export function TerritoryLabel({ object }: { object: SceneObject }) {
  return (
    <span className={styles.label} data-environment={object.environment}>
      <strong>{object.name}</strong>
      <small>{object.status}</small>
    </span>
  );
}
export function LanternCitySceneRenderer({
  scene,
  selectedId,
  damage,
  onSelect,
}: {
  scene: CityScene;
  selectedId?: string | null;
  damage?: Partial<Record<CanonicalBuildingId, TowerDamageState>>;
  onSelect: (object: SceneObject, element: HTMLElement) => void;
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
      {scene.objects.map(object => (
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
          aria-label={`${object.name}: ${object.status}`}
          onClick={event => onSelect(object, event.currentTarget)}
        >
          <span
            className={styles.objectArt}
            style={{ height: object.artBounds.height }}
          >
            {object.kind === "lantern" ? (
              <CustomerLantern object={object} />
            ) : null}
            {object.kind === "stronghold" ? (
              <Stronghold
                object={object}
                showLight={scene.controls.lanterns}
                damage={damage?.[object.buildingId!]}
              />
            ) : null}
            {object.kind === "lock" ? (
              <img src={SCENE_ART.lock ?? ASSETS.frontier.lock} alt="" />
            ) : null}
            {object.kind === "prospect" ? (
              <img src={ASSETS.lanterns.opportunity} alt="" />
            ) : null}
          </span>
          {scene.controls.labels ? <TerritoryLabel object={object} /> : null}
        </button>
      ))}
    </div>
  );
}
