import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { CorridorPopulation } from "../../../../shared/corridorManifest";
import type { GoldlineAgentId } from "../../../../shared/goldlineProgression";
import {
  bindMissionToPopulation,
  bindOrderToPopulation,
  type AuthoritativeMissionForEmbodiment,
  type AuthoritativeOrderForEmbodiment,
  type MissionEmbodiment,
  type OrderEmbodiment,
} from "./populationProjection";
import { reportGoldlineLifecycleDelta } from "../testSupport/lifecycleProbe";

export type AgentWorldPresence = {
  agentId: GoldlineAgentId;
  /** A real projected candidate/discovery exists; never inferred locally. */
  hasAuthoritativeSignal: boolean;
};

export const PRODUCTION_ROLE_ATLAS_COLUMNS = 6;

type PopulationNode = {
  id: string;
  display: Container;
  baseProgress: number;
  baseLateral: number;
  visibilityRadius: number;
  phase: number;
  behavior: CorridorPopulation["ambient"][number]["behavior"];
  path: CorridorPopulation["ambient"][number]["path"];
};

/**
 * Lightweight Pixi population presentation. It owns no React state, creates
 * no missions, and runs from GoldlineGame's existing ticker. Production packs
 * may provide a static role atlas; the neutral faceless engineering figures
 * remain an explicit load-failure/placeholder fallback.
 */
export class PopulationSystem {
  readonly container = new Container();
  private readonly ambientLayer = new Container();
  private readonly missionLayer = new Container();
  private readonly orderLayer = new Container();
  private readonly capabilityLayer = new Container();
  private readonly ambient: PopulationNode[];
  private mission: MissionEmbodiment | null = null;
  private missionGraphic: Container | null = null;
  private order: OrderEmbodiment | null = null;
  private orderGraphic: Container | null = null;
  private agentPresence: readonly AgentWorldPresence[] = [];
  private lastBehaviorUpdateAt = Number.NEGATIVE_INFINITY;
  private reducedMotion = false;
  private destroyed = false;
  private readonly roleTextures: ReadonlyMap<string, Texture>;
  private readonly runtimeAssetStage: CorridorPopulation["assetStage"];

  constructor(
    private readonly population: CorridorPopulation,
    atlasTexture: Texture | null = null
  ) {
    reportGoldlineLifecycleDelta("populationBehaviorCallback", 1);
    this.roleTextures =
      population.assetStage === "production" && atlasTexture
        ? sliceRoleAtlas(atlasTexture)
        : new Map();
    this.runtimeAssetStage =
      this.roleTextures.size > 0 ? "production" : "engineering_placeholder";
    this.container.label = "goldline-population";
    this.ambientLayer.label = "ambient-population";
    this.missionLayer.label = "authoritative-mission-embodiment";
    this.orderLayer.label = "authoritative-order-embodiment";
    this.capabilityLayer.label = "agent-capability-presence";
    this.container.addChild(
      this.ambientLayer,
      this.missionLayer,
      this.orderLayer,
      this.capabilityLayer
    );
    this.ambient = population.ambient.map((person, index) => {
      const texture = this.roleTextures.get(person.spriteId);
      const display = texture
        ? drawRoleSprite(texture)
        : drawRoleFigure(person.behavior, 0x7f9692, 0xd8c6a3);
      display.label = `ambient:${person.id}`;
      this.ambientLayer.addChild(display);
      return {
        id: person.id,
        display,
        baseProgress: person.position.progress,
        baseLateral: person.position.lateral,
        visibilityRadius: person.visibilityRadius,
        phase: deterministicPhase(person.id, index),
        behavior: person.behavior,
        path: person.path,
      };
    });
  }

  get assetStage(): CorridorPopulation["assetStage"] {
    return this.runtimeAssetStage;
  }

  get visibleAmbientCount(): number {
    return this.ambient.filter(node => node.display.visible).length;
  }

  get authoredAmbientCount(): number {
    return this.ambient.length;
  }

  get missionEmbodiment(): MissionEmbodiment | null {
    return this.mission;
  }

