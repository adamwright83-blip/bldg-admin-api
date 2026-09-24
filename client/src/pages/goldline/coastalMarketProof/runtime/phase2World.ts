import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MeshBVH } from "three-mesh-bvh";
import type { PlayerController } from "./controller";
import type { ChaseRigs, LevelData, Route, SwingRig } from "./level";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createLevelMaterial, patchDynamicSunVis, type MaterialContext } from "./materials";

/**
 * The Rook Hunt chase set.
 *
 * One tension rule, used three ways: a line under load becomes her lift. She
 * hooks it, the load is let go, and the rig carries her. Nothing teleports:
 * every rig moves a hook along its own mechanism (a slewing crane jib, a boom
 * swinging on its post, a carrier on the ropeway's haul rope), she hangs from
 * that hook on a simulated pendulum, and on release she flies on the velocity
 * the rig gave her onto real floor.
 *
 *   RIDE      the quay crane's counterweight drops; the jib slews her up to the stair landing
 *   RELEASE   the gorge boom's tie-back lets go; the boom swings her past the raised bridge leaves
 *   TRANSFER  she catches a passing ropeway carrier and rides the span to the terrace
 *
 * The shutdown is one wave uphill: the harbour gate drops, the bridge leaves
 * rise, the market gate drops. Rook's cage leaves the harbour station when the
 * chase begins and docks at the terrace, where the reveal plays.
 *
 * Rook is the approved mesh. His motion is his own rig's deformation, baked in
 * Blender to morph targets (build_rook_runtime.py): no hop, flight, mirror or
 * whole-body transform trick.
 */
type Beat = "approach" | "shutdown" | "ride" | "release" | "transfer" | "reveal";
type RigId = "ride" | "release" | "transfer";

export type RookMeta = { height: number; keys: string[]; wingTip: Record<string, [number, number, number]> };

export type CameraDirective = { weight: number; position: THREE.Vector3; target: THREE.Vector3; fov: number; collide: boolean } | null;

export type AutopilotHint = { target?: THREE.Vector3; stop?: boolean; mag?: number; jump?: boolean };

const HANG = 2.08;          // hands on the hook to her root (feet)
const PENDULUM = 1.9;       // hook to her centre of mass
const RIDE_TIME = 3.4;
const RELEASE_TIME = 2.35;
const GRAB_DELAY = 0.3;     // the brake / tie-back lets go a beat after she takes the weight
const TRAILBLAZER_HEIGHT = 1.775;
const ROOK_RATIO = 0.62;    // Rook's height relative to Trailblazer's, as main's Wayward stages him

const up = new THREE.Vector3(0, 1, 0);
const v3 = (a: [number, number, number]) => new THREE.Vector3(a[0], a[1], a[2]);
const ease = (u: number) => u * u * (3 - 2 * u);
/** the counterweight falls: accelerate, then the brake catches it */
const drop = (u: number) => (u < 0.72 ? 0.62 * (u / 0.72) ** 2 : 0.62 + 0.38 * ease((u - 0.72) / 0.28));
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * t;
};
const angleFrac = (a0: number, a1: number, a: number) => {
  const total = Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)));
  return total > 1e-3 ? Math.abs(Math.atan2(Math.sin(a - a0), Math.cos(a - a0))) / total : 0;
};

/** A body hanging from a moving hook: small-angle pendulum driven by the hook's acceleration. */
class Pendulum {
  readonly off = new THREE.Vector2();
  readonly vel = new THREE.Vector2();
  private readonly prevHook = new THREE.Vector3();
  private readonly hookVel = new THREE.Vector3();
  private primed = false;

  reset(hook: THREE.Vector3, body: THREE.Vector3, bodyVel: THREE.Vector3) {
    this.off.set(body.x - hook.x, body.z - hook.z).clampLength(0, 1.1);
    this.vel.set(bodyVel.x, bodyVel.z).clampLength(0, 3);
    this.prevHook.copy(hook);
    this.hookVel.set(0, 0, 0);
    this.primed = false;
  }

  step(hook: THREE.Vector3, dt: number, out: THREE.Vector3): THREE.Vector3 {
    const vx = (hook.x - this.prevHook.x) / dt;
    const vz = (hook.z - this.prevHook.z) / dt;
    const ax = this.primed ? THREE.MathUtils.clamp((vx - this.hookVel.x) / dt, -40, 40) : 0;
    const az = this.primed ? THREE.MathUtils.clamp((vz - this.hookVel.z) / dt, -40, 40) : 0;
    this.hookVel.set(vx, (hook.y - this.prevHook.y) / dt, vz);
    this.prevHook.copy(hook);
    this.primed = true;
    const k = 9.81 / PENDULUM;
    this.vel.x += (-k * this.off.x - ax - 1.3 * this.vel.x) * dt;
    this.vel.y += (-k * this.off.y - az - 1.3 * this.vel.y) * dt;
    this.off.x += this.vel.x * dt;
    this.off.y += this.vel.y * dt;
    if (this.off.length() > 1.25) {
      this.off.setLength(1.25);
      this.vel.multiplyScalar(0.5);
    }
    const lift = this.off.lengthSq() / (2 * PENDULUM);
    return out.set(hook.x + this.off.x, hook.y - HANG + lift, hook.z + this.off.y);
  }

  /** world velocity of the body (hook velocity + swing) */
  velocity(out: THREE.Vector3) {
    return out.set(this.hookVel.x + this.vel.x, this.hookVel.y, this.hookVel.z + this.vel.y);
  }
}

/** Ropes and chains between two points: one shared unit cylinder, scaled per rope. */
class Ropes {
  private readonly geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
  constructor(private readonly parent: THREE.Object3D) {}
  add(material: THREE.Material, radius: number) {
    const m = new THREE.Mesh(this.geo, material);
    m.userData.r = radius;
    m.castShadow = true;
    m.frustumCulled = false;
    this.parent.add(m);
    return m;
  }
  static set(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) {
    const d = tmpD.subVectors(b, a);
    const len = d.length();
    m.position.copy(a);
    m.quaternion.setFromUnitVectors(up, len > 1e-5 ? d.divideScalar(len) : up);
    m.scale.set(m.userData.r, Math.max(1e-3, len), m.userData.r);
  }
  dispose() {
    this.geo.dispose();
  }
}
const tmpD = new THREE.Vector3();

