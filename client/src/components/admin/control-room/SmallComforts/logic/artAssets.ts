export const SMALL_COMFORTS_ART = {
  suitcase: {
    url: "/assets/small-comforts/sc_suitcase_v3.glb",
    rootNode: "Suitcase",
    lidNode: "Suitcase_Lid",
    latchNode: "Brass_Latch",
    openAngleDeg: 107,
    hinge: [0, 0.9333333373069763, -2.4666666984558105] as const,
    expectedNodes: [
      "Suitcase",
      "Suitcase_Base",
      "Fabric_Lining",
      "Elastic_Straps",
      "Brass_Latch",
      "Brass_Corners",
      "Base_Hardware",
      "Suitcase_Lid",
      "Lid_Lining",
      "Lid_Pocket",
      "Lid_Hardware",
    ] as const,
  },
  bed: {
    url: "/assets/small-comforts/sc_bed_v2.glb",
  },
  lamp: {
    url: "/assets/small-comforts/sc_lamp_v2.glb",
  },
} as const;

export type ImportedSmallComfortsItemKind = "bed" | "lamp";