  get orderEmbodiment(): OrderEmbodiment | null {
    return this.order;
  }

  setMission(mission: AuthoritativeMissionForEmbodiment | null) {
    const next = bindMissionToPopulation(
      mission,
      this.population.missionAnchorPoints
    );
    if (
      next?.missionId === this.mission?.missionId &&
      next?.state === this.mission?.state &&
      next?.affordance === this.mission?.affordance &&
      next?.anchorId === this.mission?.anchorId
    ) {
      return;
    }
    this.mission = next;
    this.missionLayer.removeChildren().forEach(child => child.destroy());
    this.missionGraphic = next
      ? drawMissionScene(next, this.roleTextures.get(roleForMission(next)))
      : null;
    if (this.missionGraphic) this.missionLayer.addChild(this.missionGraphic);
  }

  /**
   * A genuine pickup/delivery order, bound to a corridor anchor via the same
   * deterministic presentation-only binding `setMission` uses. Kept off the
   * active mission's anchor when more than one slot exists, purely so the
   * two markers don't visually overlap.
   */
  setOrder(order: AuthoritativeOrderForEmbodiment | null) {
    const next = bindOrderToPopulation(
      order,
      this.population.missionAnchorPoints,
      this.mission?.anchorId ?? null
    );
    if (
      next?.orderId === this.order?.orderId &&
      next?.kind === this.order?.kind &&
      next?.anchorId === this.order?.anchorId
    ) {
      return;
    }
    this.order = next;
    this.orderLayer.removeChildren().forEach(child => child.destroy());
    this.orderGraphic = next ? drawOrderMarker(next) : null;
    if (this.orderGraphic) this.orderLayer.addChild(this.orderGraphic);
  }

  setAgentPresence(presence: readonly AgentWorldPresence[]) {
    const signature = presence
      .map(item => `${item.agentId}:${item.hasAuthoritativeSignal}`)
      .join("|");
    const previous = this.agentPresence
      .map(item => `${item.agentId}:${item.hasAuthoritativeSignal}`)
      .join("|");
    if (signature === previous) return;
    this.agentPresence = [...presence];
    this.capabilityLayer.removeChildren().forEach(child => child.destroy());
    presence.forEach((item, index) => {
      const station = drawCapabilityStation(item);
      station.label = `agent-presence:${item.agentId}`;
      station.x = 0;
      station.y = 0;
      station.alpha = 0.9;
      station.zIndex = index;
      this.capabilityLayer.addChild(station);
    });
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced;
  }