/** The ropeway loop: haul rope uphill (landward), return rope downhill, bullwheels at both stations. */
class RopewayPath {
  readonly pts: THREE.Vector3[] = [];
  readonly cum: number[] = [];
  readonly length: number;
  /** loop parameter where the haul rope reaches the terrace station's bullwheel */
  readonly haulEnd: number;
  constructor(rw: ChaseRigs["ropeway"]) {
    const heads = rw.heads.map(v3);
    const land = rw.land.map(v3);
    const side = (i: number, s: number) => heads[i].clone().addScaledVector(land[i], rw.offset * s);
    const span = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
      const n = Math.max(8, Math.ceil(a.distanceTo(b) / 0.6));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const p = a.clone().lerp(b, t);
        p.y -= sag * 4 * t * (1 - t);
        this.pts.push(p);
      }
    };
    const wheel = (c: THREE.Vector3, from: THREE.Vector3, to: THREE.Vector3) => {
      const a0 = Math.atan2(from.z - c.z, from.x - c.x);
      let a1 = Math.atan2(to.z - c.z, to.x - c.x);
      if (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
      if (a0 - a1 > Math.PI) a1 += Math.PI * 2;
      const r = Math.hypot(from.x - c.x, from.z - c.z);
      for (let i = 0; i < 10; i++) {
        const a = a0 + (a1 - a0) * (i / 10);
        this.pts.push(new THREE.Vector3(c.x + Math.cos(a) * r, from.y, c.z + Math.sin(a) * r));
      }
    };
    for (let i = 0; i < heads.length - 1; i++) span(side(i, 1), side(i + 1, 1), rw.sags[i]);
    const haulEndIndex = this.pts.length;
    wheel(heads[heads.length - 1], side(heads.length - 1, 1), side(heads.length - 1, -1));
    for (let i = heads.length - 1; i > 0; i--) span(side(i, -1), side(i - 1, -1), rw.sags[i - 1]);
    wheel(heads[0], side(0, -1), side(0, 1));
    let s = 0;
    for (let i = 0; i < this.pts.length; i++) {
      if (i) s += this.pts[i].distanceTo(this.pts[i - 1]);
      this.cum.push(s);
    }
    this.length = s + this.pts[this.pts.length - 1].distanceTo(this.pts[0]);
    this.haulEnd = this.cum[haulEndIndex];
  }

  at(u: number, out: THREE.Vector3, tangent?: THREE.Vector3) {
    u = ((u % this.length) + this.length) % this.length;
    let lo = 0;
    let hi = this.cum.length - 1;
    if (u >= this.cum[hi]) {
      const a = this.pts[hi];
      const b = this.pts[0];
      const t = (u - this.cum[hi]) / Math.max(1e-6, this.length - this.cum[hi]);
      if (tangent) tangent.subVectors(b, a).normalize();
      return out.copy(a).lerp(b, t);
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= u) lo = mid;
      else hi = mid;
    }
    const t = (u - this.cum[lo]) / Math.max(1e-6, this.cum[hi] - this.cum[lo]);
    if (tangent) tangent.subVectors(this.pts[hi], this.pts[lo]).normalize();
    return out.copy(this.pts[lo]).lerp(this.pts[hi], t);
  }

  /** loop parameter of the haul-rope point nearest `p` */
  nearestHaul(p: THREE.Vector3) {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.pts.length && this.cum[i] <= this.haulEnd; i++) {
      const d = this.pts[i].distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = this.cum[i];
      }
    }
    return best;
  }
}

type Line = {
  id: "ride" | "release";
  rig: SwingRig;
  group: THREE.Group;
  part: THREE.Object3D;
  tipLocal: THREE.Vector3;
  hook: THREE.Object3D;
  hookRope: THREE.Mesh;
  yaw: number;
  hoist: number;
};

type Gate = { obj: THREE.Object3D; base: THREE.Vector3; y: number; vy: number; down: boolean; trigger: number; block: [number, number] };
type Leaf = { outer: THREE.Group; inner: THREE.Group; angle: number; chains: THREE.Mesh[]; tip: THREE.Vector3; gantry: THREE.Vector3; across: THREE.Vector3; half: number };

export class Phase2World {
  readonly group = new THREE.Group();
  readonly contactShadow: THREE.Mesh;
  readonly state = {
    beat: "approach" as Beat,
    shutdown: 0,
    tensionUse: 0,
    reveal: false,
    revealTime: 0,
    caption: "",
    speaker: "",
    stamp: "",
    lineReady: false,
    cageDocked: false,
    active: null as RigId | null,
    chaseTime: -1,
  };
  /** 0..1: how far her arms are raised to a hook (the runtime poses them) */
  handsUp = 0;
  readonly handTarget = new THREE.Vector3();
  /** her swing on the line (horizontal offset of her body from the grip, metres) */
  get swing() {
    return this.pend.off;
  }
  /** play the opening cage sighting (off for QA starts part-way along the route) */
  intro = true;
  /** one-shot sound cues this frame */
  readonly events: string[] = [];

