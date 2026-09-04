export type OverworldPoint = { x: number; y: number };
export type OverworldFacing = "front" | "back" | "left" | "right";
export type OverworldMaterial = "stone" | "wood" | "grass" | "crystal";

export type WalkableSurface = {
  id: string;
  material: OverworldMaterial;
  polygon: OverworldPoint[];
};

export type PathCorridor = {
  id: string;
  material: OverworldMaterial;
  halfWidth: number;
  points: OverworldPoint[];
  centerAssist?: number;
};

export type OverworldDestination = {
  id: string;
  name: string;
  subtitle: string;
  point: OverworldPoint;
  approachRadius: number;
  entranceRadius: number;
  action: "enter" | "inspect" | "traverse";
  traversalId?: string;
};

export type TraversalNode = {
  kind?: "linehook";
  anchor?: OverworldPoint;
  landingRadius?: number;
  id: string;
  label: string;
  entry: OverworldPoint;
  entryRadius: number;
  path: OverworldPoint[];
  exitSurfaceId: string;
};

export type OcclusionRegion = {
  id: string;
  polygon: OverworldPoint[];
};

export type OverworldMapDefinition = {
  id: string;
  version: number;
  width: number;
  height: number;
  defaultSpawnId: string;
  spawns: Record<string, OverworldPoint & { surfaceId: string }>;
  surfaces: WalkableSurface[];
  corridors: PathCorridor[];
  occluders: OcclusionRegion[];
  destinations: OverworldDestination[];
  traversals: TraversalNode[];
  /** Explicit unsupported geometry overrides otherwise broad walkable surfaces. */
  blockedRegions?: Array<{ id: string; polygon: OverworldPoint[] }>;
};

export type DestinationAvailability = "active" | "locked" | "completed";
export type DestinationStateMap = Record<string, DestinationAvailability>;

export type OverworldCheckpoint = {
  mapVersion: number;
  x: number;
  y: number;
  surfaceId: string;
  facing: OverworldFacing;
  savedAt: string;
};

export type OverworldProximity = {
  destination: OverworldDestination;
  availability: DestinationAvailability;
  canAct: boolean;
} | null;

export type OverworldRuntimeCallbacks = {
  onProximityChange: (proximity: OverworldProximity) => void;
  onCheckpoint: (checkpoint: OverworldCheckpoint) => void;
  onFirstMove?: () => void;
  onTraversalComplete?: (traversalId: string) => void;
  onRecovered?: () => void;
  onFrame?: (deltaSeconds: number, player: OverworldPoint) => void;
};

export type RuntimeActorVisual =
  | "ring"
  | "rope-inspector"
  | "rope-bird"
  | "tether-winch"
  | "broken-span"
  | "deck-brace"
  | "mooring-sail";

export type RuntimeWorldActor = {
  id: string;
  imageUrl?: string;
  point: OverworldPoint;
  presentationHeight: number;
  zOffset?: number;
  visual?: RuntimeActorVisual;
  behavior?: "inspect-rope" | "steal-fiber" | "wake-with-tether";
};

export type RuntimeActorState = "default" | "telegraph" | "exposed" | "defeated";
export type RuntimeScenePhase = "dormant" | "waking" | "active";

export type RuntimeSceneLayer = {
  id: string;
  imageUrl: string;
  zIndex: number;
  phaseAlpha: Record<RuntimeScenePhase, number>;
  behavior?: "state-crossfade" | "foreground-parallax";
  parallaxFactor?: number;
  offsetX?: number;
  offsetY?: number;
};

export type OverworldRuntimePresentation = {
  showDestinationMarkers?: boolean;
  backgroundOccluders?: boolean;
  playerHeight?: number;
  cameraZoom?: number;
  cameraDamping?: number;
  cameraLookAheadSeconds?: number;
  depth?: {
    nearY: number;
    farY: number;
    nearScale: number;
    farScale: number;
    farSpeedFactor?: number;
  };
  actors?: RuntimeWorldActor[];
  sceneLayers?: RuntimeSceneLayer[];
  goldRoute?: OverworldPoint[];
};

export interface OverworldRuntimeContract {
  setInput(x: number, y: number): void;
  setPaused(paused: boolean): void;
  setDestinationStates(states: DestinationStateMap): void;
  performContextAction(): "entered" | "inspected" | "locked" | "traversal" | "none";
  setActorVisible(id: string, visible: boolean): void;
  setActorPresentation(id: string, point: OverworldPoint, state?: RuntimeActorState): void;
  setScenePhase(phase: RuntimeScenePhase): void;
  knockbackFrom(point: OverworldPoint, distance: number): void;
  saveNow(): void;
  resize(): void;
  destroy(): Promise<void>;
}
