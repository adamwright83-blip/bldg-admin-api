import { Application, ColorMatrixFilter, Container, Graphics, RenderTexture, Sprite, type Texture } from "pixi.js";
import { getAudioManager, type AudioCueId, type PlayOptions } from "@/game/audio/AudioManager";
import { remapAnalogInput, stepVelocity } from "../overworld/movement";
import { moveWithCollision } from "../overworld/navigation";
import type { OverworldMapDefinition } from "../overworld/types";
import { CITY_STAGE_MAP, DECK_MAP, SAIL_MAP, SHIP_END_BROKEN_MAP, SHIP_END_MAP } from "./waywardMaps";
import { RookActor, TrailblazerActor } from "./actors";
import { DECK_SPAWN, DeckScene, GUARDIAN, HULL_CACHE, SPAN_TRIGGER } from "./deckScene";
import { Particles, Shake, haptic } from "./fx";
import {
  SPAN,
  aimAt,
  boomCrate as boomCrateAt,
  clamp,
  crateShove,
  len,
  lerp,
  planSwing,
  resolveCast,
  smoothstep,
  sub,
  swingPoint,
  type CastAim,
  type SwingPlan,
  type Vec,
} from "./holdTheLine";
import { InspectorActor, loadInspectorFrames } from "./inspectors";
import { DECK_FOLLOW, SPAN_FOLLOW, facingFor, stepFollow, type RookFollowState } from "./rookBrain";
import { BOW_POINT, SAIL_SPAWN, SailScene } from "./sailScene";
import { ANCHOR_BOLLARD, CLAMP_POINT, SpanScene, type SpanSide } from "./spanScene";
import {
  FACINGS,
  PLATES,
  SPAN_PARTS,
  TRAILBLAZER,
  loadRookFrames,
  loadTextures,
  spanPartUrl,
  type Facing,
  type RookState,
} from "./waywardAssets";
import { HULL_CACHE_URL } from "./deckScene";
import { LINES, type LineId } from "./waywardLines";

export type WaywardBeat =
  | "deck"
  | "toSpan"
  | "hold"
  | "swing"
  | "landed"
  | "parley"
  | "clamp"
  | "castoff"
  | "returnSwing"
  | "toSail"
  | "sail"
  | "sealed";

export type Caption = { id: string; speaker: "ROOK" | "TRAILBLAZER" | "INSPECTOR"; text: string };

export type WaywardEvents = {
  onReady: () => void;
  onCaption: (caption: Caption | null) => void;
  onBeat: (beat: WaywardBeat) => void;
  onProgress: (patch: { visited?: boolean; spanCrossed?: boolean; cacheCollected?: boolean; tetherAwake?: boolean; relic?: "tether-memory" }) => void;
  /** The voyage is complete: the Wayward is under sail and the last word is said. */
  onSailing: () => void;
  onHint: (hint: string | null) => void;
};

export type WaywardRuntimeOptions = {
  host: HTMLElement;
  rookAboard: boolean;
  start: "deck" | "span" | "sail";
  cacheCollected: boolean;
  events: WaywardEvents;
  /** Test/preview only: exposes window.__wayward for bots. */
  exposeTestApi?: boolean;
};

type StageId = "deck" | "span" | "sail";
type TrailblazerMode = "free" | "casting" | "stagger" | "falling" | "saved" | "recoil" | "traverse" | "locked";

const TRAILBLAZER_HEIGHT = { deck: 178, span: 196, sail: 176 } as const;
const ROOK_RATIO = 0.62;

export class WaywardRuntime {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly screen = new Container();
  private readonly flash = new Graphics();
  private readonly letterbox = new Graphics();
  private readonly glyph = new Container();
  private readonly glyphRing = new Graphics();
  private readonly drain = new ColorMatrixFilter();
  private deck!: DeckScene;
  private span!: SpanScene;
  private sail!: SailScene;
  private stage: StageId = "deck";
  private tb!: TrailblazerActor;
  private rook: RookActor | null = null;
  private pell: InspectorActor | null = null;
  private dunmore: InspectorActor | null = null;
  private particles!: Particles;
  private readonly shake = new Shake();
  private readonly reducedMotion: boolean;
  private beat: WaywardBeat = "deck";
  private beatClock = 0;
  private time = 0;
  private timeScale = 1;
  private slowmo = { until: 0, scale: 1 };
  private destroyed = false;
  private paused = false;
  private input = { x: 0, y: 0 };
  private actQueued = false;
  private tbMode: TrailblazerMode = "free";
  private tbModeClock = 0;
  private tbSide: SpanSide = "ship";
  private external: Vec = { x: 0, y: 0 };
  private cam = { center: { x: 760, y: 329 }, zoom: 1, frame: 380, punch: 0, roll: 0 };
  private camTarget = { x: 760, y: 329 };
  private rookFollow: RookFollowState = { position: { x: 0, y: 0 }, facing: "back", moving: false, stillFor: 0, side: 1 };
  private rookScripted = false;
  private rookAttached = false;
  private cast: { hand: Vec; aim: Vec; at: number; outcome: ReturnType<typeof resolveCast> | null; retract: number } | null = null;
  private castCooldown = 0;
  private fouls = 0;
  private aim: CastAim | null = null;
  private swing: { plan: SwingPlan; phase: "reel" | "swing" | "fly" | "land"; clock: number; from: Vec; ring: Vec; toSide: SpanSide; landing: Vec } | null = null;
  private recoil: { from: Vec; clock: number; anchor: Vec; toShip: boolean } | null = null;
  private rookSaveUsed = false;
  private recoilCount = 0;
  private said = new Set<string>();
  private captionQueue: { line: LineId; at: number }[] = [];
  private captionUntil = 0;
  private scriptSteps: { at: number; run: () => void; done: boolean }[] = [];
  private windClock = 0;
  private creakClock = 2;
  private lastStepSound = 0;
  private resizeObserver: ResizeObserver | null = null;
  private cacheCollected: boolean;
  private finaleSaid = false;
  private hintShown = false;
  private visitedReported = false;
  private rookSeen = false;
  private parleyLimitWarned = false;
  private sealedWarned = false;
  private wasClear = false;
  private edgeClock = 0;
  private edgeWarned = false;
  private lastTelegraph = 0;
  private readonly crateShadow = new Graphics();
  private arrival: { clock: number } | null = null;
  private castOffStarted = false;
  private castHintShown = false;

  private constructor(private readonly options: WaywardRuntimeOptions) {
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.cacheCollected = options.cacheCollected;
  }

  static async create(options: WaywardRuntimeOptions): Promise<WaywardRuntime> {
    const runtime = new WaywardRuntime(options);
    try {
      await runtime.init();
      return runtime;
    } catch (error) {
      runtime.destroy();
      throw error;
    }
  }