  private readonly rigs: ChaseRigs;
  private readonly route: Route;
  private readonly ropes: Ropes;
  private readonly mats = new Map<string, THREE.Material>();
  private readonly ctx: MaterialContext;
  private readonly lines: Record<"ride" | "release", Line>;
  private readonly counterweight: THREE.Object3D;
  private readonly cwRope: THREE.Mesh;
  private readonly tieBack: THREE.Mesh;
  private readonly gates: Gate[] = [];
  private readonly leaves: Leaf[] = [];
  private readonly ropeway: RopewayPath;
  private readonly carriers: THREE.Object3D[] = [];
  private readonly cage = new THREE.Group();
  private readonly cageDoor = new THREE.Group();
  private readonly cageLamp: THREE.PointLight;
  private readonly cageSun = { value: 1 };
  private cageU = 0;
  private cageDockT = -1;
  private cageFrom = new THREE.Vector3();
  private cageFromYaw = 0;
  private chaseTime = -1;
  private readonly pend = new Pendulum();
  private active: { id: RigId; t: number; carrier?: number; landU?: number } | null = null;
  private readonly used = new Set<RigId>();
  private stampTimer = 0;
  private readonly walk: MeshBVH;
  private readonly heroSunVis: { value: number };
  // Rook
  private rook?: THREE.Object3D;
  private rookMesh?: THREE.Mesh;
  private readonly rookMeta?: RookMeta;
  private readonly satchel: THREE.Object3D;
  private readonly dispatchChain: THREE.Mesh;
  private readonly dispatchHook: THREE.Object3D;
  private satchelHeld = false;
  private readonly hookSeat = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly tmpT = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly camDirective = { weight: 0, position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 50, collide: true };
  private readonly down = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  private lastRig: RigId | null = null;
  private sinceRig = 99;
  private rigCamW = 0;
  private readonly rigCamPos = new THREE.Vector3();
  private readonly rigCamTarget = new THREE.Vector3();
  private rigCamPrimed = false;