  update(input: {
    now: number;
    width: number;
    height: number;
    playerProgress: number;
  }) {
    if (this.destroyed) return;
    // Ten updates/second is sufficient for short human loops and keeps this
    // population off the high-frequency gameplay path.
    if (input.now - this.lastBehaviorUpdateAt < 100) return;
    this.lastBehaviorUpdateAt = input.now;

    for (const node of this.ambient) {
      const visible =
        Math.abs(node.baseProgress - input.playerProgress) <=
        node.visibilityRadius;
      node.display.visible = visible;
      if (!visible) continue; // offscreen sleep
      const position = authoredPosition(node, input.now, this.reducedMotion);
      placeAtCorridorPosition(
        node.display,
        position.progress,
        position.lateral,
        input.width,
        input.height
      );
      applyBehaviorPose(node, input.now, this.reducedMotion);
    }

    if (this.mission && this.missionGraphic) {
      placeAtCorridorPosition(
        this.missionGraphic,
        this.mission.anchor.position.progress,
        this.mission.anchor.position.lateral,
        input.width,
        input.height
      );
      applyMissionBehavior(
        this.missionGraphic,
        this.mission,
        input.now,
        this.reducedMotion
      );
    }

    if (this.order && this.orderGraphic) {
      placeAtCorridorPosition(
        this.orderGraphic,
        this.order.anchor.position.progress,
        this.order.anchor.position.lateral,
        input.width,
        input.height
      );
      applyOrderMarkerMotion(this.orderGraphic, input.now, this.reducedMotion);
    }

    const stationPositions: Record<GoldlineAgentId, [number, number]> = {
      SCOUT: [0.66, -0.68],
      FOLLOW_UP: [0.5, 0.68],
      RELATIONSHIP: [0.36, 0.62],
      INTEL: [0.27, -0.64],
    };
    this.agentPresence.forEach((presence, index) => {
      const station = this.capabilityLayer.children[index];
      if (!station) return;
      const [progress, lateral] = stationPositions[presence.agentId];
      placeAtCorridorPosition(
        station,
        progress,
        lateral,
        input.width,
        input.height
      );
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    reportGoldlineLifecycleDelta("populationBehaviorCallback", -1);
    this.container.destroy({ children: true });
  }
}

function deterministicPhase(id: string, index: number): number {
  let value = index * 97;
  for (const character of id)
    value = (value * 31 + character.charCodeAt(0)) % 997;
  return value / 997;
}

export const PRODUCTION_ROLE_ATLAS_ORDER = [
  "field-role-a",
  "field-role-b",
  "field-role-c",
  "field-role-d",
  "field-role-e",
  "field-role-f",
] as const;

/**
 * The supplied production atlas has one documented static cell per role.
 * Sub-textures share the one Pixi source; no person triggers another load.
 */
function sliceRoleAtlas(atlas: Texture): ReadonlyMap<string, Texture> {
  const textures = new Map<string, Texture>();
  const cellWidth = atlas.frame.width / PRODUCTION_ROLE_ATLAS_ORDER.length;
  if (cellWidth <= 0 || atlas.frame.height <= 0) return textures;
  PRODUCTION_ROLE_ATLAS_ORDER.forEach((spriteId, index) => {
    textures.set(
      spriteId,
      new Texture({
        source: atlas.source,
        frame: new Rectangle(
          atlas.frame.x + index * cellWidth,
          atlas.frame.y,
          cellWidth,
          atlas.frame.height
        ),
        label: `goldline-population:${spriteId}`,
      })
    );
  });
  return textures;
}

function drawRoleSprite(texture: Texture): Container {
  // The authored-position system scales the returned display object for
  // perspective. Keep the sprite's texture-normalization scale on a child so
  // that perspective updates cannot overwrite it and explode atlas pixels to
  // their raw 256x512 cell size.
  const display = new Container();
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5, 1);
  sprite.width = 72;
  sprite.height = 144;
  display.addChild(sprite);
  return display;
}

function drawRoleFigure(
  behavior: CorridorPopulation["ambient"][number]["behavior"],
  coat: number,
  accent: number
): Graphics {
  const figure = new Graphics();
  // Faceless, generic role silhouette: this cannot be mistaken for a literal
  // contact likeness and does not infer identity from mission data.
  figure.circle(0, -52, 9).fill({ color: 0xc8a987, alpha: 0.98 });
  figure
    .roundRect(-12, -43, 24, 34, 8)
    .fill({ color: coat, alpha: 0.98 })
    .stroke({ color: 0xe8d9bc, width: 1, alpha: 0.35 });
  figure.roundRect(-10, -10, 8, 24, 3).fill({ color: 0x283b3d, alpha: 0.98 });
  figure.roundRect(2, -10, 8, 24, 3).fill({ color: 0x283b3d, alpha: 0.98 });
  if (behavior === "phone") {
    figure.roundRect(11, -44, 4, 12, 1).fill({ color: accent, alpha: 0.95 });
  } else if (behavior === "clipboard") {
    figure.roundRect(-17, -35, 12, 16, 2).fill({ color: accent, alpha: 0.9 });
  } else if (behavior === "carry") {
    figure.roundRect(12, -24, 17, 14, 3).fill({ color: 0xb8884c, alpha: 0.9 });
  } else if (behavior === "sit") {
    figure.rotation = -0.08;
  }
  return figure;
}

function roleForMission(mission: MissionEmbodiment): string {
  if (mission.archetype === "GATEKEEPER") return "field-role-a";
  if (mission.archetype === "STALLER") return "field-role-b";
  return "field-role-d";
}

function drawMissionScene(
  mission: MissionEmbodiment,
  roleTexture?: Texture
): Container {
  const scene = new Container();
  scene.label = `mission:${mission.missionId}:${mission.anchorId}`;
  const staging = new Graphics();
  if (mission.representation === "absence_scene") {
    // GHOST is absence by design: an empty seat/location and contact cue, no
    // invented person.
    staging.roundRect(-22, -22, 44, 6, 2).fill({ color: 0x766d63, alpha: 0.9 });
    staging.rect(-17, -16, 5, 22).fill({ color: 0x5d574f, alpha: 0.9 });
    staging.rect(12, -16, 5, 22).fill({ color: 0x5d574f, alpha: 0.9 });
    staging.circle(0, -42, 9).stroke({ color: 0xc7b5ff, width: 2, alpha: 0.7 });
    scene.addChild(staging);
  } else {
    scene.addChild(
      roleTexture
        ? drawRoleSprite(roleTexture)
        : drawRoleFigure("idle", 0x4c6864, 0xd8ad58)
    );
  }
  const signal = new Graphics();
  drawMissionSignal(signal, mission);
  scene.addChild(signal);
  return scene;
}

function drawMissionSignal(scene: Graphics, mission: MissionEmbodiment) {
  if (mission.worldSignal === "none") return;
  if (mission.worldSignal === "fracture") {
    scene
      .moveTo(-28, 8)
      .lineTo(-9, 2)
      .lineTo(2, 9)
      .lineTo(14, 1)
      .lineTo(31, 7)
      .stroke({ color: 0xb695ff, width: 3, alpha: 0.8 });
    scene
      .moveTo(-26, 11)
      .lineTo(28, 11)
      .stroke({ color: 0xe0ad48, width: 2, alpha: 0.75 });
    return;
  }
  const color =
    mission.worldSignal === "dormant"
      ? 0x8c8a80
      : mission.worldSignal === "repeat"
        ? 0x78d7cf
        : mission.worldSignal === "review"
          ? 0xa79d8c
          : 0xe0ad48;
  scene.ellipse(0, 8, 32, 9).stroke({
    color,
    width: mission.worldSignal === "dormant" ? 1 : 2,
    alpha: mission.worldSignal === "dormant" ? 0.35 : 0.75,
  });
}

function drawCapabilityStation(presence: AgentWorldPresence): Graphics {
  const station = new Graphics();
  const colorByAgent: Record<GoldlineAgentId, number> = {
    SCOUT: 0x73c9bb,
    FOLLOW_UP: 0x6cb8ce,
    RELATIONSHIP: 0xd7b66d,
    INTEL: 0xa68bd3,
  };
  const color = colorByAgent[presence.agentId];
  station
    .roundRect(-22, -34, 44, 34, 5)
    .fill({ color: 0x17282a, alpha: 0.86 })
    .stroke({ color, width: 2, alpha: 0.8 });
  station.moveTo(-12, -34).lineTo(0, -50).lineTo(12, -34).stroke({
    color,
    width: 2,
    alpha: 0.75,
  });
  if (presence.hasAuthoritativeSignal) {
    station.circle(0, -49, 5).fill({ color, alpha: 0.95 });
    station.circle(0, -49, 10).stroke({ color, width: 1, alpha: 0.45 });
  }
  return station;
}

/**
 * A genuine pickup/delivery's world marker — a clean geometric prop in the
 * same restrained vector language as the Gold Line/landmark/capability-
 * station graphics (no photographic/illustrated asset exists for this yet).
 * Pickup and delivery read as visibly distinct shapes: pickup is a crate
 * with an upward retrieval arrow, delivery a doorway with a downward
 * handoff arrow. A pale ring marks the staging radius so the player can
 * read the interaction zone before entering it.
 */
function drawOrderMarker(order: OrderEmbodiment): Container {
  const scene = new Container();
  scene.label = `order:${order.orderId}:${order.anchorId}`;
  const color = order.kind === "pickup" ? 0xe0ad48 : 0x6cb8ce;
  const ring = new Graphics();
  ring.circle(0, -18, 30).stroke({ color, width: 1.5, alpha: 0.35 });
  scene.addChild(ring);
  const prop = new Graphics();
  if (order.kind === "pickup") {
    prop
      .roundRect(-16, -30, 32, 24, 4)
      .fill({ color: 0x8a5a2c, alpha: 0.95 })
      .stroke({ color: 0xe8d9bc, width: 1.5, alpha: 0.5 });
    prop.moveTo(-16, -18).lineTo(16, -18).stroke({
      color: 0xe8d9bc,
      width: 1,
      alpha: 0.4,
    });
    prop
      .moveTo(0, -46)
      .lineTo(-8, -34)
      .lineTo(-3, -34)
      .lineTo(-3, -28)
      .lineTo(3, -28)
      .lineTo(3, -34)
      .lineTo(8, -34)
      .closePath()
      .fill({ color, alpha: 0.95 });
  } else {
    prop
      .roundRect(-14, -40, 28, 40, 3)
      .fill({ color: 0x35474a, alpha: 0.92 })
      .stroke({ color, width: 1.5, alpha: 0.55 });
    prop.circle(8, -20, 1.6).fill({ color: 0xe8d9bc, alpha: 0.9 });
    prop
      .moveTo(0, -2)
      .lineTo(-8, -14)
      .lineTo(-3, -14)
      .lineTo(-3, -20)
      .lineTo(3, -20)
      .lineTo(3, -14)
      .lineTo(8, -14)
      .closePath()
      .fill({ color, alpha: 0.95 });
  }
  scene.addChild(prop);
  return scene;
}

function applyOrderMarkerMotion(
  graphic: Container,
  now: number,
  reducedMotion: boolean
) {
  if (reducedMotion) {
    graphic.rotation = 0;
    return;
  }
  graphic.rotation = Math.sin(now / 1100) * 0.008;
}

function authoredPosition(
  node: PopulationNode,
  now: number,
  reducedMotion: boolean
): { progress: number; lateral: number } {
  if (reducedMotion || node.path.length < 2 || node.behavior !== "walk") {
    return { progress: node.baseProgress, lateral: node.baseLateral };
  }
  const first = node.path[0];
  const last = node.path[node.path.length - 1];
  const cycle = (Math.sin(now / 2200 + node.phase * Math.PI * 2) + 1) / 2;
  return {
    progress: first.progress + (last.progress - first.progress) * cycle,
    lateral: first.lateral + (last.lateral - first.lateral) * cycle,
  };
}

function placeAtCorridorPosition(
  display: Container,
  progress: number,
  lateral: number,
  width: number,
  height: number
) {
  display.x = width * (0.5 + lateral * 0.22);
  display.y = height * (0.88 - progress * 0.61);
  const scale = Math.max(0.55, Math.min(1.12, 1.12 - progress * 0.65));
  display.scale.set(scale);
}

function applyBehaviorPose(
  node: PopulationNode,
  now: number,
  reducedMotion: boolean
) {
  if (reducedMotion) {
    node.display.rotation = 0;
    return;
  }
  const phase = now / 1000 + node.phase * Math.PI * 2;
  const amplitude = node.behavior === "walk" ? 0.025 : 0.012;
  node.display.rotation = Math.sin(phase * 1.4) * amplitude;
}

function applyMissionBehavior(
  graphic: Container,
  mission: MissionEmbodiment,
  now: number,
  reducedMotion: boolean
) {
  if (reducedMotion) {
    graphic.rotation = 0;
    graphic.alpha = 1;
    return;
  }
  if (mission.archetype === "GATEKEEPER") {
    graphic.rotation = Math.sin(now / 900) * 0.015;
  } else if (mission.archetype === "STALLER") {
    graphic.x += Math.sin(now / 850) * 1.5;
  } else if (mission.archetype === "GHOST") {
    graphic.alpha = 0.82 + Math.sin(now / 950) * 0.12;
  } else {
    graphic.rotation = Math.sin(now / 1500) * 0.006;
  }
}
