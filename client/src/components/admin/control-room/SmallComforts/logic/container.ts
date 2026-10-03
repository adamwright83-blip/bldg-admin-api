import type { Cell, Layout } from "./grid";
import { COLS, DOOR, ROWS } from "./grid";

export type ContainerFeatureId =
  | "brass_latch"
  | "lid_pocket"
  | "elastic_straps"
  | "fabric_lining"
  | "brass_corners"
  | "lining_window";

export type ContainerTag =
  | "entry"
  | "operable"
  | "storage"
  | "sheltered"
  | "elevated"
  | "suspension"
  | "hammock_anchor"
  | "soft"
  | "cuttable"
  | "insulating"
  | "structural"
  | "anchor_point"
  | "view_outside"
  | "draft_source"
  | "opening"
  | "transformed";

export interface ContainerFeature {
  id: ContainerFeatureId;
  label: string;
  tags: readonly ContainerTag[];
  cells: readonly Cell[];
  active: boolean;
}

export interface ContainerAnatomy {
  kind: "vintage_suitcase";
  features: readonly ContainerFeature[];
}

const allFloorCells = (): Cell[] => {
  const out: Cell[] = [];
  for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) out.push({ x, z });
  return out;
};

export function suitcaseAnatomy(layout: Layout): ContainerAnatomy {
  const windowCol = Math.max(0, Math.min(COLS - 2, layout.windowCol));
  const windowCells: Cell[] = [
    { x: windowCol, z: 0 },
    { x: windowCol + 1, z: 0 },
  ];

  return {
    kind: "vintage_suitcase",
    features: [
      {
        id: "brass_latch",
        label: "Brass latch",
        tags: ["entry", "operable", "structural"],
        cells: [DOOR],
        active: true,
      },
      {
        id: "lid_pocket",
        label: "Satin lid pocket",
        tags: ["storage", "sheltered", "elevated"],
        cells: [{ x: 4, z: 0 }, { x: 5, z: 0 }],
        active: true,
      },
      {
        id: "elastic_straps",
        label: "Elastic garment straps",
        tags: ["suspension", "hammock_anchor", "elevated"],
        cells: [{ x: 1, z: 1 }, { x: 4, z: 1 }],
        active: true,
      },
      {
        id: "fabric_lining",
        label: "Fabric lining",
        tags: ["soft", "cuttable", "insulating"],
        cells: allFloorCells(),
        active: true,
      },
      {
        id: "brass_corners",
        label: "Brass corner brackets",
        tags: ["structural", "anchor_point"],
        cells: [
          { x: 0, z: 0 },
          { x: COLS - 1, z: 0 },
          { x: 0, z: ROWS - 1 },
          { x: COLS - 1, z: ROWS - 1 },
        ],
        active: true,
      },
      {
        id: "lining_window",
        label: "Cut lining opening",
        tags: ["view_outside", "draft_source", "opening", "transformed"],
        cells: windowCells,
        active: layout.windowCut,
      },
    ],
  };
}

export function activeContainerFeatures(layout: Layout): ContainerFeature[] {
  return suitcaseAnatomy(layout).features.filter(feature => feature.active);
}

export function containerFeaturesWithTag(layout: Layout, tag: ContainerTag): ContainerFeature[] {
  return activeContainerFeatures(layout).filter(feature => feature.tags.includes(tag));
}

export function containerFeature(layout: Layout, id: ContainerFeatureId): ContainerFeature | undefined {
  return suitcaseAnatomy(layout).features.find(feature => feature.id === id);
}