  private async init() {
    const bounds = this.options.host.getBoundingClientRect();
    await this.app.init({
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
      backgroundColor: 0x0a121b,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
    });
    if (this.destroyed) return;
    this.options.host.appendChild(this.app.canvas);
    this.app.canvas.className = "wayward-canvas";

    const tbUrls = [
      ...FACINGS.flatMap(f => [TRAILBLAZER.directional("idle", f), ...[1, 2, 3, 4, 5].map(n => TRAILBLAZER.directional("walk", f, n))]),
      ...Object.values(TRAILBLAZER.poses),
    ];
    const plateUrls = [PLATES.bridge, PLATES.awakeDeck, PLATES.deckForeground, PLATES.guardian, PLATES.openSky, PLATES.mooringCity, PLATES.fog, HULL_CACHE_URL];
    const partUrls = SPAN_PARTS.map(spanPartUrl);
    const rookStates: RookState[] = ["idle", "walk", "talk", "confide", "wait", "letter", "dangle", "shrug", "brace", "point"];
    const [textures, rookFrames, inspectorFrames] = await Promise.all([
      loadTextures([...tbUrls, ...plateUrls, ...partUrls]),
      this.options.rookAboard ? loadRookFrames(rookStates) : Promise.resolve(null),
      loadInspectorFrames(),
    ]);
    if (this.destroyed) return;

    this.deck = new DeckScene(textures);
    this.span = new SpanScene(textures, this.reducedMotion);
    this.sail = new SailScene(textures);
    this.deck.cacheTaken = this.cacheCollected;
    this.particles = new Particles(this.app.renderer);
    this.tb = new TrailblazerActor(textures, DECK_SPAWN, TRAILBLAZER_HEIGHT.deck);
    this.tb.onStep = () => this.footstep(0.9);
    if (rookFrames) {
      this.rook = new RookActor(rookFrames, { x: DECK_SPAWN.x + 84, y: DECK_SPAWN.y - 20 }, TRAILBLAZER_HEIGHT.deck * ROOK_RATIO);
      this.rook.onStep = () => this.footstep(0.55, 1.4);
      this.rookFollow = { position: { ...this.rook.position }, facing: "back", moving: false, stillFor: 0, side: 1 };
    }
    this.pell = new InspectorActor(inspectorFrames, "pell", { x: 1206, y: 444 }, 224);
    this.dunmore = new InspectorActor(inspectorFrames, "dunmore", { x: 1270, y: 460 }, 224);

    this.drain.desaturate();
    this.drain.alpha = 0;
    this.world.filters = [];
    this.app.stage.addChild(this.world, this.screen);
    this.glyph.addChild(this.glyphRing);
    this.screen.addChild(this.letterbox, this.flash);

    this.span.onHeavyRoll = () => this.heavyRoll();
    this.span.onCargoFall = at => {
      this.particles.emit("splinter", at, { count: 6, speed: 180 });
      this.cue("plank_crack", { pitch: 0.8 });
      this.cue("debris_fall", { delayMs: 180 });
    };

    // Upload every texture to the GPU now, behind the loading card, so no scene
    // change or first gesture stalls a frame on a texture upload later.
    this.prewarm([
      ...textures.values(),
      ...[...(rookFrames?.values() ?? [])].flat(),
      ...[...inspectorFrames.values()].flat(),
    ]);

    const start = this.options.start;
    if (start === "sail") this.enterSail(true);
    else if (start === "span") this.enterSpanFromSave();
    else this.enterDeck();

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.options.host);
    this.app.ticker.add(this.tick);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (this.options.exposeTestApi) this.installTestApi();
    this.options.events.onReady();
  }

  private prewarm(textures: Texture[]) {
    const target = RenderTexture.create({ width: 8, height: 8 });
    const batch = new Container();
    const seen = new Set<unknown>();
    for (const texture of textures) {
      if (!texture || seen.has(texture.source)) continue;
      seen.add(texture.source);
      const sprite = new Sprite(texture);
      sprite.width = 4;
      sprite.height = 4;
      batch.addChild(sprite);
    }
    try {
      for (const root of [batch, this.deck.root, this.span.root, this.sail.root]) this.app.renderer.render({ container: root, target, clear: true });
    } catch {
      // A failed warm-up only costs a hitch later.
    }
    batch.destroy({ children: true });
    target.destroy(true);
  }

  // ------------------------------------------------------------------ input
  setMove(x: number, y: number) {
    this.input = { x, y };
    if ((x || y) && !this.visitedReported) {
      this.visitedReported = true;
      this.options.events.onProgress({ visited: true });
    }
  }

  act() {
    this.actQueued = true;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.input = { x: 0, y: 0 };
  }

  private onVisibility = () => this.setPaused(document.hidden);

  // ------------------------------------------------------------------ stages
  private mount(stage: StageId) {
    this.world.removeChildren();
    this.stage = stage;
    const root = stage === "deck" ? this.deck.root : stage === "span" ? this.span.root : this.sail.root;
    this.world.addChild(root);
    // The Line is drawn above the scene so the RECOIL's colour drain never touches it.
    if (stage === "span") this.world.addChild(this.span.hookLine);
    this.world.addChild(this.particles.view);
    this.world.addChild(this.glyph);
    this.particles.clear();
  }

  private enterDeck() {
    this.mount("deck");
    this.tb.height = TRAILBLAZER_HEIGHT.deck;
    // They come aboard from the gangway behind the camera and walk up into the shot.
    this.tb.position = { x: DECK_SPAWN.x, y: 668 };
    this.tb.facing = "back";
    this.tbMode = "locked";
    this.deck.actors.addChild(this.tb.view);
    this.arrival = { clock: 0 };
    if (this.rook) {
      this.rook.height = TRAILBLAZER_HEIGHT.deck * ROOK_RATIO;
      this.rook.position = { x: DECK_SPAWN.x + 92, y: 700 };
      this.rook.play("walk", "back");
      this.rookScripted = true;
      this.rookFollow = { position: { ...this.rook.position }, facing: "back", moving: false, stillFor: 0, side: 1 };
      this.deck.actors.addChild(this.rook.view);
    }
    this.cam.center = { x: DECK_SPAWN.x, y: 329 };
    this.setBeat("deck");
    this.schedule([
      { at: 0.9, run: () => this.options.events.onHint("DRAG TO MOVE · TAP TO ACT") },
      {
        at: 1.6,
        run: () => {
          if (!this.rook) return;
          this.say("rook-nobody-alive");
          this.say("tb-mine");
          this.say("rook-not-yet");
        },
      },
    ]);
  }

  private enterSpan(fromDeck: boolean) {
    this.mount("span");
    this.tbSide = "ship";
    this.tb.height = TRAILBLAZER_HEIGHT.span;
    this.tb.position = { x: fromDeck ? 214 : 420, y: 452 };
    this.tb.facing = "right";
    this.tb.setPose(null);
    this.attachToSide(this.tb.view, "ship");
    if (this.rook) {
      this.rook.height = TRAILBLAZER_HEIGHT.span * ROOK_RATIO;
      this.rook.position = { x: fromDeck ? 250 : 380, y: 458 };
      this.rookFollow = { position: { ...this.rook.position }, facing: "right", moving: false, stillFor: 0, side: 1 };
      this.attachToSide(this.rook.view, "ship");
    }
    this.placeInspectors();
    this.cam.center = { x: 470, y: 340 };
    this.setBeat("hold");
    this.tbMode = "free";
    this.span.calm = false;
    this.schedule([
      { at: 0.9, run: () => this.rook && this.say("rook-long-way-down") },
    ]);
  }

  private enterSpanFromSave() {
    // Resume on the city side, past the crossing: the edge is already gone.
    this.enterSpan(false);
    this.span.edgeBroken = true;
    this.span.calm = true;
    this.tbSide = "city";
    this.tb.position = { x: 1010, y: 440 };
    this.tb.facing = "right";
    this.attachToSide(this.tb.view, "city");
    if (this.rook) {
      this.rook.position = { x: 1062, y: 452 };
      this.rookFollow.position = { ...this.rook.position };
      this.attachToSide(this.rook.view, "city");
    }
    this.cam.center = { x: 1110, y: 340 };
    this.startParleyOrSeal();
  }

  private enterSail(fromSave: boolean) {
    this.mount("sail");
    this.tb.height = TRAILBLAZER_HEIGHT.sail;
    this.tb.position = { ...SAIL_SPAWN };
    this.tb.facing = "back";
    this.tb.setPose(fromSave ? null : "land");
    this.tb.offset = { x: 0, y: 0 };
    this.tb.setTint(0xffffff);
    this.sail.actors.addChild(this.tb.view);
    this.tbMode = fromSave ? "free" : "locked";
    this.tbModeClock = 0;
    if (this.rook) {
      this.rook.height = TRAILBLAZER_HEIGHT.sail * ROOK_RATIO;
      this.rook.visible = true;
      this.rook.offset = { x: 0, y: 0 };
      this.rook.rotation = 0;
      this.rookAttached = false;
      this.rook.position = fromSave ? { ...BOW_POINT } : { x: SAIL_SPAWN.x + 78, y: SAIL_SPAWN.y + 10 };
      this.rook.play(fromSave ? "idle" : "brace", fromSave ? "back" : "left");
      this.sail.actors.addChild(this.rook.view);
      this.rookScripted = true;
    }
    const done = fromSave ? 1 : 0;
    this.sail.awaken = done;
    this.sail.seamRun = done;
    this.sail.lineRun = done;
    this.sail.leaving = done;
    this.sail.speed = done;
    this.finaleSaid = fromSave;
    this.cam.center = { x: SAIL_SPAWN.x, y: 329 };
    this.cam.frame = 0;
    this.setBeat("sail");
    if (fromSave) return;
    this.shake.add(0.5);
    this.cue("deck_land");
    haptic([40, 20, 30]);
    this.particles.emit("dust", SAIL_SPAWN, { count: 14, speed: 150, spread: Math.PI, angle: -Math.PI / 2 });
    this.schedule([
      { at: 0.35, run: () => { this.cue("wayward_horn"); haptic([30, 60, 30, 60, 90]); } },
      { at: 0.9, run: () => this.cue("gold_line_wake") },
      { at: 1.9, run: () => { this.cue("sail_fill"); this.shake.add(0.35); haptic([20, 30, 50]); this.particles.emit("streak", { x: 760, y: 260 }, { count: 26, speed: 900, angle: Math.PI * 0.95, spread: 0.2, life: 0.8, gravity: 0, jitter: 520 }); } },
      { at: 2.0, run: () => { this.tb.setPose(null); this.tbMode = "free"; this.rook?.play("idle", "back"); } },
      { at: 2.6, run: () => this.cue("timber_creak", { pitch: 0.6 }) },
      { at: 3.4, run: () => this.rook && this.walkRookTo(BOW_POINT, () => this.rook?.play("idle", "back")) },
      { at: 5.0, run: () => this.cue("wind_gust", { pitch: 0.8 }) },
    ]);
  }

  private attachToSide(view: Container, side: SpanSide | "world") {
    const parent = side === "ship" ? this.span.shipEnd : side === "city" ? this.span.cityEnd : this.span.root;
    if (view.parent !== parent) parent.addChild(view);
  }

  private placeInspectors() {
    if (!this.pell || !this.dunmore) return;
    this.pell.position = { x: 1206, y: 444 };
    this.dunmore.position = { x: 1270, y: 460 };
    this.pell.facing = 1;
    this.dunmore.facing = 1;
    this.pell.setPose("inspect");
    this.dunmore.setPose("idle");
    this.span.cityEnd.addChild(this.pell.view, this.dunmore.view);
    this.pell.view.visible = true;
    this.dunmore.view.visible = true;
  }

  private setBeat(beat: WaywardBeat) {
    this.beat = beat;
    this.beatClock = 0;
    this.scriptSteps = [];
    this.options.events.onBeat(beat);
  }

  private schedule(steps: { at: number; run: () => void }[]) {
    for (const step of steps) this.scriptSteps.push({ ...step, done: false });
  }

  // ------------------------------------------------------------------ loop
  private tick = () => {
    if (this.destroyed || this.paused) return;
    const raw = Math.min(0.05, this.app.ticker.deltaMS / 1000);
    const slow = this.time < this.slowmo.until ? this.slowmo.scale : 1;
    const dt = raw * this.timeScale * slow;
    this.time += dt;
    this.beatClock += dt;
    for (const step of this.scriptSteps) {
      if (!step.done && this.beatClock >= step.at) {
        step.done = true;
        step.run();
      }
    }
    this.updateCaptions();
    this.ambience(dt);
    if (this.stage === "deck") this.updateDeck(dt);
    else if (this.stage === "span") this.updateSpan(dt);
    else this.updateSail(dt);
    this.actQueued = false;
    this.particles.update(dt);
    this.updateCamera(raw);
    this.updateScreen(raw);
  };

  // ------------------------------------------------------------------ deck
  private updateDeck(dt: number) {
    if (this.arrival) {
      const a = this.arrival;
      a.clock += dt;
      const k = Math.min(1, a.clock / 1.5);
      const e = 1 - (1 - k) * (1 - k);
      this.tb.position = { x: DECK_SPAWN.x, y: lerp(668, DECK_SPAWN.y, e) };
      this.tb.moving = k < 1;
      this.tb.velocity = { x: 0, y: k < 1 ? -60 : 0 };
      if (this.rook) {
        this.rook.position = { x: DECK_SPAWN.x + 92, y: lerp(700, DECK_SPAWN.y - 14, Math.min(1, a.clock / 1.9)) };
        this.rook.setWalkRate(70, this.deck.depthScale(this.rook.position.y));
        if (a.clock >= 1.9) {
          this.rook.play("idle", "back");
          this.rookScripted = false;
          this.rookFollow.position = { ...this.rook.position };
        }
      }
      if (k >= 1 && (!this.rook || a.clock >= 1.9)) {
        this.arrival = null;
        this.tbMode = "free";
        this.tb.moving = false;
      }
    }
    this.moveFree(dt, DECK_MAP, this.deck.depthScale(this.tb.position.y));
    const scale = this.deck.depthScale(this.tb.position.y);
    this.tb.update(dt);
    this.tb.present(scale);
    this.tb.view.zIndex = this.tb.position.y;
    this.updateRookFollow(dt, p => this.deck.walkable(p), DECK_FOLLOW, y => this.deck.depthScale(y));
    const d = Math.hypot(this.tb.position.x - 770, this.tb.position.y - 458);
    this.deck.seamWarmth = clamp(1 - (d - 60) / 260, 0, 1);
    const g = Math.hypot(this.tb.position.x - GUARDIAN.x, (this.tb.position.y - GUARDIAN.y) * 1.6);
    const notice = clamp(1 - (g - 90) / 260, 0, 1);
    if (notice > 0.6 && this.deck.guardianNotice <= 0.6) this.cue("ship_groan", { pitch: 1.6 });
    this.deck.guardianNotice = lerp(this.deck.guardianNotice, notice, Math.min(1, dt * 2));
    this.deck.update(this.time, this.cam.center, Math.sin(this.time * 0.37) * 0.5 + 0.5);

    // The hull cache: optional, off to the left.
    const nearCache = !this.deck.cacheTaken && len(sub(this.tb.position, HULL_CACHE)) < 70;
    this.setGlyph(nearCache ? "search" : null, { x: HULL_CACHE.x, y: HULL_CACHE.y - 96 });
    if (nearCache && this.actQueued) this.openHullCache();

    if (this.beat === "deck" && this.tb.position.y <= SPAN_TRIGGER.maxY && this.tb.position.x >= SPAN_TRIGGER.minX && this.tb.position.x <= SPAN_TRIGGER.maxX) {
      this.goToSpan();
    }
    if (this.beat === "toSpan") this.tb.velocity = { x: 0, y: 0 };
  }

  private openHullCache() {
    this.deck.cacheTaken = true;
    this.cacheCollected = true;
    this.options.events.onProgress({ cacheCollected: true, relic: "tether-memory" });
    this.cue("vision_flash");
    haptic([12, 40, 12]);
    this.flashScreen(0xffe7a8, 0.55, 0.7);
    this.particles.emit("glint", { x: HULL_CACHE.x, y: HULL_CACHE.y - 30 }, { count: 14, speed: 160, life: 1.1, gravity: -30 });
    this.options.events.onHint("TETHER MEMORY — THE LINE SHOWS WHERE THE RING WILL BE");
  }

  private goToSpan() {
    this.setBeat("toSpan");
    this.tbMode = "locked";
    this.options.events.onHint(null);
    this.cue("wind_rush");
    this.fadeTo(0xf4ecdc, 0.55, () => {
      this.enterSpan(true);
      this.fadeFrom(0.6);
    });
  }

  // ------------------------------------------------------------------ span
  private updateSpan(dt: number) {
    this.span.update(this.time, dt);
    const side = this.tbSide;
    const depth = this.span.depthScale(this.tb.position.y);
    switch (this.tbMode) {
      case "free":
        this.moveOnSpan(dt);
        break;
      case "stagger":
        this.tbModeClock += dt;
        this.moveOnSpan(dt, true);
        if (this.tbModeClock > 0.5) {
          this.tbMode = "free";
          this.tb.setPose(null);
        }
        break;
      case "falling":
        this.updateFall(dt);
        break;
      case "saved":
        this.updateSaved(dt);
        break;
      case "recoil":
        this.updateRecoil(dt);
        break;
      case "traverse":
        this.updateSwing(dt);
        break;
      case "casting":
        this.moveOnSpan(dt, true);
        break;
      default:
        break;
    }
    this.updateCast(dt);
    this.updateHoldPrompt();
    this.updateBeatSpan(dt);
    if (this.beat === "hold") this.updateHoldHazards(dt);
    else this.crateShadow.clear();

    this.tb.update(dt);
    const showShadow = this.tbMode !== "traverse" && this.tbMode !== "falling" && this.tbMode !== "recoil";
    this.tb.present(this.tbMode === "traverse" || this.tbMode === "recoil" ? 1 : depth, showShadow);
    if (this.tb.view.parent === this.span.shipEnd) this.tb.view.rotation = -this.span.roll.angle * 0.8;
    else this.tb.view.rotation = 0;
    this.tb.view.zIndex = 10 + this.tb.position.y;
    if (side === "city" && this.tbMode !== "traverse" && this.tb.view.parent === this.span.cityEnd) {
      this.tb.view.y = this.tb.position.y + this.span.citySag(this.tb.position.x);
    }

    if (this.rook) {
      if (!this.rookScripted && !this.rookAttached) {
        const rookSide = this.tbSide;
        this.updateRookFollow(dt, p => this.span.walkable(rookSide, p), SPAN_FOLLOW, y => this.span.depthScale(y));
      } else {
        this.rook.update(dt);
        this.presentRook(this.rookAttached ? 1 : this.span.depthScale(this.rook.position.y));
      }
      if (this.rook.view.parent === this.span.shipEnd) this.rook.view.rotation = -this.span.roll.angle * 0.8;
      this.rook.view.zIndex = 10 + this.rook.position.y + (this.rookAttached ? 40 : 0);
      if (this.rook.view.parent === this.span.cityEnd && !this.rookAttached) {
        this.rook.view.y = this.rook.position.y + this.span.citySag(this.rook.position.x);
      }
    }
    for (const inspector of [this.pell, this.dunmore]) {
      if (!inspector || !inspector.view.visible) continue;
      if (inspector.walkSpeed) inspector.position.x += inspector.walkSpeed * dt;
      inspector.update(dt);
      inspector.present(this.span.depthScale(inspector.position.y));
      inspector.view.zIndex = 10 + inspector.position.y;
      inspector.view.y = inspector.position.y + this.span.citySag(inspector.position.x);
      if (inspector.position.x > 1620) inspector.view.visible = false;
    }
    this.span.setCamera(this.cam.center);
  }

  private moveOnSpan(dt: number, restricted = false) {
    const side = this.tbSide;
    const depth = this.span.depthScale(this.tb.position.y);
    const analog = restricted ? { x: 0, y: 0, magnitude: 0 } : remapAnalogInput(this.input.x, this.input.y);
    const squashed = { x: analog.x, y: analog.y * 0.42, magnitude: analog.magnitude };
    this.tb.velocity = stepVelocity(this.tb.velocity, squashed, dt);
    // Forces she does not choose: the deck's tilt and anything that hit her.
    const tilt = side === "ship" && this.span.departure === 0 ? Math.sin(this.span.roll.angle) * 1500 : 0;
    // The mooring stage lists toward the gap: a lean at first, a slide once the edge starts to go.
    const sag = side === "city" && this.span.collapse > 0 ? -(18 + 170 * smoothstep(3.0, 4.4, this.span.collapse)) : 0;
    const forced = { x: (this.external.x + tilt + sag) * dt, y: this.external.y * dt };
    this.external = { x: this.external.x * Math.max(0, 1 - dt * 4.5), y: this.external.y * Math.max(0, 1 - dt * 4.5) };
    let p = this.tb.position;
    const forcedTo = { x: p.x + forced.x, y: p.y + forced.y };
    const over = side === "ship" ? this.span.pastShipEdge(forcedTo) : this.span.pastCityEdge(forcedTo);
    if (over > 4) {
      this.tb.position = forcedTo;
      this.startFall();
      return;
    }
    if (this.span.walkable(side, forcedTo)) p = forcedTo;
    const step = { x: this.tb.velocity.x * dt, y: this.tb.velocity.y * dt };
    const moved = moveWithCollision(this.spanMap(side), p, step, 3);
    if (moved.x === p.x && moved.y === p.y && (step.x || step.y)) this.tb.velocity = { x: 0, y: 0 };
    p = moved;
    this.tb.position = p;
    const speed = Math.hypot(this.tb.velocity.x, this.tb.velocity.y);
    this.tb.moving = speed > 8 && this.tbMode === "free";
    if (this.tb.moving) this.tb.facing = Math.abs(this.tb.velocity.x) >= Math.abs(this.tb.velocity.y) * 0.6 ? (this.tb.velocity.x < 0 ? "left" : "right") : this.tb.velocity.y < 0 ? "back" : "front";
    void depth;

    // Cargo sliding down her lane knocks her toward the edge.
    if (side === "ship" && this.tbMode === "free") {
      const hit = this.span.cargoNear(p, 46);
      if (hit && hit.vx > 90) this.knock({ x: hit.vx * 0.9 + 180, y: 0 }, "cargo");
      const crateHit = this.crateContact();
      if (crateHit) this.knock(crateHit, "crate");
    }
  }

  private spanMap(side: SpanSide): OverworldMapDefinition {
    if (side === "city") return CITY_STAGE_MAP;
    return this.span.edgeBroken ? SHIP_END_BROKEN_MAP : SHIP_END_MAP;
  }

  /** The boom crate sweeping the edge: a solid hit if it passes through her. */
  private crateContact(): Vec | null {
    if (this.span.departure > 0 || this.tbSide !== "ship") return null;
    const feet = this.span.shipToWorld(this.tb.position);
    return crateShove(this.time, feet, this.tb.height * this.span.depthScale(this.tb.position.y));
  }

  private knock(force: Vec, source: "cargo" | "crate" | "foul") {
    if (this.tbMode !== "free" && this.tbMode !== "casting") return;
    this.external = { x: force.x, y: force.y };
    this.tbMode = "stagger";
    this.tbModeClock = 0;
    this.tb.setPose(source === "foul" ? "vault" : "jump_start", { flip: force.x < 0 });
    this.shake.add(source === "crate" ? 0.45 : 0.3);
    haptic(source === "crate" ? [40, 30, 60] : [30, 20, 30]);
    this.cue(source === "crate" ? "crate_hit" : source === "cargo" ? "cargo_hit" : "linehook_foul");
    const w = this.worldOf(this.tb.position);
    this.particles.emit("dust", { x: w.x, y: w.y - 10 }, { count: 7, speed: 90 });
    if (source === "crate") this.particles.emit("splinter", { x: w.x, y: w.y - 90 }, { count: 5, speed: 220 });
    if (this.rook && !this.rookScripted) this.rook.play("brace", this.rook.facing);
  }

  /** What makes the ship's end dangerous to stand on, and how it warns you first. */
  private updateHoldHazards(dt: number) {
    const roll = this.span.roll;
    // The timbers groan before a heavy roll: dust shakes out of the planks.
    if (roll.telegraph > 0) {
      if (this.lastTelegraph === 0) {
        this.cue("timber_creak", { pitch: 0.55 });
        if (this.rook && !this.rookScripted && !this.rookAttached) this.rook.play("brace", this.rook.facing);
      }
      if (Math.random() < 0.5) {
        const local = { x: 340 + Math.random() * 300, y: 400 + Math.random() * 55 };
        this.particles.emit("dust", this.span.shipToWorld(local), { count: 1, speed: 30, life: 0.6, scale: 0.6, alpha: 0.7 });
      }
      this.shake.add(dt * 0.12);
    }
    this.lastTelegraph = roll.telegraph;

    // The crate's shadow on the planks: where it will sweep, before it gets there.
    const crate = boomCrateAt(this.time);
    const g = this.crateShadow.clear();
    if (!this.crateShadow.parent) this.span.shipEnd.addChild(this.crateShadow);
    const overDeck = crate.center.x < SPAN.leftEdgeX + 30 && crate.center.x > 330;
    if (overDeck) {
      const height = Math.max(0, 430 - (crate.center.y + SPAN.crateHalf.y));
      const alpha = clamp(0.5 - height / 500, 0.08, 0.42);
      g.ellipse(crate.center.x, 452, 54 + height * 0.08, 9).fill({ color: 0x0a0604, alpha });
      g.zIndex = 5;
    }

    // Standing on the crumbling edge: it groans, then it goes.
    if (this.tbSide === "ship" && this.tbMode === "free" && !this.span.edgeBroken) {
      const near = this.span.pastShipEdge(this.tb.position) > -36;
      this.edgeClock = near ? this.edgeClock + dt : Math.max(0, this.edgeClock - dt * 2);
      if (this.edgeClock > 2.0 && !this.edgeWarned) {
        this.edgeWarned = true;
        this.cue("plank_crack", { pitch: 1.2 });
        this.shake.add(0.12);
        haptic(14);
        this.particles.emit("splinter", this.worldOf({ x: this.tb.position.x + 20, y: this.tb.position.y }), { count: 4, speed: 120 });
      }
      if (this.edgeClock > 3.3) {
        this.edgeClock = 0;
        this.edgeWarned = false;
        this.cue("plank_crack", { pitch: 0.8 });
        this.startFall();
      }
      if (!near) this.edgeWarned = this.edgeClock > 2.0 && this.edgeWarned;
    }
  }

  private worldOf(p: Vec): Vec {
    if (this.stage !== "span") return p;
    if (this.tb.view.parent === this.span.shipEnd) return this.span.shipToWorld(p);
    return { x: p.x, y: p.y + (this.tb.view.parent === this.span.cityEnd ? this.span.citySag(p.x) : 0) };
  }

  private heavyRoll() {
    this.cue("ship_groan", { pitch: 0.9 + Math.random() * 0.2 });
    this.shake.add(0.18);
    haptic(18);
    const launched = this.span.launchCargo();
    if (launched) this.cue("cargo_slide", { delayMs: 200 });
    if (this.rook && !this.rookScripted && !this.rookAttached && this.stage === "span") this.rook.play("brace", this.rook.facing);
  }

  // ------------------------------------------------------------------ casting
  private updateHoldPrompt() {
    const casting = (this.beat === "hold" && this.tbSide === "ship") || (this.beat === "castoff" && this.tbSide === "city") || (this.beat === "sealed" && this.tbSide === "city");
    const g = this.span.aimLine.clear();
    this.aim = null;
    if (!casting || (this.tbMode !== "free" && this.tbMode !== "stagger")) {
      if (this.stage === "span" && this.beat !== "clamp") this.setGlyph(null);
      return;
    }
    const hand = this.handWorld();
    const ring = this.span.ringAt;
    const aim = aimAt(hand, ring, this.span.obstructions());
    this.aim = aim;
    if (!aim.inRange && aim.distance > SPAN.castRange + 260) {
      this.setGlyph(null);
      return;
    }
    // The gold thread: what the Linehook would do if she cast now.
    const t = this.time;
    const end = aim.blockedBy ? aim.blockedBy.at : ring;
    const reach = aim.inRange ? 1 : clamp(SPAN.castRange / aim.distance, 0, 1);
    const tip = { x: lerp(hand.x, end.x, aim.blockedBy ? 1 : reach), y: lerp(hand.y, end.y, aim.blockedBy ? 1 : reach) };
    if (aim.inRange && aim.clear) {
      const pulse = 0.65 + Math.sin(t * 9) * 0.25;
      g.moveTo(hand.x, hand.y).lineTo(tip.x, tip.y).stroke({ color: 0xffc85a, width: 7, alpha: 0.18 * pulse });
      g.moveTo(hand.x, hand.y).lineTo(tip.x, tip.y).stroke({ color: 0xffe6a0, width: 2, alpha: 0.85 * pulse });
      g.circle(ring.x, ring.y, 30 + Math.sin(t * 6) * 3).stroke({ color: 0xffe6a0, width: 2.5, alpha: 0.7 });
    } else if (aim.inRange) {
      dashed(g, hand, tip, 10, 7, { color: 0xff8a4a, width: 2, alpha: 0.75 });
      g.circle(tip.x, tip.y, 7).stroke({ color: 0xff7040, width: 2.2, alpha: 0.9 });
      g.moveTo(tip.x - 6, tip.y - 6).lineTo(tip.x + 6, tip.y + 6).moveTo(tip.x + 6, tip.y - 6).lineTo(tip.x - 6, tip.y + 6).stroke({ color: 0xff7040, width: 2 });
    } else {
      dashed(g, hand, tip, 5, 11, { color: 0xd8cbb0, width: 1.5, alpha: 0.35 });
    }
    if (this.cacheCollected && aim.inRange) {
      // Tether Memory: the line shows where the ring is going.
      const ahead = this.span.ringAtTime(this.time + len(sub(ring, hand)) / SPAN.hookSpeed);
      g.circle(ahead.x, ahead.y, 22).stroke({ color: 0xfff1c0, width: 1.5, alpha: 0.45 });
    }
    this.setGlyph(aim.inRange ? (aim.clear ? "cast" : "blocked") : null, { x: hand.x, y: hand.y - 70 });
    const clean = aim.inRange && aim.clear;
    if (clean && !this.wasClear && this.tbMode === "free") {
      this.cue("line_clear");
      haptic(6);
    }
    this.wasClear = clean;
    if (!this.castHintShown && this.beat === "hold" && this.beatClock > 14 && this.fouls === 0 && !this.cast) {
      this.castHintShown = true;
      this.options.events.onHint("WHEN THE THREAD RUNS GOLD TO THE RING — TAP");
    }
    if (this.actQueued && this.tbMode === "free" && this.castCooldown <= 0 && aim.inRange) this.fireCast(hand, ring);
    else if (this.actQueued && !aim.inRange && this.tbMode === "free") this.cue("linehook_dry", { pitch: 1.1 });
  }

  private handWorld(): Vec {
    const depth = this.span.depthScale(this.tb.position.y);
    const reach = this.tbSide === "ship" ? 20 : -20;
    const local = { x: this.tb.position.x + reach * depth, y: this.tb.position.y - this.tb.height * 0.78 * depth };
    return this.worldOf(local);
  }

  private fireCast(hand: Vec, ring: Vec) {
    this.cast = { hand, aim: { ...ring }, at: this.time, outcome: null, retract: 0 };
    this.castCooldown = 0.35;
    this.tbMode = "casting";
    this.tb.setPose("jump_air", { flip: this.tbSide === "city" });
    this.cue("linehook_fire");
    haptic(12);
  }

  private updateCast(dt: number) {
    this.castCooldown = Math.max(0, this.castCooldown - dt);
    const cast = this.cast;
    // The swing and the RECOIL draw their own Line; only a cast owns it otherwise.
    if (!cast) {
      if (this.tbMode !== "traverse" && this.tbMode !== "recoil") this.span.hookLine.clear();
      return;
    }
    const g = this.span.hookLine.clear();
    const hand = this.handWorld();
    if (cast.outcome && cast.outcome.kind !== "flying") {
      // Slack line whipping back to her hand.
      cast.retract += dt;
      const k = Math.min(1, cast.retract / 0.28);
      const from = cast.outcome.at;
      const tip = { x: lerp(from.x, hand.x, k), y: lerp(from.y, hand.y, k) + Math.sin(k * Math.PI) * 40 };
      goldLine(g, hand, tip, 1 - k * 0.6, true);
      if (k >= 1) this.cast = null;
      return;
    }
    const outcome = resolveCast(cast.hand, cast.aim, cast.at, this.time, time => this.span.ringAtTime(time), time => this.span.obstructions(time));
    if (outcome.kind === "flying") {
      goldLine(g, hand, outcome.tip, 1, false);
      g.circle(outcome.tip.x, outcome.tip.y, 5).fill({ color: 0xfff1c2 });
      return;
    }
    cast.outcome = outcome;
    if (outcome.kind === "bite") {
      this.cast = null;
      this.bite(outcome.at);
    } else if (outcome.kind === "foul") {
      this.fouls += 1;
      this.particles.emit("spark", outcome.at, { count: 16, speed: 360, life: 0.45 });
      this.particles.emit("splinter", outcome.at, { count: 4, speed: 160 });
      this.shake.add(0.22);
      haptic([30, 30, 40]);
      this.cue("linehook_foul");
      this.cue("line_twang", { pitch: 0.8, delayMs: 40 });
      // The fouled line snaps taut and yanks her toward what it caught.
      const dir = Math.sign(outcome.at.x - hand.x) || 1;
      this.tbMode = "free";
      this.knock({ x: dir * 330, y: 0 }, "foul");
      this.castCooldown = 0.9;
      if (this.fouls === 2 && this.rook && !this.rookScripted) this.rookPointsAtRing();
    } else {
      this.cue("linehook_dry");
      this.tbMode = "free";
      this.tb.setPose(null);
      this.castCooldown = 0.6;
    }
  }

  private rookPointsAtRing() {
    if (!this.rook) return;
    this.rookScripted = true;
    this.rook.play("point", "right", () => {
      window.setTimeout(() => {
        this.rookScripted = false;
      }, 900);
    });
    this.say("rook-when-it-comes-back");
  }

  private bite(at: Vec) {
    this.particles.emit("spark", at, { count: 26, speed: 420, life: 0.55 });
    this.particles.emit("glint", at, { count: 3, speed: 40, life: 0.5, gravity: 0 });
    this.cue("linehook_bite");
    this.cue("line_twang", { delayMs: 70 });
    haptic([18, 30, 70]);
    this.shake.add(0.35);
    this.cam.punch = 0.08;
    this.slowmo = { until: this.time + 0.12, scale: 0.15 };
    this.flashScreen(0xfff4d0, 0.35, 0.18);
    const toCity = this.tbSide === "ship";
    const feet = this.worldOf(this.tb.position);
    const landing = toCity ? { x: 1030, y: 438 } : this.span.shipToWorld({ x: 400, y: 432 });
    const edgeX = toCity ? this.span.shipToWorld({ x: SPAN.leftEdgeX - 14, y: 440 }).x : SPAN.rightEdgeX + 14;
    const plan = planSwing(feet, this.tb.height * 0.78, at, landing, toCity, edgeX);
    this.swing = { plan, phase: plan.reelTo ? "reel" : "swing", clock: 0, from: feet, ring: at, toSide: toCity ? "city" : "ship", landing };
    this.tbMode = "traverse";
    this.setBeat(toCity ? "swing" : "returnSwing");
    // She is flying between the two ends now: draw her in world space.
    this.span.root.addChild(this.tb.view);
    this.tb.position = feet;
    if (toCity) {
      this.span.breakEdge(pt => {
        this.particles.emit("splinter", pt, { count: 8, speed: 240 });
        this.particles.emit("dust", pt, { count: 5, speed: 60 });
      });
      this.cue("plank_crack", { delayMs: 140 });
      this.cue("debris_fall", { delayMs: 380 });
    }
    // Rook grabs on.
    if (this.rook) {
      this.rookAttached = true;
      this.rookScripted = true;
      this.span.root.addChild(this.rook.view);
      this.rook.play("dangle", toCity ? "right" : "left");
    }
  }

  private updateSwing(dt: number) {
    const s = this.swing;
    if (!s) return;
    s.clock += dt;
    const hh = this.tb.height * 0.78;
    // The ring keeps moving under load; the arc rides with it.
    const ring = this.beat === "returnSwing" ? this.span.ringAt : s.ring;
    let hand: Vec;
    if (s.phase === "reel") {
      const k = Math.min(1, s.clock / s.plan.reelSeconds);
      const e = k * k;
      const w = s.plan.reelTo!;
      const feet = { x: lerp(s.from.x, w.x, e), y: lerp(s.from.y, w.y, e) };
      this.tb.position = feet;
      this.tb.setPose("vault", { flip: s.toSide === "ship" });
      hand = { x: feet.x, y: feet.y - hh };
      if (Math.random() < 0.5) this.particles.emit("dust", { x: feet.x, y: feet.y }, { count: 1, speed: 40 });
      if (k >= 1) {
        s.phase = "swing";
        s.clock = 0;
        s.plan = planSwing(feet, hh, ring, s.landing, s.toSide === "city", feet.x);
        this.cue("swing_whoosh");
      }
    } else if (s.phase === "swing") {
      const f = Math.min(1, s.clock / s.plan.swingSeconds);
      hand = swingPoint(s.plan, ring, f);
      const angle = lerp(s.plan.startAngle, s.plan.endAngle, 0.5 - Math.cos(f * Math.PI) / 2);
      this.tb.position = { x: hand.x, y: hand.y + hh * 0.98 };
      this.tb.setPose(f < 0.5 ? "climb_a" : "climb_b", { rotation: -angle * 0.55 });
      if (f > 0.35 && f < 0.6 && this.slowmo.until < this.time) this.slowmo = { until: this.time + 0.1, scale: 0.6 };
      if (f >= 1) {
        s.phase = "fly";
        s.clock = 0;
        s.from = { ...this.tb.position };
        this.cue("line_release");
      }
    } else if (s.phase === "fly") {
      const k = Math.min(1, s.clock / 0.34);
      const landing = s.toSide === "ship" ? this.span.shipToWorld({ x: 400, y: 432 }) : s.landing;
      const feet = { x: lerp(s.from.x, landing.x, k), y: lerp(s.from.y, landing.y, k) - Math.sin(k * Math.PI) * 60 };
      this.tb.position = feet;
      this.tb.setPose("jump_air", { flip: s.toSide === "ship" });
      hand = { x: feet.x, y: feet.y - hh };
      if (k >= 1) {
        s.phase = "land";
        s.clock = 0;
        this.land(s.toSide);
      }
    } else {
      hand = { x: this.tb.position.x, y: this.tb.position.y - hh };
    }
    if (s.phase !== "fly" && s.phase !== "land") goldLine(this.span.hookLine.clear(), hand, ring, 1, false);
    if (this.rook && this.rookAttached) {
      this.rook.position = { x: this.tb.position.x + (s.toSide === "city" ? -26 : 26), y: this.tb.position.y + 34 };
      this.rook.rotation = (this.tb.position.x - s.from.x) * 0.0006;
    }
  }

  private land(side: SpanSide) {
    const g = this.span.hookLine.clear();
    void g;
    this.swing = null;
    this.tbSide = side;
    const worldFeet = { ...this.tb.position };
    this.attachToSide(this.tb.view, side);
    // Convert back into the side's local frame.
    this.tb.position = side === "ship" ? this.shipLocalOf(worldFeet) : { x: worldFeet.x, y: worldFeet.y };
    if (!this.span.walkable(side, this.tb.position)) this.tb.position = side === "ship" ? { x: 400, y: 432 } : { x: 1030, y: 438 };
    this.tb.setPose("land", { flip: side === "ship" });
    this.tb.velocity = { x: 0, y: 0 };
    this.tbMode = "locked";
    this.cue("deck_land");
    this.shake.add(0.4);
    haptic([40, 20, 20]);
    this.particles.emit("dust", this.worldOf(this.tb.position), { count: 14, speed: 150, spread: Math.PI, angle: -Math.PI / 2 });
    if (this.rook) {
      this.rookAttached = false;
      this.rook.rotation = 0;
      this.attachToSide(this.rook.view, side);
      this.rook.position = side === "ship" ? { x: this.tb.position.x - 64, y: this.tb.position.y + 12 } : { x: this.tb.position.x + 60, y: this.tb.position.y + 12 };
      if (!this.span.walkable(side, this.rook.position)) this.rook.position = { ...this.tb.position };
      this.rookFollow.position = { ...this.rook.position };
      this.rook.play("brace", side === "city" ? "left" : "right");
    }
    window.setTimeout(() => {
      if (this.destroyed) return;
      this.tb.setPose(null);
      this.tb.facing = side === "city" ? "right" : "left";
      if (this.beat === "swing") this.afterCrossing();
      else if (this.beat === "returnSwing" && this.castOffStarted) this.afterReturn();
      else if (this.beat === "returnSwing") this.backAboardTethered();
    }, 520);
  }

  private shipLocalOf(world: Vec): Vec {
    // Inverse of shipToWorld.
    const angle = -(this.span.roll.angle + this.span.shipTurn);
    const p = { x: world.x - this.span.shipShift.x, y: world.y - this.span.shipShift.y };
    const c = SPAN.rollPivot;
    const s = Math.sin(angle);
    const k = Math.cos(angle);
    return { x: c.x + (p.x - c.x) * k - (p.y - c.y) * s, y: c.y + (p.x - c.x) * s + (p.y - c.y) * k };
  }

  // ------------------------------------------------------------------ falling / recoil
  private startFall() {
    this.tbMode = "falling";
    this.tbModeClock = 0;
    this.cast = null;
    this.tb.setPose("jump_air", { flip: this.tbSide === "city" });
    this.cue("fall_gasp");
    haptic(20);
    const rook = this.rook;
    const worldFeet = this.worldOf(this.tb.position);
    const rookWorld = rook ? this.worldOfRook() : null;
    if (rook && !this.rookSaveUsed && !this.rookScripted && rookWorld && len(sub(rookWorld, worldFeet)) < 230 && this.beat === "hold") {
      this.rookSaveUsed = true;
      this.tbMode = "saved";
      this.tbModeClock = 0;
      this.rookScripted = true;
      rook.play("brace", "right");
      this.cue("rook_grab");
    }
  }

  private worldOfRook(): Vec | null {
    if (!this.rook) return null;
    if (this.rook.view.parent === this.span.shipEnd) return this.span.shipToWorld(this.rook.position);
    return this.rook.position;
  }

  private updateFall(dt: number) {
    this.tbModeClock += dt;
    this.tb.offset = { x: 0, y: 0.5 * 1100 * this.tbModeClock * this.tbModeClock };
    this.tb.position = { x: this.tb.position.x + (this.tbSide === "ship" ? 60 : -60) * dt, y: this.tb.position.y };
    if (this.tbModeClock > 0.42) this.startRecoil();
  }

  /** Rook catches her by the satchel strap at the edge, once, and hauls her back. */
  private updateSaved(dt: number) {
    this.tbModeClock += dt;
    const rook = this.rook;
    if (!rook) return;
    const edgeLocal = { x: this.span.dropX("ship", this.tb.position.y) - 6, y: this.tb.position.y };
    if (this.tbModeClock < 0.12) {
      this.tb.offset = { x: 0, y: 0.5 * 1100 * this.tbModeClock * this.tbModeClock };
    } else if (this.tbModeClock < 0.9) {
      const k = (this.tbModeClock - 0.12) / 0.78;
      rook.position = { x: lerp(rook.position.x, edgeLocal.x - 30, Math.min(1, dt * 12)), y: this.tb.position.y + 4 };
      this.tb.setPose("climb_a", { flip: false, rotation: 0.3 });
      this.tb.offset = { x: 0, y: lerp(60, 8, smoothstep(0.45, 1, k)) };
      this.tb.position = { x: edgeLocal.x + 36, y: this.tb.position.y };
      if (Math.abs(this.tbModeClock - 0.3) < dt) {
        this.cue("rook_haul");
        haptic([20, 40, 20]);
      }
    } else {
      this.tb.offset = { x: 0, y: 0 };
      this.tb.position = { x: edgeLocal.x - 46, y: this.tb.position.y };
      this.tb.setPose("land");
      this.tbMode = "stagger";
      this.tbModeClock = -0.2;
      this.external = { x: -160, y: 0 };
      rook.play("idle", "right");
      window.setTimeout(() => {
        this.rookScripted = false;
      }, 400);
    }
  }

  private startRecoil() {
    this.recoilCount += 1;
    this.tbMode = "recoil";
    this.tbModeClock = 0;
    const toShip = this.tbSide === "ship" || this.beat === "castoff";
    const worldFrom = { x: this.worldOf(this.tb.position).x, y: this.worldOf(this.tb.position).y + this.tb.offset.y };
    this.tb.offset = { x: 0, y: 0 };
    // Colour drains from the world, not from her: she and the Line stay in colour.
    this.world.addChildAt(this.tb.view, this.world.getChildIndex(this.span.hookLine));
    this.tb.position = worldFrom;
    const anchorLocal = toShip ? ANCHOR_BOLLARD : { x: 1180, y: 440 };
    this.recoil = { from: worldFrom, clock: 0, anchor: anchorLocal, toShip };
    this.span.root.filters = [this.drain];
    this.cue("cut_pulse");
    this.slowmo = { until: this.time + 0.35, scale: 0.35 };
    if (this.beat === "castoff" && this.rook && !this.rookAttached) {
      // He will not be left behind: he grabs her boot as the Line takes her.
      this.rookAttached = true;
      this.rookScripted = true;
      this.world.addChildAt(this.rook.view, this.world.getChildIndex(this.span.hookLine));
      this.rook.play("dangle", "left");
    }
  }

  private updateRecoil(dt: number) {
    const r = this.recoil;
    if (!r) return;
    r.clock += dt;
    const c = r.clock;
    const anchorWorld = r.toShip ? this.span.shipToWorld(r.anchor) : r.anchor;
    const g = this.span.hookLine.clear();
    // 0-0.28: colour drains, the Cut lights; 0.28: the filament snaps tight; then she is hauled back.
    this.drain.alpha = Math.min(1, c / 0.2) * (c < 1.1 ? 1 : Math.max(0, 1 - (c - 1.1) / 0.4));
    const cut = { x: this.tb.position.x + 8, y: this.tb.position.y - this.tb.height * 0.55 };
    if (c < 0.28) {
      this.tb.position = { x: r.from.x, y: r.from.y + 40 * c };
      this.tb.setPose("jump_air", { rotation: 0.2 });
      if (Math.random() < 0.6) this.particles.emit("ember", cut, { count: 1, speed: 30, life: 0.5, gravity: -60 });
    } else if (c < 0.86) {
      if (c - dt < 0.28) {
        this.cue("recoil_snap");
        this.shake.add(0.55);
        haptic([60, 30, 110]);
        this.particles.emit("spark", cut, { count: 18, speed: 320 });
      }
      const k = (c - 0.28) / 0.58;
      const e = k * k * (3 - 2 * k);
      const mid = { x: lerp(r.from.x, anchorWorld.x, 0.5), y: Math.min(r.from.y, anchorWorld.y) - 190 };
      const a = lerp(r.from.x, mid.x, e);
      const b = lerp(mid.x, anchorWorld.x, e);
      const ay = lerp(r.from.y + 12, mid.y, e);
      const by = lerp(mid.y, anchorWorld.y, e);
      this.tb.position = { x: lerp(a, b, e), y: lerp(ay, by, e) };
      this.tb.setPose("jump_start", { flip: !r.toShip ? false : true, rotation: -0.5 + e * 0.5 });
      goldLine(g, cut, { x: anchorWorld.x, y: anchorWorld.y - 40 }, 1.2, false);
      if (Math.random() < 0.7) this.particles.emit("spark", { x: lerp(cut.x, anchorWorld.x, Math.random()), y: lerp(cut.y, anchorWorld.y - 40, Math.random()) }, { count: 1, speed: 80, life: 0.3 });
    } else {
      if (c - dt < 0.86) {
        this.cue("recoil_crash");
        this.shake.add(0.6);
        haptic([80, 40, 40]);
        this.particles.emit("dust", anchorWorld, { count: 16, speed: 170 });
        this.particles.emit("splinter", anchorWorld, { count: 6, speed: 200 });
        const side: SpanSide = r.toShip ? "ship" : "city";
        this.tbSide = side;
        this.attachToSide(this.tb.view, side);
        this.tb.position = r.toShip ? { x: 214, y: 452 } : { x: r.anchor.x - 34, y: r.anchor.y + 6 };
        this.tb.setPose("land", { flip: !r.toShip });
      }
      if (Math.random() < 0.4) this.particles.emit("smoke", this.worldOf({ x: this.tb.position.x, y: this.tb.position.y - 50 }), { count: 1, speed: 20, life: 1.4, gravity: -50 });
      if (c > 1.7) {
        this.recoil = null;
        this.span.root.filters = [];
        this.tb.setPose(null);
        this.tbMode = "free";
        this.tb.facing = "right";
        if (this.rook && this.rookAttached) {
          this.rookAttached = false;
          this.rook.rotation = 0;
          this.attachToSide(this.rook.view, this.tbSide);
          this.rook.position = { x: this.tb.position.x + 50, y: this.tb.position.y + 10 };
          this.rookFollow.position = { ...this.rook.position };
          this.rook.play("idle", "left");
        }
        if (this.beat === "castoff") {
          this.afterReturn();
        } else if (this.rook) {
          if (!this.said.has("rook-how-was-it")) {
            this.say("rook-how-was-it");
            this.say("tb-short");
          } else if (this.recoilCount === 2) {
            this.say("rook-again");
            this.say("tb-no");
          }
        }
      }
    }
    if (this.rook && this.rookAttached) {
      this.rook.position = { x: this.tb.position.x - 18, y: this.tb.position.y + 48 };
    }
  }

  // ------------------------------------------------------------------ beats on the span
  private updateBeatSpan(dt: number) {
    void dt;
    if (this.beat === "parley" || this.beat === "clamp" || this.beat === "sealed") {
      // The mooring stage belongs to the inspectors until they go.
      const limit = this.beat === "parley" ? 1150 : this.beat === "sealed" && this.pell?.view.visible ? 1040 : 1480;
      if (this.tbSide === "city" && this.tb.position.x > limit) {
        this.tb.position = { x: limit, y: this.tb.position.y };
        this.tb.velocity = { x: 0, y: this.tb.velocity.y };
        if (this.beat === "parley" && !this.parleyLimitWarned) {
          this.parleyLimitWarned = true;
          this.say("rook-wait-here-again");
        }
        if (this.beat === "sealed" && !this.sealedWarned) {
          this.sealedWarned = true;
          this.pell?.setPose("halt");
          this.cue("inspector_shout", { pitch: 1.1 });
        }
      }
    }
    if (this.beat === "clamp") {
      const near = this.tbSide === "city" && len(sub(this.tb.position, CLAMP_POINT)) < 70;
      this.setGlyph(near ? "release" : "release-far", { x: CLAMP_POINT.x, y: CLAMP_POINT.y - 190 });
      if (near && this.actQueued && this.tbMode === "free") this.releaseClamp();
    }
    if (this.beat === "sealed") {
      const near = this.tbSide === "city" && len(sub(this.tb.position, CLAMP_POINT)) < 80;
      this.setGlyph(near ? "sealed" : null, { x: CLAMP_POINT.x, y: CLAMP_POINT.y - 190 });
    }
    if (this.beat === "castoff") this.updateCastOff();
  }

  private afterCrossing() {
    this.options.events.onProgress({ spanCrossed: true });
    this.span.calm = true;
    this.startParleyOrSeal();
  }

  private startParleyOrSeal() {
    const pell = this.pell!;
    const dun = this.dunmore!;
    this.tbMode = "free";
    if (!this.rook) {
      this.setBeat("sealed");
      this.schedule([
        { at: 0.4, run: () => { pell.facing = -1; dun.facing = -1; pell.setPose("halt"); this.cue("inspector_shout"); } },
        { at: 1.4, run: () => { dun.setPose("angry"); this.cue("inspector_shout", { pitch: 0.8 }); } },
        { at: 2.4, run: () => { dun.setPose("idle"); pell.setPose("idle"); pell.walkSpeed = -60; pell.setPose("walk"); } },
        { at: 3.8, run: () => { pell.walkSpeed = 0; pell.setPose("halt"); } },
      ]);
      return;
    }
    const rook = this.rook;
    this.rookScripted = true;
    this.setBeat("parley");
    const R = rook;
    // Rook goes past them and turns back to talk, so we watch his face over their shoulders.
    this.schedule([
      { at: 0.5, run: () => { pell.facing = -1; dun.facing = -1; pell.setPose("halt"); this.cue("inspector_shout"); } },
      { at: 1.0, run: () => { dun.setPose("angry"); this.cue("inspector_shout", { pitch: 0.82, delayMs: 120 }); } },
      { at: 1.6, run: () => { R.play("wait", "left"); this.say("rook-wait-here"); } },
      { at: 2.8, run: () => { dun.setPose("idle"); pell.setPose("idle"); this.walkRookTo({ x: 1352, y: 474 }, () => R.play("talk", "left")); } },
      { at: 4.2, run: () => { pell.facing = 1; } },
      { at: 4.5, run: () => { dun.facing = 1; } },
      { at: 4.8, run: () => { this.murmur("rook", 3.2); pell.setPose("listen"); dun.setPose("listen"); } },
      { at: 6.6, run: () => { pell.setPose("laugh"); this.cue("inspector_laugh"); } },
      { at: 8.2, run: () => { pell.setPose("idle"); R.play("confide", "left"); this.murmur("rook", 1.6); } },
      { at: 9.4, run: () => { dun.setPose("angry"); this.cue("inspector_shout", { pitch: 0.78 }); this.shake.add(0.06); } },
      { at: 10.8, run: () => { dun.setPose("idle"); R.play("letter", "left"); } },
      { at: 12.0, run: () => { this.cue("paper_rustle"); } },
      { at: 12.3, run: () => { dun.setPose("read"); } },
      { at: 13.4, run: () => { pell.setPose("listen"); R.play("idle", "left"); } },
      { at: 15.2, run: () => { dun.setPose("pocket"); this.cue("paper_rustle", { pitch: 0.8 }); } },
      { at: 15.8, run: () => { this.say("inspector-square"); } },
      { at: 17.4, run: () => { dun.setPose("walk"); dun.walkSpeed = 72; this.cue("inspector_steps"); } },
      { at: 17.9, run: () => { pell.setPose("tip"); this.cue("inspector_laugh", { pitch: 1.2 }); } },
      { at: 18.8, run: () => { pell.setPose("walk"); pell.walkSpeed = 84; } },
      { at: 19.6, run: () => { this.walkRookTo({ x: this.tb.position.x + 74, y: this.tb.position.y + 12 }, () => R.play("idle", "left")); } },
      { at: 22.4, run: () => this.say("tb-what-did-you-tell-them") },
      { at: 23.8, run: () => { R.play("shrug", "left"); this.say("rook-nothing-untrue"); } },
      { at: 26.0, run: () => { R.play("point", "right"); this.say("rook-your-turn"); } },
      { at: 27.2, run: () => { this.setBeat("clamp"); this.rookScripted = true; } },
    ]);
  }

  private walkRookTo(target: Vec, then?: () => void) {
    const rook = this.rook;
    if (!rook) return;
    this.rookScripted = true;
    const start = { ...rook.position };
    const distance = len(sub(target, start));
    const speed = 118;
    const duration = Math.max(0.2, distance / speed);
    const facing = facingFor(sub(target, start), rook.facing);
    rook.play("walk", facing);
    rook.setWalkRate(speed, 1);
    let clock = 0;
    const step = () => {
      if (this.destroyed) return;
      clock += Math.min(0.05, this.app.ticker.deltaMS / 1000) * this.timeScale;
      const k = Math.min(1, clock / duration);
      rook.position = { x: lerp(start.x, target.x, k), y: lerp(start.y, target.y, k) };
      if (k >= 1) {
        this.app.ticker.remove(step);
        rook.play("idle", facing);
        then?.();
      }
    };
    this.app.ticker.add(step);
  }

  private murmur(voice: "rook" | "pell" | "dunmore", seconds: number) {
    const count = Math.round(seconds * 3.2);
    for (let i = 0; i < count; i += 1) {
      this.cue(voice === "rook" ? "murmur_rook" : "murmur_inspector", { delayMs: i * 310 + Math.random() * 90, pitch: 0.9 + Math.random() * 0.25 });
    }
  }

  // ------------------------------------------------------------------ cast-off
  /** Turned back at a sealed tether: she is on the ship's end again, and it is still moored. */
  private backAboardTethered() {
    this.setBeat("hold");
    this.tbMode = "free";
    this.span.calm = true;
  }

  private releaseClamp() {
    this.castOffStarted = true;
    this.setBeat("castoff");
    this.tbMode = "locked";
    this.tb.setPose("vault", { flip: false });
    this.setGlyph(null);
    this.cue("clamp_release");
    this.shake.add(0.3);
    haptic([30, 20, 60]);
    this.particles.emit("spark", { x: CLAMP_POINT.x, y: CLAMP_POINT.y - 150 }, { count: 20, speed: 300 });
    this.rookScripted = false;
    this.schedule([
      { at: 0.35, run: () => { this.tb.setPose(null); this.tbMode = "free"; this.cue("tether_run"); } },
      { at: 0.7, run: () => { this.cue("ship_groan", { pitch: 0.7 }); this.shake.add(0.35); } },
      { at: 1.3, run: () => { this.cue("tether_snap"); this.shake.add(0.7); haptic(90); this.flashScreen(0xffffff, 0.3, 0.12); } },
      { at: 1.4, run: () => { this.say("rook-plan"); this.say("tb-yes"); this.say("rook-good"); this.say("tb-go-away-quickly"); } },
      { at: 1.6, run: () => { this.span.beginCollapse(); this.cue("plank_crack"); this.cue("debris_fall", { delayMs: 400 }); } },
    ]);
  }

  private updateCastOff() {
    const t = this.beatClock;
    const d = Math.max(0, t - 0.6);
    // The Wayward pulls away: slowly, then not slowly at all.
    this.span.shipShift = { x: -(14 * d + 7.5 * d * d), y: Math.sin(d * 0.8) * 10 + d * 4 };
    this.span.shipTurn = -Math.min(0.05, d * 0.008);
    this.span.departure = Math.min(1, d / 3.2);
    if (this.span.collapse > 0) {
      const sag = this.span.citySag(this.tb.position.x);
      if (this.tbSide === "city" && this.tbMode === "free" && (this.span.collapse > 5.6 || (sag > 64 && this.tb.position.x < 1010))) {
        // The stage goes out from under her.
        this.startFall();
      }
    }
    if (t > 1.2 && Math.random() < 0.08) this.particles.emit("splinter", { x: 1000 + Math.random() * 300, y: 440 + this.span.citySag(1100) }, { count: 1, speed: 160 });
  }

  private afterReturn() {
    // Aboard. Behind them, the mooring stage goes into the clouds.
    this.tbMode = "locked";
    this.setBeat("toSail");
    this.span.beginCollapse();
    this.options.events.onProgress({ tetherAwake: true, spanCrossed: true });
    this.schedule([
      { at: 0.2, run: () => { this.cue("debris_fall"); } },
      { at: 1.5, run: () => {
        this.cue("wind_rush");
        this.fadeTo(0xf2efe6, 0.7, () => {
          this.enterSail(false);
          this.fadeFrom(0.5);
        });
      } },
    ]);
  }

  // ------------------------------------------------------------------ sail
  private updateSail(dt: number) {
    const c = this.beatClock;
    const sail = this.sail;
    if (sail.awaken < 1 || sail.leaving < 1) {
      // The awakening: seam, then masts and canvas, then the world moving.
      sail.seamRun = Math.max(sail.seamRun, smoothstep(0.9, 1.9, c));
      sail.awaken = Math.max(sail.awaken, smoothstep(1.4, 3.1, c));
      sail.lineRun = Math.max(sail.lineRun, smoothstep(2.6, 4.9, c));
      sail.leaving = Math.max(sail.leaving, smoothstep(2.2, 9.5, c));
      sail.speed = Math.max(sail.speed, smoothstep(2.2, 7, c));
      if (c > 0.9 && c < 1.9 && Math.random() < 0.9) {
        this.particles.emit("spark", sail.seamHead(), { count: 2, speed: 160, life: 0.4 });
        this.particles.emit("ember", sail.seamHead(), { count: 1, speed: 40, life: 0.7, gravity: -40 });
      }
      if (c > 0.35 && c < 1.8) this.shake.add(dt * 0.35);
    }
    sail.update(this.time, dt, this.cam.center);
    if (this.tbMode === "free") this.moveFree(dt, SAIL_MAP, this.sail.depthScale(this.tb.position.y));
    this.tb.update(dt);
    this.tb.present(this.sail.depthScale(this.tb.position.y));
    this.tb.view.zIndex = this.tb.position.y;
    if (this.rook) {
      this.rook.update(dt);
      this.presentRook(this.sail.depthScale(this.rook.position.y));
      this.rook.view.zIndex = this.rook.position.y;
    }
    if (sail.leaving > 0.1 && Math.random() < 0.35 * sail.speed) {
      this.particles.emit("streak", { x: this.cam.center.x + 320, y: this.cam.center.y - 260 + Math.random() * 560 }, { count: 1, speed: 760, angle: Math.PI * 0.97, spread: 0.05, life: 0.9, gravity: 0, alpha: 0.45 });
    }
    // The last exchange, once she has had a moment with it: at the bow, or after a while.
    if (!this.finaleSaid && this.rook && c > 7 && (c > 17 || len(sub(this.tb.position, this.rook.position)) < 110)) {
      this.finaleSaid = true;
      this.say("tb-where-is-she-taking-us");
      this.say("rook-i-dont-know");
      this.say("rook-i-like-it");
      const wait = (["tb-where-is-she-taking-us", "rook-i-dont-know", "rook-i-like-it"] as LineId[]).reduce((sum, id) => sum + lineSeconds(id), 0);
      this.schedule([{ at: c + wait + 1.6, run: () => this.options.events.onSailing() }]);
    }
  }

  // ------------------------------------------------------------------ shared movement
  private moveFree(dt: number, map: OverworldMapDefinition, depth: number) {
    if (this.tbMode !== "free") {
      this.tb.moving = false;
      return;
    }
    const analog = remapAnalogInput(this.input.x, this.input.y);
    this.tb.velocity = stepVelocity(this.tb.velocity, analog, dt);
    const scale = lerp(0.7, 1, (depth - 0.6) / 0.45);
    const step = { x: this.tb.velocity.x * dt * scale, y: this.tb.velocity.y * dt * scale * 0.8 };
    const p = this.tb.position;
    const next = moveWithCollision(map, p, step, 6);
    if (next.x === p.x && next.y === p.y && (step.x || step.y)) this.tb.velocity = { x: 0, y: 0 };
    this.tb.position = next;
    const speed = Math.hypot(this.tb.velocity.x, this.tb.velocity.y);
    this.tb.moving = speed > 8;
    if (this.tb.moving) {
      const v = this.tb.velocity;
      this.tb.facing = Math.abs(v.x) > Math.abs(v.y) ? (v.x < 0 ? "left" : "right") : v.y < 0 ? "back" : "front";
    }
  }

  private updateRookFollow(dt: number, walkable: (p: Vec) => boolean, tuning: typeof DECK_FOLLOW, depthAt: (y: number) => number) {
    const rook = this.rook;
    if (!rook) return;
    if (!this.rookScripted) {
      const speed = Math.hypot(this.tb.velocity.x, this.tb.velocity.y);
      const before = this.rookFollow.position;
      this.rookFollow = stepFollow({ ...this.rookFollow, position: rook.position }, this.tb.position, this.tb.facing, speed, dt, tuning, walkable);
      rook.position = this.rookFollow.position;
      const moved = len(sub(rook.position, before)) / Math.max(dt, 1e-4);
      const busy = (rook.state === "brace" || rook.state === "point") && !rook.isDone;
      if (!busy) {
        if (this.rookFollow.moving) {
          rook.play("walk", this.rookFollow.facing);
          rook.setWalkRate(moved, depthAt(rook.position.y));
        } else {
          rook.play("idle", this.rookFollow.facing);
        }
      }
      if (!this.rookSeen) this.rookSeen = true;
    }
    rook.update(dt);
    this.presentRook(depthAt(rook.position.y));
    rook.view.zIndex = rook.position.y - 0.5;
  }

  private presentRook(depth: number) {
    this.rook?.present(depth, !this.rookAttached);
  }

  // ------------------------------------------------------------------ camera
  private updateCamera(dt: number) {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    let zoom: number;
    let target: Vec;
    if (this.stage === "deck") {
      const intro = this.beat === "deck" ? 1 - smoothstep(0.3, 3.2, this.beatClock) : 0;
      zoom = (sh / 658) * (1.02 + intro * 0.3);
      const visibleW = sw / zoom;
      const visibleH = sh / zoom;
      const settled = 658 - visibleH / 2;
      target = {
        x: clamp(this.tb.position.x + this.tb.velocity.x * 0.18, visibleW / 2, 1536 - visibleW / 2),
        y: lerp(Math.min(329, settled), visibleH / 2 - 20, intro),
      };
    } else if (this.stage === "span") {
      const b = this.beat;
      const frame = b === "swing" || b === "returnSwing" ? 560 : b === "parley" || b === "sealed" ? 470 : b === "clamp" ? 480 : b === "castoff" || b === "toSail" ? 640 : 520;
      this.cam.frame = this.cam.frame ? lerp(this.cam.frame, frame, 1 - Math.pow(0.02, dt)) : frame;
      zoom = sw / this.cam.frame;
      const visibleH = sh / zoom;
      const feet = this.worldOf(this.tb.position);
      let x = feet.x + this.tb.velocity.x * 0.2;
      if (b === "hold" && this.tbSide === "ship") {
        // Keep her in the left third and the ring in frame: the question is always visible.
        x = Math.max(feet.x + this.cam.frame * 0.16, this.span.ringAt.x - this.cam.frame * 0.36);
      }
      if (b === "parley" || b === "sealed") x = 1188;
      if (b === "clamp") x = lerp(feet.x, CLAMP_POINT.x, 0.4);
      if (b === "castoff") x = lerp(feet.x, this.span.ringAt.x, 0.42);
      if (b === "toSail") x = this.span.shipToWorld({ x: 400, y: 430 }).x + 80;
      const deckLine = 432;
      target = { x, y: deckLine - visibleH * 0.08 };
      if (this.tbMode === "traverse" || this.tbMode === "recoil") target = { x: feet.x, y: Math.min(deckLine - visibleH * 0.08, feet.y - visibleH * 0.1) };
    } else {
      const c = this.beatClock;
      zoom = (sh / 658) * 1.03;
      const visibleW = sw / zoom;
      const visibleH = sh / zoom;
      const follow = { x: clamp(this.tb.position.x, visibleW / 2 - 40, 1536 - visibleW / 2 + 40), y: Math.min(329, 658 - visibleH / 2) };
      // As the canvas drops, the camera looks up at it — then comes back down to her.
      const look = this.sail.leaving >= 1 && this.finaleSaid ? 0 : smoothstep(1.3, 2.1, c) * (1 - smoothstep(3.6, 4.8, c));
      target = { x: lerp(follow.x, 470, look), y: lerp(follow.y, visibleH / 2 - 40, look) };
      zoom *= lerp(1, 0.94, look);
    }
    this.camTarget = target;
    const ease = this.reducedMotion ? 1 : 1 - Math.pow(0.004, dt);
    this.cam.center = { x: lerp(this.cam.center.x, target.x, ease), y: lerp(this.cam.center.y, target.y, ease) };
    this.cam.zoom = zoom;
    this.cam.punch = Math.max(0, this.cam.punch - dt * 0.35);
    const s = this.shake.update(dt, this.reducedMotion);
    const z = zoom * (1 + this.cam.punch);
    this.world.pivot.set(this.cam.center.x, this.cam.center.y);
    this.world.position.set(sw / 2 + s.x, sh / 2 + s.y);
    this.world.scale.set(z);
    this.world.rotation = s.rotation + (this.stage === "deck" ? Math.sin(this.time * 0.6) * 0.004 : 0);
  }

  private resize() {
    if (!this.app.renderer) return;
    const b = this.options.host.getBoundingClientRect();
    const w = Math.max(1, Math.round(b.width));
    const h = Math.max(1, Math.round(b.height));
    if (this.app.screen.width !== w || this.app.screen.height !== h) this.app.renderer.resize(w, h);
  }

  // ------------------------------------------------------------------ screen fx
  private fade = { alpha: 0, target: 0, speed: 1, color: 0xffffff, done: null as null | (() => void) };
  private flashState = { alpha: 0, decay: 1, color: 0xffffff };

  private fadeTo(color: number, seconds: number, done: () => void) {
    this.fade = { alpha: this.fade.alpha, target: 1, speed: 1 / seconds, color, done };
  }

  private fadeFrom(seconds: number) {
    this.fade = { ...this.fade, alpha: 1, target: 0, speed: 1 / seconds, done: null };
  }

  private flashScreen(color: number, alpha: number, seconds: number) {
    this.flashState = { alpha, decay: alpha / seconds, color };
  }

  private updateScreen(dt: number) {
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const f = this.fade;
    if (f.alpha !== f.target) {
      f.alpha = f.target > f.alpha ? Math.min(f.target, f.alpha + f.speed * dt) : Math.max(f.target, f.alpha - f.speed * dt);
      if (f.alpha === f.target && f.done) {
        const done = f.done;
        f.done = null;
        done();
      }
    }
    this.flashState.alpha = Math.max(0, this.flashState.alpha - this.flashState.decay * dt);
    const g = this.flash.clear();
    if (f.alpha > 0.001) g.rect(0, 0, sw, sh).fill({ color: f.color, alpha: f.alpha });
    if (this.flashState.alpha > 0.001) g.rect(0, 0, sw, sh).fill({ color: this.flashState.color, alpha: this.flashState.alpha });
    // Letterbox for the beats that are staged: control stays with the player.
    const staged = this.beat === "parley" || this.beat === "castoff" || this.beat === "toSail" || (this.beat === "sail" && this.beatClock < 3);
    this.letterboxAmount = lerp(this.letterboxAmount, staged ? 1 : 0, 1 - Math.pow(0.02, dt));
    const bar = sh * 0.075 * this.letterboxAmount;
    const lb = this.letterbox.clear();
    if (bar > 0.5) lb.rect(0, 0, sw, bar).fill(0x050608).rect(0, sh - bar, sw, bar).fill(0x050608);
    this.updateGlyph();
  }
  private letterboxAmount = 0;

  // ------------------------------------------------------------------ in-world glyph
  private glyphKind: string | null = null;
  private glyphAt: Vec = { x: 0, y: 0 };

  private setGlyph(kind: string | null, at?: Vec) {
    this.glyphKind = kind;
    if (at) this.glyphAt = at;
  }

  private updateGlyph() {
    const g = this.glyphRing.clear();
    const kind = this.glyphKind;
    if (!kind) return;
    const t = this.time;
    const k = 1 / Math.max(0.2, this.cam.zoom);
    this.glyph.position.set(this.glyphAt.x, this.glyphAt.y + Math.sin(t * 3) * 3 * k);
    this.glyph.scale.set(k);
    const pulse = 0.7 + Math.sin(t * 6) * 0.3;
    if (kind === "cast") {
      g.circle(0, 0, 15).stroke({ color: 0xffe08a, width: 3, alpha: pulse });
      g.circle(0, 0, 22).stroke({ color: 0xffc85a, width: 1.5, alpha: 0.4 * pulse });
      g.moveTo(-5, 6).lineTo(0, -6).lineTo(5, 6).stroke({ color: 0xfff1c2, width: 2.5 });
    } else if (kind === "blocked") {
      g.circle(0, 0, 13).stroke({ color: 0xff8a4a, width: 2.5, alpha: 0.8 });
      g.moveTo(-6, -6).lineTo(6, 6).stroke({ color: 0xff8a4a, width: 2.5 });
    } else if (kind === "search" || kind === "release") {
      g.circle(0, 0, 16).fill({ color: 0x120c06, alpha: 0.55 }).stroke({ color: 0xffe08a, width: 2.5, alpha: pulse });
      g.circle(0, 0, 5).fill({ color: 0xfff1c2, alpha: pulse });
    } else if (kind === "release-far") {
      g.circle(0, 0, 9).stroke({ color: 0xffe08a, width: 2, alpha: 0.35 + 0.25 * pulse });
    } else if (kind === "sealed") {
      g.roundRect(-18, -12, 36, 24, 4).fill({ color: 0x5b1510, alpha: 0.9 }).stroke({ color: 0xd8a24c, width: 2 });
      g.circle(0, 0, 5).fill({ color: 0xd8a24c });
    }
  }

  // ------------------------------------------------------------------ captions
  private say(id: LineId) {
    if (this.said.has(id) && !id.endsWith("-again")) return;
    this.said.add(id);
    const at = Math.max(this.time, this.captionUntil, ...this.captionQueue.map(item => item.at + lineSeconds(item.line)));
    this.captionQueue.push({ line: id, at });
  }

  private updateCaptions() {
    const now = this.time;
    const current = this.captionQueue[0];
    if (!current) {
      if (this.captionUntil && now > this.captionUntil) {
        this.captionUntil = 0;
        this.options.events.onCaption(null);
      }
      return;
    }
    if (now >= current.at) {
      this.captionQueue.shift();
      const line = LINES[current.line];
      this.options.events.onCaption({ id: current.line, speaker: line.speaker, text: line.text });
      this.captionUntil = now + lineSeconds(current.line);
      this.cue(line.speaker === "ROOK" ? "caption_rook" : "caption_tick");
      if (this.rook && line.speaker === "ROOK" && !this.rookScripted && !this.rookAttached && this.rook.state !== "walk") {
        this.rook.play("talk", this.rook.facing);
        window.setTimeout(() => {
          if (this.rook?.state === "talk" && !this.rookScripted) this.rook.play("idle", this.rook.facing);
        }, lineSeconds(current.line) * 1000 * 0.8);
      }
    }
  }

  // ------------------------------------------------------------------ sound
  private cue(cue: AudioCueId, options?: PlayOptions) {
    try {
      getAudioManager().play(cue, options);
    } catch {
      // Sound is never load-bearing.
    }
  }

  private footstep(gain: number, pitch = 1) {
    if (this.time - this.lastStepSound < 0.09) return;
    this.lastStepSound = this.time;
    this.cue("deck_step", { pitch: pitch * (0.92 + Math.random() * 0.16) });
    void gain;
  }

  private ambience(dt: number) {
    this.windClock -= dt;
    if (this.windClock <= 0) {
      const strong = this.stage === "sail" || this.beat === "castoff";
      this.cue(strong ? "wind_gust" : "wayward_wind", { pitch: 0.85 + Math.random() * 0.3 });
      this.windClock = strong ? 1.1 + Math.random() * 0.6 : 1.9 + Math.random() * 0.9;
    }
    this.creakClock -= dt;
    if (this.creakClock <= 0) {
      this.cue("timber_creak", { pitch: 0.8 + Math.random() * 0.4 });
      this.creakClock = 3 + Math.random() * 4;
    }
  }

  // ------------------------------------------------------------------ test api
  private installTestApi() {
    (window as unknown as { __wayward?: unknown }).__wayward = {
      state: () => ({
        stage: this.stage,
        beat: this.beat,
        beatClock: this.beatClock,
        mode: this.tbMode,
        side: this.tbSide,
        tb: { ...this.tb.position },
        tbWorld: this.stage === "span" ? this.worldOf(this.tb.position) : { ...this.tb.position },
        rook: this.rook ? { ...this.rook.position, state: this.rook.state, facing: this.rook.facing } : null,
        aim: this.aim ? { inRange: this.aim.inRange, clear: this.aim.clear, distance: Math.round(this.aim.distance), blockedBy: this.aim.blockedBy?.id ?? null } : null,
        ring: { ...this.span.ringAt },
        roll: this.span.roll,
        fouls: this.fouls,
        recoils: this.recoilCount,
        said: [...this.said],
        time: this.time,
        fps: Math.round(this.app.ticker.FPS),
      }),
      setTimeScale: (scale: number) => {
        this.timeScale = scale;
      },
      teleport: (x: number, y: number) => {
        this.tb.position = { x, y };
      },
      forceFall: () => {
        this.rookSaveUsed = true;
        this.startFall();
      },
      act: () => this.act(),
      setMove: (x: number, y: number) => this.setMove(x, y),
      skipTo: (beat: "span" | "parley" | "castoff" | "sail") => {
        if (beat === "span") this.enterSpan(true);
        else if (beat === "parley") this.enterSpanFromSave();
        else if (beat === "sail") this.enterSail(false);
        else if (beat === "castoff") {
          this.enterSpanFromSave();
          this.scriptSteps = [];
          this.pell!.view.visible = false;
          this.dunmore!.view.visible = false;
          this.tb.position = { ...CLAMP_POINT, x: CLAMP_POINT.x - 20 };
          this.releaseClamp();
        }
      },
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.resizeObserver?.disconnect();
    try {
      this.app.ticker?.remove(this.tick);
    } catch {
      // not started
    }
    delete (window as unknown as { __wayward?: unknown }).__wayward;
    try {
      this.app.destroy(true, { children: true });
    } catch {
      // init never finished
    }
  }
}

