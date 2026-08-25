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
};

export type RuntimeWorldActor = {
  id: string;
  imageUrl?: string;
  point: OverworldPoint;
  presentationHeight: number;
  zOffset?: number;
};

export type OverworldRuntimePresentation = {
  showDestinationMarkers?: boolean;
  playerHeight?: number;
  cameraZoom?: number;
  cameraLookAheadSeconds?: number;
  depth?: {
    nearY: number;
    farY: number;
    nearScale: number;
    farScale: number;
  };
  actors?: RuntimeWorldActor[];
  goldRoute?: OverworldPoint[];
};

export interface OverworldRuntimeContract {
  setInput(x: number, y: number): void;
  setPaused(paused: boolean): void;
  setDestinationStates(states: DestinationStateMap): void;
  performContextAction(): "entered" | "inspected" | "locked" | "traversal" | "none";
  setActorVisible(id: string, visible: boolean): void;
  saveNow(): void;
  resize(): void;
  destroy(): Promise<void>;
}