  constructor(opts: {
    scene: THREE.Scene;
    route: Route;
    data: LevelData;
    rigs: GLTF;
    rook?: GLTF;
    rookMeta?: RookMeta;
    ctx: MaterialContext;
    walk: MeshBVH;
    sunVis: { value: number };
  }) {
    const { scene, route, data } = opts;
    this.route = route;
    this.rigs = data.rigs;
    this.ctx = opts.ctx;
    this.rookMeta = opts.rookMeta;
    this.walk = opts.walk;
    this.heroSunVis = opts.sunVis;
    this.group.name = "rook-hunt-chase";
    scene.add(this.group);
    this.ropes = new Ropes(this.group);
    const part = (name: string) => {
      const src = opts.rigs.scene.getObjectByName(`RIG_${name}`);
      if (!src) throw new Error(`rigs.glb has no ${name}`);
      const obj = src.clone(true);
      obj.position.set(0, 0, 0);
      obj.rotation.set(0, 0, 0);
      obj.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = this.material((m.material as THREE.Material).name, m.geometry);
        m.castShadow = true;
        m.receiveShadow = true;
      });
      return obj;
    };
    const rope = this.material("rope");
    const iron = this.material("iron");

    // ---------- RIDE: the quay crane
    const crane = this.rigs.crane;
    const jib = new THREE.Group();
    jib.position.copy(v3(crane.pivot));
    const jibPart = part("crane_jib");
    jib.add(jibPart);
    this.group.add(jib);
    const craneHook = part("hook");
    this.group.add(craneHook);
    this.counterweight = part("counterweight");
    this.group.add(this.counterweight);
    this.cwRope = this.ropes.add(rope, 0.035);
    // ---------- RELEASE: the gorge boom
    const boomRig = this.rigs.boom;
    const boom = new THREE.Group();
    boom.position.copy(v3(boomRig.pivot));
    const boomPart = part("boom");
    boom.add(boomPart);
    this.group.add(boom);
    const boomHook = part("hook");
    this.group.add(boomHook);
    this.tieBack = this.ropes.add(rope, 0.03);
    this.lines = {
      ride: { id: "ride", rig: crane, group: jib, part: jibPart, tipLocal: v3(data.rigParts.crane_jib.tip), hook: craneHook, hookRope: this.ropes.add(rope, 0.03), yaw: crane.yaw0, hoist: 0 },
      release: { id: "release", rig: boomRig, group: boom, part: boomPart, tipLocal: v3(data.rigParts.boom.tip), hook: boomHook, hookRope: this.ropes.add(rope, 0.03), yaw: boomRig.yaw0, hoist: 0 },
    };

    // ---------- gates: the shutdown drops them
    for (const [key, trigger] of [["gate1", 3.0], ["gate3", 128]] as const) {
      const g = this.rigs[key];
      const obj = part(key);
      const f = v3(g.fwd);
      obj.rotation.y = Math.atan2(-f.z, f.x);
      const base = v3(g.pos);
      this.group.add(obj);
      this.gates.push({ obj, base, y: 3.3, vy: 0, down: false, trigger, block: g.block });
    }
    // ---------- bridge leaves: raised by the shutdown
    for (const lf of this.rigs.bridge.leaves) {
      const outer = new THREE.Group();
      outer.position.copy(v3(lf.hinge));
      const d = v3(lf.dir);
      outer.rotation.y = Math.atan2(-d.z, d.x);
      const inner = new THREE.Group();
      inner.add(part("leaf"));
      outer.add(inner);
      this.group.add(outer);
      const across = new THREE.Vector3(-d.z, 0, d.x).normalize();
      this.leaves.push({ outer, inner, angle: 0, chains: [this.ropes.add(iron, 0.03), this.ropes.add(iron, 0.03)], tip: v3(data.rigParts.leaf.tipLocal), gantry: v3(lf.gantryTop), across, half: lf.gantryHalf });
    }

    // ---------- ropeway carriers and Rook's cage on the haul rope
    this.ropeway = new RopewayPath(this.rigs.ropeway);
    const carrierSrc = part("carrier");
    const n = Math.floor(this.ropeway.length / this.rigs.ropeway.spacing);
    for (let i = 0; i < n; i++) {
      const c = i === 0 ? carrierSrc : carrierSrc.clone(true);
      c.userData.phase = (i * this.ropeway.length) / n;
      c.userData.u = c.userData.phase;
      this.group.add(c);
      this.carriers.push(c);
    }
    this.cage.add(part("cage"));
    this.cageDoor.position.copy(v3(data.rigParts.cage.doorHinge));
    this.cageDoor.add(part("cage_door"));
    this.cage.add(this.cageDoor);
    this.cageLamp = new THREE.PointLight(0xffa447, 4.5, 7, 1.6);
    this.cageLamp.position.copy(v3(data.rigParts.cage.lamp));
    this.cage.add(this.cageLamp);
    const rw = this.rigs.ropeway;
    this.cageU = this.ropeway.nearestHaul(v3(rw.heads[0]).addScaledVector(v3(rw.land[0]), rw.offset));
    this.group.add(this.cage);

    // ---------- Rook in the cage; the sealed dispatch satchel on the station's dispatch arm
    this.satchel = part("satchel");
    this.dispatchHook = part("dispatch_hook");
    // the dispatch hangs on a hook chained from the door's lintel, where the station loads the cage
    this.satchel.scale.setScalar(0.95);
    this.dispatchHook.visible = false;
    this.dispatchChain = this.ropes.add(iron, 0.012);
    this.group.add(this.satchel);
    if (opts.rook && opts.rookMeta) {
      const rook = opts.rook.scene;
      rook.scale.setScalar((TRAILBLAZER_HEIGHT * ROOK_RATIO) / opts.rookMeta.height);
      rook.position.copy(v3(data.rigParts.cage.rook));
      rook.rotation.y = Math.PI / 2; // he faces the door (+X in the cage)
      rook.traverse(o => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.side = THREE.DoubleSide;
        mat.roughness = 0.8;
        mat.metalness = 0;
        mat.envMapIntensity = 0.7;
        if (m.morphTargetInfluences) this.rookMesh = m;
        // the generated shell ships as loose flat-shaded pieces; weld coincident vertices (their
        // colours and morph offsets agree) and smooth the normals so light rolls over his form
        m.geometry.deleteAttribute("normal");
        const welded = mergeVertices(m.geometry, 1e-4);
        welded.computeVertexNormals();
        m.geometry.dispose();
        m.geometry = welded;
      });
      this.cage.add(rook);
      this.rook = rook;
    }

    // soft contact shadow under her: a radial falloff, not a hard disc
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g2 = c.getContext("2d")!;
    const grad = g2.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.9)");
    grad.addColorStop(0.45, "rgba(0,0,0,0.45)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const shadowMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x1a120c, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.contactShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), shadowMat);
    this.contactShadow.rotation.x = -Math.PI / 2;
    this.contactShadow.renderOrder = 3;
    scene.add(this.contactShadow);

    this.placeCage(0);
    this.update(0, null, false, false);
  }

  private material(name: string, geometry?: THREE.BufferGeometry) {
    let m = this.mats.get(name);
    if (!m) {
      m = createLevelMaterial(name, this.ctx, false, geometry ?? new THREE.BufferGeometry(), true);
      if (name !== "glow") patchDynamicSunVis(m, this.cageSun);
      this.mats.set(name, m);
    }
    return m;
  }

  /** the gates become route blockers the controller honours */
  installBlockers(controller: PlayerController) {
    controller.blockers.length = 0;
    for (const g of this.gates) controller.blockers.push({ s0: g.block[0], s1: g.block[1], on: false });
  }

  begin() {
    if (this.chaseTime < 0) this.chaseTime = 0;
  }

  get started() {
    return this.chaseTime >= 0;
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number, controller: PlayerController | null, lineHeld: boolean, autowalk: boolean) {
    this.events.length = 0;
    if (this.chaseTime >= 0) this.chaseTime += dt;
    this.state.chaseTime = this.chaseTime;
    const s = controller?.progress ?? 0;

    // the shutdown wave
    if (controller && this.chaseTime > 0.4 && this.state.beat === "approach") {
      this.state.beat = "shutdown";
      this.events.push("bell");
    }
    if (this.state.beat !== "approach") this.state.shutdown = Math.min(1, this.state.shutdown + dt * 0.5);
    this.gates.forEach((g, i) => {
      if (!g.down && controller && this.chaseTime > 0 && (s > g.trigger || (i === 0 && this.chaseTime > 2.2))) {
        g.down = true;
        this.events.push("gate");
      }
      if (g.down && (g.y > 0 || g.vy !== 0)) {
        g.vy -= 26 * dt;
        g.y += g.vy * dt;
        if (g.y <= 0) {
          g.y = 0;
          g.vy = g.vy < -3 ? -g.vy * 0.16 : 0;
          if (g.vy > 0) this.events.push("clank");
        }
      }
      g.obj.position.set(g.base.x, g.base.y + g.y, g.base.z);
      if (controller?.blockers[i]) controller.blockers[i].on = g.down && g.y < 1.6;
    });
    const raise = controller && s > this.rigs.bridge.trigger ? this.rigs.bridge.leaves[0].raised : 0;
    for (const lf of this.leaves) {
      const prev = lf.angle;
      lf.angle += (raise - lf.angle) * Math.min(1, dt * 0.9);
      if (raise > 0 && prev < 0.02 && lf.angle >= 0.02) this.events.push("winch");
      lf.inner.rotation.z = lf.angle;
      lf.outer.updateMatrixWorld(true);
      lf.chains.forEach((chain, k) => {
        const sgn = k === 0 ? 1 : -1;
        const tip = lf.inner.localToWorld(this.tmp.set(lf.tip.x, lf.tip.y, lf.tip.z * sgn));
        const local = lf.outer.worldToLocal(this.tmp2.copy(tip));
        const top = this.tmp2.copy(lf.gantry).addScaledVector(lf.across, lf.half * (local.z >= 0 ? -1 : 1));
        Ropes.set(chain, tip, top);
      });
    }

    // ropeway: carriers and the cage ride the haul rope
    const rw = this.rigs.ropeway;
    const ropeU = Math.max(0, this.chaseTime) * rw.speed;
    for (const c of this.carriers) {
      const u = c.userData.phase + ropeU;
      this.ropeway.at(u, c.position, this.tmpT);
      c.rotation.y = Math.atan2(-this.tmpT.z, this.tmpT.x);
      c.userData.u = ((u % this.ropeway.length) + this.ropeway.length) % this.ropeway.length;
      const du = Math.abs(c.userData.u - this.cageU);
      c.visible = this.cageDockT >= 0 || Math.min(du, this.ropeway.length - du) > 7;
    }
    this.placeCage(dt);

    // rigs
    if (controller) this.updateRigs(dt, controller, lineHeld, autowalk);
    this.poseLine(this.lines.ride);
    this.poseLine(this.lines.release);
    const boomLine = this.lines.release;
    this.tieBack.visible = !this.used.has("release") && this.active?.id !== "release";
    if (this.tieBack.visible) {
      const a = boomLine.part.localToWorld(this.tmp.set(boomLine.tipLocal.x * 0.55, 0, 0));
      Ropes.set(this.tieBack, v3(this.rigs.boom.cleat!), a);
    }

    this.updateReveal(dt, controller);

    this.stampTimer = Math.max(0, this.stampTimer - dt);
    if (this.stampTimer === 0) this.state.stamp = "";

    if (controller) {
      // contact shadow on the floor under her, fading and spreading with height
      this.down.origin.copy(controller.position).y += 0.6;
      const hit = this.walk.raycastFirst(this.down, THREE.DoubleSide, 0, 30);
      const mat = this.contactShadow.material as THREE.MeshBasicMaterial;
      if (hit) {
        const h = Math.max(0, controller.position.y - hit.point.y);
        this.contactShadow.visible = h < 4;
        this.contactShadow.position.set(controller.position.x, hit.point.y + 0.015, controller.position.z);
        mat.opacity = 0.5 * Math.max(0, 1 - h / 4);
        this.contactShadow.scale.setScalar(1 + h * 0.35);
      } else {
        this.contactShadow.visible = false;
      }
    }
  }

  private poseLine(line: Line) {
    line.group.rotation.y = line.yaw;
    line.group.updateMatrixWorld(true);
    const tip = line.part.localToWorld(this.tmp.copy(line.tipLocal));
    const seat = this.lineHook(line, this.tmp2);
    // the hook's toggle (her grip) sits 0.9 below the hook part's origin
    line.hook.position.set(seat.x, seat.y + 0.9, seat.z);
    line.hook.rotation.y = line.yaw;
    Ropes.set(line.hookRope, tip, line.hook.position);
    if (line.id === "ride") {
      // the counterweight hangs from the counter-jib and drops as far as the hook rises
      const ct = line.part.localToWorld(this.tmp.set(-3.5, 0.62, 0));
      const rise = seat.y - line.rig.hook0[1];
      this.counterweight.position.set(ct.x, ct.y - 1.0 - rise, ct.z);
      this.counterweight.rotation.y = line.yaw;
      Ropes.set(this.cwRope, ct, this.counterweight.position);
    }
  }

  /** where the hook's seat (her hands) is for the line's current slew and hoist */
  private lineHook(line: Line, out: THREE.Vector3) {
    const rig = line.rig;
    const p = rig.pivot;
    out.set(p[0] + Math.cos(line.yaw) * rig.radius, 0, p[2] - Math.sin(line.yaw) * rig.radius);
    const f = line.id === "ride" ? line.hoist : angleFrac(rig.yaw0, rig.yaw1, line.yaw);
    out.y = THREE.MathUtils.lerp(rig.hook0[1], rig.hook1[1], f);
    return out;
  }

  private updateRigs(dt: number, controller: PlayerController, lineHeld: boolean, autowalk: boolean) {
    const wants = lineHeld || autowalk;
    const hands = this.tmp.copy(controller.position);
    hands.y += HANG;
    this.state.lineReady = false;
    this.handsUp = Math.max(0, this.handsUp - dt * 3);
    if (!this.active && controller.grounded && !controller.mantling) {
      for (const key of ["ride", "release"] as const) {
        if (this.used.has(key)) continue;
        const line = this.lines[key];
        const seat = this.lineHook(line, this.tmp2);
        const d = Math.hypot(seat.x - hands.x, seat.z - hands.z);
        if (d < line.rig.grabRadius + 1.2) {
          this.handTarget.copy(seat);
          this.handsUp = Math.max(this.handsUp, THREE.MathUtils.clamp(1 - (d - line.rig.grabRadius) / 1.2, 0, 1) * 0.4);
        }
        if (d < line.rig.grabRadius && Math.abs(seat.y - hands.y) < 1.2) {
          this.state.lineReady = true;
          if (wants) {
            this.active = { id: key, t: 0 };
            this.startHang(controller, seat, key === "ride" ? "RIDE" : "RELEASE");
            break;
          }
        }
      }
      if (!this.active && !this.used.has("transfer") && Math.abs(controller.progress - rw(this).csGrab) < 6) {
        let best = -1;
        let bd = Infinity;
        const hanger = rw(this).hanger;
        this.carriers.forEach((c, i) => {
          if (!c.visible || c.userData.u >= this.ropeway.haulEnd) return;
          const d = Math.hypot(c.position.x - hands.x, c.position.z - hands.z) + Math.abs(c.position.y - hanger - hands.y) * 0.5;
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
        if (best >= 0 && bd < rw(this).grabRadius + 2.5) {
          this.handTarget.copy(this.carriers[best].position).y -= hanger;
          this.handsUp = Math.max(this.handsUp, 0.4);
        }
        if (best >= 0 && bd < rw(this).grabRadius) {
          this.state.lineReady = true;
          if (wants) {
            const seat = this.tmp2.copy(this.carriers[best].position);
            seat.y -= hanger;
            const landGrip = v3(rw(this).land_point);
            landGrip.y += HANG + hanger;
            this.active = { id: "transfer", t: 0, carrier: best, landU: this.ropeway.nearestHaul(landGrip) };
            this.startHang(controller, seat, "TRANSFER");
          }
        }
      }
    }
    const a = this.active;
    if (!a) return;
    a.t += dt;
    const body = this.tmp2;
    const step = Math.max(dt, 1e-3);
    if (a.id === "ride" || a.id === "release") {
      const line = this.lines[a.id];
      const rig = line.rig;
      const T = a.id === "ride" ? RIDE_TIME : RELEASE_TIME;
      const u = THREE.MathUtils.clamp((a.t - GRAB_DELAY) / T, 0, 1);
      if (a.id === "ride") {
        line.hoist = drop(u);
        line.yaw = lerpAngle(rig.yaw0, rig.yaw1, ease(THREE.MathUtils.clamp((u - 0.12) / 0.88, 0, 1)));
      } else {
        // released: the heavy tail swings the boom round and the stop line catches it
        line.yaw = lerpAngle(rig.yaw0, rig.yaw1, u < 0.8 ? 0.78 * (u / 0.8) ** 1.6 : 0.78 + 0.22 * ease((u - 0.8) / 0.2));
      }
      if (a.t > GRAB_DELAY && a.t - dt <= GRAB_DELAY) this.events.push(a.id === "ride" ? "ratchet" : "snap");
      this.poseLine(line);
      const seat = this.lineHook(line, this.tmp);
      this.pend.step(seat, step, body);
      this.handTarget.copy(seat);
      this.pend.velocity(this.vel);
      // square to the toggle (it runs along the jib/boom), facing the way the swing takes her
      controller.hang(body, this.squareTo(new THREE.Vector3(Math.cos(line.yaw), 0, -Math.sin(line.yaw)), controller.heading));
      if (u >= 1 && (this.pend.off.length() < 0.45 || a.t > GRAB_DELAY + T + 1.0)) this.finish(controller);
    } else if (a.carrier !== undefined) {
      const c = this.carriers[a.carrier];
      const seat = this.tmp.copy(c.position);
      seat.y -= rw(this).hanger;
      this.pend.step(seat, step, body);
      this.handTarget.copy(seat);
      this.pend.velocity(this.vel);
      const along = new THREE.Vector3(Math.cos(c.rotation.y), 0, -Math.sin(c.rotation.y));
      controller.hang(body, this.squareTo(new THREE.Vector3(along.z, 0, -along.x), controller.heading));
      if (c.userData.u >= (a.landU ?? 0) || (!wants && a.t > 0.6)) this.finish(controller);
    }
    if (this.active) this.handsUp = 1;
  }

  /** The heading square to a grip bar along `axis`, on whichever side is nearer `current`. */
  private squareTo(axis: THREE.Vector3, current: number) {
    const h = Math.atan2(axis.z, -axis.x);   // facing = axis turned a quarter
    const alt = h + Math.PI;
    const d = (a: number) => Math.abs(Math.atan2(Math.sin(a - current), Math.cos(a - current)));
    return d(h) <= d(alt) ? h : alt;
  }

  private startHang(controller: PlayerController, seat: THREE.Vector3, stamp: string) {
    const v = this.vel.set(Math.sin(controller.heading) * controller.speed, 0, Math.cos(controller.heading) * controller.speed);
    this.pend.reset(seat, controller.position, v);
    this.state.active = this.active!.id;
    this.state.beat = this.active!.id;
    this.state.stamp = stamp;
    this.stampTimer = 1.8;
    this.events.push("grab");
  }

  private finish(controller: PlayerController) {
    this.lastRig = this.active!.id;
    this.sinceRig = 0;
    this.used.add(this.active!.id);
    this.state.tensionUse = this.used.size;
    this.active = null;
    this.state.active = null;
    // let go on the rig's own velocity, with a small hop so the landing reads
    controller.release(new THREE.Vector3(this.vel.x * 0.9, Math.max(1.4, this.vel.y * 0.5 + 1.4), this.vel.z * 0.9));
    this.events.push("letgo");
  }

  private placeCage(dt: number) {
    const dock = v3(this.rigs.cage.dock);
    const doorDir = v3(this.rigs.cage.doorDir);
    const doorYaw = Math.atan2(-doorDir.z, doorDir.x);
    const t = Math.max(0, this.chaseTime);
    if (this.cageDockT < 0) {
      if (this.chaseTime > 0.8) this.cageU += rw(this).speed * dt;
      const grip = this.ropeway.at(this.cageU, this.tmp, this.tmpT);
      this.cage.position.set(grip.x, grip.y - 3.45, grip.z);
      // travelling: door to the sea, a slow swing on the grip
      this.cage.rotation.set(0, Math.atan2(-this.tmpT.z, this.tmpT.x) - Math.PI / 2, this.chaseTime > 0.8 ? Math.sin(t * 1.3) * 0.035 : 0);
      if (this.cageU >= this.ropeway.haulEnd - 0.5) {
        this.cageDockT = 0;
        this.cageFrom.copy(this.cage.position);
        this.cageFromYaw = this.cage.rotation.y;
        this.events.push("dock");
      }
    } else {
      this.cageDockT += dt;
      const u = ease(Math.min(1, this.cageDockT / 3.2));
      this.cage.position.copy(this.cageFrom).lerp(dock, u);
      this.cage.position.y += Math.sin(u * Math.PI) * 0.25;
      this.cage.rotation.set(0, lerpAngle(this.cageFromYaw, doorYaw, u), Math.sin(this.cageDockT * 2.1) * 0.03 * (1 - u));
      this.state.cageDocked = u >= 1;
      // home: the door swings open
      this.cageDoor.rotation.y = -ease(THREE.MathUtils.clamp((this.cageDockT - 3.0) / 1.6, 0, 1)) * 1.95;
    }
    this.cage.updateMatrixWorld(true);
    this.cageLamp.intensity = 4.5 + Math.sin(t * 9.0) * 0.2;
  }

  // ---------------------------------------------------------------- the reveal
  private setRook(pose: Record<string, number>) {
    const m = this.rookMesh;
    if (!m?.morphTargetInfluences || !m.morphTargetDictionary) return;
    for (const [name, i] of Object.entries(m.morphTargetDictionary)) m.morphTargetInfluences[i] = pose[name] ?? 0;
  }

  /** wing tip for a blended pose, world space: the same linear blend the morph targets use */
  private rookTip(pose: Record<string, number>, out: THREE.Vector3) {
    const meta = this.rookMeta!;
    const rest = meta.wingTip.rest;
    out.set(rest[0], rest[1], rest[2]);
    for (const [k, w] of Object.entries(pose)) {
      const tip = meta.wingTip[k];
      if (!tip || !w || k === "talk" || k.startsWith("breathe")) continue;
      out.x += (tip[0] - rest[0]) * w;
      out.y += (tip[1] - rest[1]) * w;
      out.z += (tip[2] - rest[2]) * w;
    }
    return this.rook!.localToWorld(out);
  }

  private updateReveal(dt: number, controller: PlayerController | null) {
    const now = Math.max(0, this.chaseTime);
    // always breathing between his two idle poses
    const b = 0.5 + 0.5 * Math.sin(now * 1.35);
    const pose: Record<string, number> = { breathe_in: 0.4 * b, breathe_out: 0.4 * (1 - b) };
    if (!this.rook || !this.rookMeta) return;
    this.rook.updateMatrixWorld(true);
    // the dispatch arm holds the satchel exactly where his reach lands, just outside the door
    this.rookTip({ reach: 1 }, this.hookSeat);
    this.dispatchHook.position.copy(this.hookSeat);
    const door = v3(this.rigs.cage.doorDir);
    this.dispatchChain.visible = !this.satchelHeld;
    Ropes.set(this.dispatchChain, this.hookSeat, this.tmp2.set(this.hookSeat.x, this.cage.position.y + 2.42, this.hookSeat.z));
    if (this.state.cageDocked && controller && !this.state.reveal && controller.progress > rw(this).csLand + 1.0 && controller.grounded && this.cageDockT > 4.4) {
      this.state.reveal = true;
      this.state.beat = "reveal";
      this.state.revealTime = 0;
      this.events.push("reveal");
    }
    let tip: THREE.Vector3 | null = null;
    if (this.state.reveal) {
      const r = (this.state.revealTime += dt);
      // she squares up to the open door
      if (controller) controller.faceToward(Math.atan2(-door.x, -door.z), dt);
      const k = (a: number, c: number) => THREE.MathUtils.clamp((r - a) / (c - a), 0, 1);
      const look = ease(k(0.6, 1.4)) * (1 - ease(k(1.4, 2.1)));
      const reach = ease(k(1.4, 2.1)) * (1 - ease(k(2.7, 3.4)));
      const lift = ease(k(2.7, 3.4)) * (1 - ease(k(3.4, 4.2)));
      const hold = ease(k(3.4, 4.2)) * (1 - ease(k(5.0, 5.5))) + ease(k(7.6, 8.4));
      const lean = ease(k(5.0, 5.5)) * (1 - ease(k(7.6, 8.4)));
      Object.assign(pose, { look, reach, lift, hold: Math.min(1, hold), lean_in: lean });
      // his beak moves on his two lines
      const talking = (r > 5.15 && r < 7.2) || (r > 9.95 && r < 12.0);
      pose.talk = talking ? Math.max(0, 0.55 + 0.45 * Math.sin(r * 17) * Math.sin(r * 5.3 + 1)) : 0;
      if (!this.satchelHeld && r > 2.55) {
        this.satchelHeld = true;
        this.events.push("unhook");
      }
      if (this.satchelHeld) tip = this.rookTip(pose, this.tmp);
      const lines: [number, number, string][] = [
        [3.0, 4.9, "TRAILBLAZER: That's not yours."],
        [5.1, 7.4, "ROOK: It isn't theirs either."],
        [7.8, 9.6, "TRAILBLAZER: Leave it."],
        [9.9, 12.4, "ROOK: I am leaving with it."],
      ];
      const line = lines.find(([a, c]) => r >= a && r < c);
      this.state.caption = line ? line[2] : "";
      this.state.speaker = line ? line[2].split(":")[0] : "";
    }
    this.setRook(pose);
    // the satchel hangs from its strap: on the arm, then in his wing, swinging as it goes
    this.satchel.position.copy(tip ?? this.hookSeat);
    // in his wing he holds the strap short, so the satchel rides at his chest rather than his knees
    if (tip) this.satchel.position.y += 0.16 * Math.min(1, (this.state.revealTime - 2.55) / 0.8);
    const swing = this.satchelHeld ? Math.sin(this.state.revealTime * 4.1) * 0.2 * Math.exp(-(this.state.revealTime - 2.55) * 0.55) : 0;
    this.satchel.rotation.set(0, Math.atan2(-door.z, door.x), swing);
  }

  /** Cinematic framing for the opening sighting and the reveal; null = the gameplay camera. */
  cameraDirective(controller: PlayerController, heroHead: THREE.Vector3): CameraDirective {
    const d = this.camDirective;
    if (this.state.reveal && this.rook) {
      const r = this.state.revealTime;
      const rookHead = this.rook.localToWorld(this.tmp.set(0, 1.3, 0.05));
      const door = v3(this.rigs.cage.doorDir);
      const side = new THREE.Vector3(-door.z, 0, door.x);
      const herLine = (r > 3.0 && r < 4.9) || (r > 7.8 && r < 9.6);
      if (herLine) {
        // her face, three-quarter, from beside the cage door: the terrace and the sky behind her
        d.position.copy(heroHead).addScaledVector(door, -0.95).addScaledVector(side, -1.7);
        d.position.y = heroHead.y - 0.1;
        d.target.copy(heroHead).addScaledVector(door, 0.15);
        d.target.y -= 0.3;
        d.fov = 46;
      } else {
        // over her shoulder into the open cage: her in the foreground, Rook and the workshop beyond
        // (her left shoulder: the side his reaching wing and the satchel are on)
        d.position.copy(heroHead).addScaledVector(door, 1.9).addScaledVector(side, -0.95);
        d.position.y = heroHead.y + 0.02;
        d.target.copy(rookHead).lerp(heroHead, 0.12);
        d.target.y = rookHead.y - 0.2;
        d.fov = 42;
      }
      d.weight = ease(THREE.MathUtils.clamp(r / 1.1, 0, 1));
      d.collide = false; // authored framings at the dock; the dock's camera blocker would push them into her
      return d;
    }
    // a rig carrying her: a wide, side-on shot from outside the swing, eased in and out
    const id = this.active?.id ?? (this.sinceRig < 0.75 ? this.lastRig : null);
    this.sinceRig += 1 / 60;
    // cut, don't blend: a blend would drag the lens through the cliff and the stalls. The shot holds
    // until she has landed, then cuts back to the gameplay camera, which has been following her.
    this.rigCamW = this.active || this.sinceRig < 0.75 ? 1 : 0;
    if (id && this.rigCamW > 0.001) {
      // a fixed crane shot from out over the water, square to the rig's swing, tracking her
      const body = controller.position;
      if (!this.rigCamPrimed) {
        const want = this.rigCamPos;
        if (id === "ride" || id === "release") {
          const rig = this.lines[id].rig;
          const mid = v3(rig.hook0).add(v3(rig.hook1)).multiplyScalar(0.5);
          const out = mid.clone().sub(v3(rig.pivot)).setY(0).normalize();
          // (the ride's shot rises above the moored boats' masts and looks down the swing)
          want.copy(mid).addScaledVector(out, id === "ride" ? 15 : 12);
          want.y = mid.y + (id === "ride" ? 6.5 : 1.5);
        } else {
          const rw0 = this.rigs.ropeway;
          const mid = v3(rw0.heads[2]).add(v3(rw0.heads[3])).multiplyScalar(0.5);
          const seaward = v3(rw0.land[2]).add(v3(rw0.land[3])).multiplyScalar(-0.5).setY(0).normalize();
          want.copy(mid).addScaledVector(seaward, 12);
          want.y = mid.y - 1.0;
        }
        this.rigCamTarget.copy(body).add(new THREE.Vector3(0, 1.4, 0));
      }
      this.rigCamPrimed = true;
      this.rigCamTarget.lerp(this.tmp2.copy(body).add(new THREE.Vector3(0, 1.4, 0)), 0.12);
      d.position.copy(this.rigCamPos);
      d.target.copy(this.rigCamTarget);
      d.fov = 40;
      d.weight = ease(Math.min(1, this.rigCamW));
      d.collide = false; // placed out over open water by construction
      return d;
    }
    this.rigCamPrimed = false;
    // the opening: past her shoulder at the cage pulling out of the harbour station
    if (this.intro && this.chaseTime >= 0 && this.chaseTime < 4.4) {
      const t = this.chaseTime;
      const cagePos = this.tmp.copy(this.cage.position);
      cagePos.y += 1.8;
      const fwd = this.tmp2.set(Math.sin(controller.heading), 0, Math.cos(controller.heading));
      d.position.copy(controller.position).addScaledVector(fwd, -3.4);
      d.position.y += 1.15;
      const toCage = new THREE.Vector3().subVectors(cagePos, d.position).setY(0).normalize();
      d.position.addScaledVector(toCage, -0.6);
      d.target.copy(cagePos).lerp(heroHead, 0.3);
      d.fov = 52;
      d.weight = t < 2.8 ? 1 : 1 - ease((t - 2.8) / 1.6);
      d.collide = true;
      return d;
    }
    return null;
  }

  /** What the autopilot does near the rigs: steer to a hook, wait for a carrier, jump the gap. */
  autopilotHint(controller: PlayerController): AutopilotHint | null {
    const s = controller.progress;
    if (this.active) return { stop: true };
    for (const key of ["ride", "release"] as const) {
      const line = this.lines[key];
      if (this.used.has(key)) continue;
      if (s > line.rig.csGrab - 7 && s < line.rig.csGrab + 3) {
        const seat = this.lineHook(line, new THREE.Vector3());
        const dist = Math.hypot(seat.x - controller.position.x, seat.z - controller.position.z);
        return { target: seat, mag: dist > 2.5 ? 0.9 : 0.45 };
      }
    }
    const r = rw(this);
    if (!this.used.has("transfer") && s > r.csGrab - 8 && s < r.csGrab + 4) {
      // wait at the parapet under the haul rope for the next carrier
      const spot = this.route.at(r.csGrab);
      const head = v3(r.heads[2]);
      spot.x += (head.x - spot.x) * 0.45;
      spot.z += (head.z - spot.z) * 0.45;
      const dist = Math.hypot(spot.x - controller.position.x, spot.z - controller.position.z);
      return dist > 0.4 ? { target: spot, mag: dist > 2 ? 0.9 : 0.35 } : { stop: true };
    }
    const [h0] = this.rigs.holes[0];
    if (s > h0 - 1.5 && s < h0 - 0.2 && controller.grounded) return { jump: true, mag: 1 };
    return null;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.contactShadow.parent?.remove(this.contactShadow);
    const geos = new Set<THREE.BufferGeometry>();
    this.group.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.isMesh) geos.add(m.geometry);
    });
    geos.forEach(g => g.dispose());
    this.mats.forEach(m => m.dispose());
    this.ropes.dispose();
    this.contactShadow.geometry.dispose();
    (this.contactShadow.material as THREE.MeshBasicMaterial).map?.dispose();
    (this.contactShadow.material as THREE.Material).dispose();
  }
}

const rw = (w: Phase2World) => (w as unknown as { rigs: ChaseRigs }).rigs.ropeway;
