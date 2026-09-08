import type {
  GeographicCustomer,
  CustomerLocationCluster,
} from "../customerGeography";
import type { TerritoryOccupancy } from "@shared/lanternTerritories";
import type { TerritoryVisualState } from "@shared/lanternTerritoryVisualState";
import type { CanonicalBuildingId } from "../buildingArt";
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type EnvironmentState = "healthy" | "cooling" | "infested" | "locked";
export type SceneControls = {
  lanterns: boolean;
  buildings: boolean;
  opportunities: boolean;
  labels: boolean;
  territories: boolean;
};
export const DEFAULT_CONTROLS: SceneControls = {
  lanterns: true,
  buildings: true,
  opportunities: false,
  labels: true,
  territories: true,
};
export type SceneProspect = {
  id: number;
  name: string;
  worldAnchor: Point;
  latitude: number;
  longitude: number;
};
export type TerritoryTruth = {
  occupancy: TerritoryOccupancy;
  customers: GeographicCustomer[];
  state: TerritoryVisualState;
  environment: EnvironmentState;
};
export type SceneObject = {
  id: string;
  territoryId: string;
  name: string;
  kind: "lantern" | "stronghold" | "lock" | "environment" | "prospect";
  worldAnchor: Point;
  sourceAnchors: Array<Point & { latitude: number; longitude: number }>;
  displayAnchor: Point;
  bounds: Rect;
  artBounds: Rect;
  labelBounds: Rect;
  environment: EnvironmentState;
  state: TerritoryVisualState;
  status: string;
  priority: number;
  /** Overview aggregate only; use sourceClusters when opening a physical-place inspector. */
  cluster?: CustomerLocationCluster;
  sourceClusters?: CustomerLocationCluster[];
  buildingId?: CanonicalBuildingId;
  prospectId?: number;
  occupancy?: TerritoryOccupancy;
};
export type ScenePlate = {
  territoryId: string;
  state: EnvironmentState;
  bounds: Rect;
  src: string | null;
  registration: "authored-display";
};
export type SceneProp = {
  id: string;
  territoryId: string;
  src: string;
  bounds: Rect;
};
export type CityScene = {
  viewport: { width: number; height: number };
  hud: { identity: Rect; quest: Rect; controls: Rect; deck: Rect };
  exclusions: Rect[];
  objects: SceneObject[];
  plates: ScenePlate[];
  props: SceneProp[];
  suppressed: Array<{ id: string; reason: string }>;
  truth: TerritoryTruth[];
  controls: SceneControls;
  artStatus: "BLOCKED ON ART";
};