function lineSeconds(id: LineId) {
  const text = LINES[id].text;
  return Math.max(0.95, 0.6 + text.length * 0.052);
}

function goldLine(g: Graphics, a: Vec, b: Vec, strength: number, slack: boolean) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (slack ? 26 : 0) };
  g.moveTo(a.x, a.y).quadraticCurveTo(mid.x, mid.y, b.x, b.y).stroke({ color: 0xffb640, width: 9, alpha: 0.18 * strength });
  g.moveTo(a.x, a.y).quadraticCurveTo(mid.x, mid.y, b.x, b.y).stroke({ color: 0xffe08a, width: 3, alpha: 0.9 * Math.min(1, strength) });
  g.moveTo(a.x, a.y).quadraticCurveTo(mid.x, mid.y, b.x, b.y).stroke({ color: 0xffffff, width: 1, alpha: 0.8 * Math.min(1, strength) });
}

function dashed(g: Graphics, a: Vec, b: Vec, dash: number, gap: number, style: { color: number; width: number; alpha: number }) {
  const d = sub(b, a);
  const L = len(d);
  if (L < 1) return;
  const ux = d.x / L;
  const uy = d.y / L;
  for (let s = 0; s < L; s += dash + gap) {
    const e = Math.min(L, s + dash);
    g.moveTo(a.x + ux * s, a.y + uy * s).lineTo(a.x + ux * e, a.y + uy * e);
  }
  g.stroke(style);
}

export { Sprite };
