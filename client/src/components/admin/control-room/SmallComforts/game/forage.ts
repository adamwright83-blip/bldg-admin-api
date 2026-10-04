import * as THREE from "three";
import type { Game } from "./game";
import { Mouse, type Mode } from "./mice";
import { DESK_Y, Shelf, type ShelfProp } from "./shelf";
import { clamp01, easeInOut } from "./style";
import {
  FIXTURES, LIP, SHELF_OBJECTS, SHELF_OBSTACLES, TIN_CAN, drop, pickUp, remainingObjects, stepToward,
  type FixtureId, type Haul, type ShelfObjectId,
} from "../logic/foraging";
import { installFixture } from "../logic/episode";
import { MirrorPlay } from "./mirrorplay";
import { MIRROR } from "../logic/mirror";
import { HINT_DELAY_SECONDS } from "../logic/playtest";

type Stage = "off" | "exiting" | "idle" | "walking" | "inspecting" | "entering" | "tinkering" | "placing" | "fixing" | "reacting" | "returning";
type Intent = { kind: "point" } | { kind: "object"; id: ShelfObjectId } | { kind: "home" } | { kind: "tin" };

const WALK = 3.0;
const RADIUS = 0.42;
/** where the proprietor starts inside, in front of the latch */
const INSIDE = { x: LIP.x, z: 1.45 };

/**
 * The proprietor: you. Walks out over the suitcase lip, wanders the lost-property shelf,
 * hauls ONE oversized object home, turns it into a fixture, and watches a resident's routine change.
 */
export class Forage {
  mouse = new Mouse("proprietor");
  shelf = new Shelf();
  stage: Stage = "off";
  haul: Haul = { carrying: null };
  pos = new THREE.Vector3(INSIDE.x, 0, INSIDE.z);
  yaw = 0;
  private target = new THREE.Vector3();
  private intent: Intent = { kind: "point" };
  private stageT = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private camK = 0;
  private camGoal = 0;
  private carried: ShelfProp | null = null;
  private rollAngle = 0;
  private walked = 0;
  private marker: THREE.Mesh;
  private markerOn = false;
  private lastTinToast = -99;
  mirror: MirrorPlay;

  constructor(private g: Game) {
    g.world.scene.add(this.shelf.group);
    g.world.scene.add(this.mouse.root);
    this.mouse.root.visible = false;
    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 20), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; g.world.scene.add(this.marker);
    this.mirror = new MirrorPlay(g);
  }

  get active() { return this.stage !== "off"; }
  get placing() { return this.stage === "placing" || this.stage === "fixing"; }
  get busy() { return this.stage === "exiting" || this.stage === "entering" || this.stage === "tinkering" || this.stage === "fixing" || this.stage === "reacting" || this.stage === "returning"; }
  get carrying() { return this.haul.carrying; }

  // ------------------------------------------------------------------ entering and leaving the shelf
  begin() {
    if (this.stage !== "off") return;
    const g = this.g;
    this.stage = "exiting"; this.stageT = 0;
    this.pos.set(INSIDE.x, 0, INSIDE.z); this.yaw = 0;
    this.from.copy(this.pos); this.to.set(LIP.x, DESK_Y, LIP.z + 0.35);
    this.mouse.root.visible = true; this.mouse.root.scale.setScalar(1);
    this.shelf.setActive(true); this.refreshShelf();
    this.camGoal = 1;
    g.sound.pick();
    g.hint("Tap the shelf to walk. Find something to haul home.");
    setTimeout(() => g.ui.querySelector("#hint")?.classList.remove("show"), 3200);
  }

  /** all the way back to the furnish screen */
  private finish() {
    this.stage = "off";
    this.mouse.root.visible = false;
    this.shelf.setActive(false);
    this.marker.visible = false;
    this.camGoal = 0;
    this.g.onForageDone();
  }

  private refreshShelf() {
    this.shelf.setAvailable(remainingObjects(this.g.episode.fixtures), this.haul.carrying);
  }

  // ------------------------------------------------------------------ input
  /** returns true if the tap was used */
  onTap(e: PointerEvent): boolean {
    if (this.stage === "placing") { this.mirror.down(e); return true; }
    if (!this.active || this.busy) return true;
    const g = this.g;
    g.raycaster.setFromCamera(g.ndcOf(e), g.world.camera);

    // the suitcase mouth: take it home
    const lipHit = g.raycaster.intersectObject(this.shelf.lipMarker, false)[0];
    // objects
    // the load in your own hands is not a target
    const props = [...this.shelf.props.values()].filter(p => p.group.visible && p !== this.carried).map(p => p.group);
    const hits = g.raycaster.intersectObjects(props, true);
    if (hits.length) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !props.includes(o as THREE.Group)) o = o.parent;
      const prop = [...this.shelf.props.values()].find(p => p.group === o);
      if (prop) { g.pt?.rec("tap", { target: `object:${prop.id}` }); this.goToObject(prop.id); return true; }
    }
    // the tin can: seen, not reachable
    const tinHit = g.raycaster.intersectObject(this.shelf.tin, true)[0];
    if (tinHit) { g.pt?.rec("tap", { target: "tin" }); this.goToTin(); return true; }

    const p = new THREE.Vector3();
    if (!g.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -DESK_Y), p)) return true;
    if (lipHit || Math.hypot(p.x - LIP.x, p.z - LIP.z) < 0.9) { g.pt?.rec("tap", { target: "lip" }); this.goHome(); return true; }
    g.pt?.rec("tap", { target: "point" });
    this.intent = { kind: "point" };
    this.walkTo(p.x, p.z, true);
    return true;
  }

  onMove(e: PointerEvent) { if (this.stage === "placing") this.mirror.move(e); }
  onUp() { if (this.stage === "placing") this.mirror.up(); }

  private walkTo(x: number, z: number, showMarker: boolean) {
    this.g.pt?.rec("walk_start", { intent: this.intent.kind, carrying: this.haul.carrying });
    this.target.set(x, DESK_Y, z);
    this.stage = "walking";
    if (showMarker) { this.marker.visible = true; this.markerOn = true; this.marker.position.set(x, DESK_Y + 0.03, z); }
  }

  private goToObject(id: ShelfObjectId) {
    const g = this.g;
    if (this.haul.carrying) {
      g.sound.nope();
      g.toast(`Your hands are full. Carry the ${SHELF_OBJECTS[this.haul.carrying].label.toLowerCase()} home, or put it down.`);
      return;
    }
    const s = SHELF_OBJECTS[id].spot;
    // stop a body-length short, on the side you're coming from
    const dx = this.pos.x - s.x, dz = this.pos.z - s.z, d = Math.hypot(dx, dz) || 1;
    const prop = this.shelf.props.get(id)!;
    const stand = prop.radius + 0.55;
    this.intent = { kind: "object", id };
    this.walkTo(s.x + (dx / d) * stand, s.z + (dz / d) * stand, false);
    g.sound.pick();
  }

  private goToTin() {
    this.intent = { kind: "tin" };
    const dx = this.pos.x - TIN_CAN.x, dz = this.pos.z - TIN_CAN.z, d = Math.hypot(dx, dz) || 1;
    this.walkTo(TIN_CAN.x + (dx / d) * 3.1, TIN_CAN.z + (dz / d) * 3.1, false);
  }

  goHome() {
    if (!this.active || this.busy) return;
    this.intent = { kind: "home" };
    this.walkTo(LIP.x, LIP.z + 0.35, false);
  }

  putDown() {
    if (!this.haul.carrying || this.busy) return;
    const r = drop(this.haul);
    const id = r.dropped!;
    const prop = this.shelf.props.get(id)!;
    this.haul = r.haul;
    this.g.pt?.rec("put_down", { id });
    this.detachCarried();
    // set it down where you stand, a little ahead
    const ahead = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.1);
    prop.group.position.set(this.pos.x + ahead.x, DESK_Y, this.pos.z + ahead.z);
    prop.group.rotation.set(0, this.yaw, 0);
    prop.group.visible = true;
    const ring = this.shelf.rings.get(id)!;
    ring.position.set(prop.group.position.x, DESK_Y + 0.03, prop.group.position.z); ring.visible = true;
    this.g.sound.place();
    this.refreshShelf();
    this.g.refreshForageUi();
  }

  // ------------------------------------------------------------------ carrying
  private attachCarried(id: ShelfObjectId, style: "overhead" | "rolling") {
    const prop = this.shelf.props.get(id)!;
    this.carried = prop;
    prop.group.visible = true;
    this.shelf.rings.get(id)!.visible = false;
    if (style === "overhead") {
      this.mouse.root.add(prop.group);
      prop.spin.rotation.set(0, 0, 0);
      prop.group.position.set(0, 1.3, 0.12); prop.group.rotation.set(0, 0, 0); prop.group.scale.setScalar(0.62);
      if (id === "thread_spool") prop.group.rotation.set(0, Math.PI / 2, 0);
    } else {
      this.g.world.scene.add(prop.group);
      prop.group.scale.setScalar(1);
    }
  }

  private detachCarried() {
    const prop = this.carried;
    if (!prop) return;
    this.g.world.scene.add(prop.group);
    prop.group.scale.setScalar(1);
    prop.group.rotation.set(0, 0, 0);
    this.carried = null;
  }

  private haulMode(): Mode {
    const id = this.haul.carrying;
    if (!id) return "walk";
    return SHELF_OBJECTS[id].haul === "roll" ? "push" : "carry";
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number) {
    const g = this.g;
    // camera follows even while we are idle
    const goalDelta = this.camGoal - this.camK;
    if (Math.abs(goalDelta) > 0.0005) this.camK += Math.sign(goalDelta) * Math.min(Math.abs(goalDelta), dt * 0.9);
    if (this.active || this.camK > 0) g.world.setOutside(this.camK, this.pos.x, this.pos.z);
    if (!this.active) return;
    this.shelf.update(g.time);
    this.stageT += dt;
    this.marker.visible = this.markerOn && (this.stage === "walking" || this.stage === "idle");
    if (this.marker.visible) this.marker.scale.setScalar(1 + Math.sin(g.time * 8) * 0.12);

    switch (this.stage) {
      case "exiting": {
        const k = clamp01(this.stageT / 1.1);
        this.arc(k, 0.9);
        this.mouse.setMode("walk", g.time); this.mouse.walkPhase += dt * 10;
        if (k >= 1) { this.stage = "idle"; this.mouse.setMode("idle", g.time); g.refreshForageUi(); g.sound.thump(); }
        break;
      }
      case "walking": {
        const speed = WALK * (this.haul.carrying ? SHELF_OBJECTS[this.haul.carrying].hauledSpeed : 1);
        const r = stepToward({ x: this.pos.x, z: this.pos.z }, { x: this.target.x, z: this.target.z }, speed * dt, RADIUS, SHELF_OBSTACLES);
        const moved = Math.hypot(r.pos.x - this.pos.x, r.pos.z - this.pos.z);
        this.walked += moved;
        this.pos.set(r.pos.x, DESK_Y, r.pos.z);
        if (moved > 0.001) this.yaw = r.yaw;
        this.mouse.setMode(this.haulMode(), g.time);
        this.mouse.walkPhase += dt * (this.haul.carrying ? 9 : 11);
        this.advanceRoll(moved);
        if (r.arrived) this.arrive();
        break;
      }
      case "inspecting": {
        this.mouse.setMode("inspect", g.time);
        if (this.stageT > 1.15 && this.intent.kind === "object") this.lift(this.intent.id);
        break;
      }
      case "entering": {
        const k = clamp01(this.stageT / 1.2);
        this.arc(k, 1.15);
        this.mouse.setMode(this.haul.carrying ? "carry" : "walk", g.time); this.mouse.walkPhase += dt * 9;
        if (k >= 1) { this.beginTinker(); }
        break;
      }
      case "tinkering": {
        // walk to the fixture's spot, then work
        const id = this.haul.carrying!;
        const fx = FIXTURES[SHELF_OBJECTS[id].fixture];
        const walkEnd = 0.9;
        if (this.stageT < walkEnd) {
          const k = easeInOut(this.stageT / walkEnd);
          this.pos.lerpVectors(this.from, this.to, k);
          this.mouse.setMode("carry", g.time); this.mouse.walkPhase += dt * 9;
        } else if (id === "brass_button" && g.world.windowCut && this.carried) {
          // not a timer: set the button down and let the player find the light
          this.pos.copy(this.to);
          this.startPlacing();
        } else {
          this.pos.copy(this.to);
          this.mouse.setMode("tinker", g.time);
          if (this.carried) {
            // the load shrinks into the fixture it is about to become
            const kk = clamp01((this.stageT - walkEnd - 1.1) / 0.55);
            this.carried.group.scale.setScalar(Math.max(0.001, 0.62 * (1 - kk)));
          }
          if (Math.floor(this.stageT * 4) !== Math.floor((this.stageT - dt) * 4) && this.stageT < walkEnd + 1.5) g.sound.pick();
          if (this.stageT > walkEnd + 1.7) this.completeFixture(fx.id);
        }
        const face = FIXTURES[SHELF_OBJECTS[id].fixture].home;
        const fy = Math.atan2(face.x - this.pos.x, face.z - this.pos.z);
        if (this.stageT >= walkEnd) this.yaw = fy;
        break;
      }
      case "placing": {
        const m = this.mirror;
        m.update(dt, g.time);
        // step aside, into the front corner, so the button and the light are all you see
        const k = easeInOut(clamp01(this.stageT / 0.9));
        this.pos.lerpVectors(this.from, this.to, k);
        const moving = k < 1;
        this.mouse.setMode(moving ? "walk" : "inspect", g.time);
        if (moving) this.mouse.walkPhase += dt * 9;
        const c = m.pose;
        this.yaw = Math.atan2(c.x - this.pos.x, MIRROR.z - this.pos.z);
        if (m.heldLongEnough) {
          this.stage = "fixing"; this.stageT = 0;
          this.from.copy(this.pos); this.to.set(Math.max(-2.3, (m.result?.x ?? c.x) - 0.95), 0, -0.7);
          g.refreshForageUi();
        }
        break;
      }
      case "fixing": {
        // the aha has landed; only now does the proprietor wedge it in place
        this.mirror.update(dt, g.time);
        const walk = 0.6;
        if (this.stageT < walk) {
          this.pos.lerpVectors(this.from, this.to, easeInOut(this.stageT / walk));
          this.mouse.setMode("walk", g.time); this.mouse.walkPhase += dt * 9;
        } else {
          this.pos.copy(this.to);
          this.mouse.setMode("tinker", g.time);
          if (Math.floor(this.stageT * 4) !== Math.floor((this.stageT - dt) * 4) && this.stageT < walk + 0.8) g.sound.pick();
        }
        const rc = this.mirror.result ?? this.mirror.pose;
        this.yaw = Math.atan2(rc.x - this.pos.x, MIRROR.z - this.pos.z);
        if (this.stageT > walk + 1.0) this.completeFixture("signal_mirror", this.mirror.result ?? undefined);
        break;
      }
      case "reacting": {
        this.mouse.setMode("idle", g.time);
        if (this.stageT > 3.4) { this.stage = "returning"; this.stageT = 0; }
        break;
      }
      case "returning": {
        // proprietor ducks back to the doorway and hands control back to the furnish screen
        const k = clamp01(this.stageT / 0.6);
        this.pos.lerpVectors(this.from, new THREE.Vector3(INSIDE.x, 0, INSIDE.z), k);
        this.mouse.setMode("walk", g.time); this.mouse.walkPhase += dt * 10;
        if (k >= 1) this.finish();
        break;
      }
      default: break;
    }
  }

  /** a hop over the suitcase lip between from and to, apex `h` above the straight line */
  private arc(k: number, h: number) {
    const e = easeInOut(k);
    this.pos.lerpVectors(this.from, this.to, e);
    this.pos.y += Math.sin(e * Math.PI) * h;
    const dz = this.to.z - this.from.z;
    this.yaw = dz >= 0 ? 0 : Math.PI;
  }

  private advanceRoll(moved: number) {
    if (this.haul.carrying !== "thread_spool" || !this.carried) return;
    this.rollAngle += moved / 0.62;
  }

  private arrive() {
    const g = this.g;
    this.markerOn = false;
    if (this.intent.kind === "object") {
      this.stage = "inspecting"; this.stageT = 0;
      const dx = SHELF_OBJECTS[this.intent.id].spot.x - this.pos.x, dz = SHELF_OBJECTS[this.intent.id].spot.z - this.pos.z;
      this.yaw = Math.atan2(dx, dz);
      g.toast(SHELF_OBJECTS[this.intent.id].inspect);
      return;
    }
    if (this.intent.kind === "tin") {
      this.stage = "idle"; this.mouse.setMode("inspect", g.time);
      this.yaw = Math.atan2(TIN_CAN.x - this.pos.x, TIN_CAN.z - this.pos.z);
      if (g.time - this.lastTinToast > 2) {
        this.lastTinToast = g.time;
        g.toast("A tin can the size of a water tower. The lid is sealed. Not yet.");
        g.sound.nope();
      }
      return;
    }
    if (this.intent.kind === "home") { this.enterCase(); return; }
    this.stage = "idle"; this.mouse.setMode("idle", g.time);
  }

  private lift(id: ShelfObjectId) {
    const g = this.g;
    const r = pickUp(this.haul, id, g.episode.fixtures);
    if (!r.ok) {
      this.stage = "idle";
      g.toast(r.reason === "hands_full" ? "Your hands are full." : "You already turned that into something.");
      g.sound.nope();
      return;
    }
    this.haul = r.haul;
    g.pt?.rec("pickup", { id });
    const style = SHELF_OBJECTS[id].haul === "roll" ? "rolling" : "overhead";
    this.attachCarried(id, style);
    this.stage = "idle";
    g.sound.thump();
    g.toast(SHELF_OBJECTS[id].haul === "roll" ? "You lean into it. It rolls. Home is the green ring." : "Heavy. You balance it over your head. Home is the green ring.");
    g.refreshForageUi();
  }

  private enterCase() {
    const g = this.g;
    this.stage = "entering"; this.stageT = 0;
    this.from.set(LIP.x, DESK_Y, LIP.z + 0.35); this.to.set(INSIDE.x, 0, INSIDE.z);
    this.pos.copy(this.from);
    // whatever you were pushing gets heaved overhead for the climb
    if (this.haul.carrying && this.carried && this.carried.group.parent !== this.mouse.root) this.attachCarried(this.haul.carrying, "overhead");
    this.camGoal = 0.35;
    g.refreshForageUi();
  }

  private beginTinker() {
    const g = this.g;
    if (!this.haul.carrying) { this.stage = "returning"; this.stageT = 0; this.from.copy(this.pos); this.camGoal = 0; return; }
    const fx = FIXTURES[SHELF_OBJECTS[this.haul.carrying].fixture];
    this.stage = "tinkering"; this.stageT = 0;
    this.from.copy(this.pos);
    // work from the front of the spot, clear of whoever lives there
    this.to.set(fx.home.x - 0.4, 0, fx.home.z + 1.15);
    this.camGoal = 0;
    g.sound.thump();
  }

  private startPlacing() {
    const g = this.g;
    const prop = this.carried!;
    // the button leaves the proprietor's hands and lies on the lining
    this.mouse.root.remove(prop.group);
    prop.spin.rotation.set(0, 0, 0);
    prop.group.rotation.set(0, 0, 0);
    this.carried = null;
    this.stage = "placing"; this.stageT = 0;
    this.from.copy(this.pos); this.to.set(-2.1, 0, 0.7);
    this.mirror.hintAfter = g.pt?.hinted ? HINT_DELAY_SECONDS : null;
    g.pt?.rec("placing_start");
    this.mirror.start(prop.group);
    g.residents.makeRoom(g.time);
    g.sound.thump();
    g.refreshForageUi();
  }

  private completeFixture(id: FixtureId, placement?: { x: number; tiltDeg: number }) {
    const g = this.g;
    const loadId = this.haul.carrying!;
    g.pt?.rec("installed", { fixture: id, placement: placement ?? null });
    const result = installFixture(g.episode, id, placement ? { x: placement.x, tilt: placement.tiltDeg } : undefined);
    g.episode = result.state;
    if (placement) { this.mirror.stop(); this.mirror.release(); }
    this.detachCarried();
    this.shelf.props.get(loadId)!.group.visible = false;
    this.haul = { carrying: null };
    g.fixtureWorks.sync(g.episode.fixtures, g.time, true, g.episode.placements);
    if (!placement) {
      g.fx.poof(new THREE.Vector3(FIXTURES[id].home.x, 0.8, FIXTURES[id].home.z));
      g.sound.place(); setTimeout(() => g.sound.chime(), 350);
    }
    g.residents.sync(g.episode, g.layout, g.time, true);
    g.save();
    const line = result.reactions.map(r => r.line).join(" ");
    g.showStory(`${FIXTURES[id].built} ${line}`, 7200);
    this.stage = "reacting"; this.stageT = 0;
    this.mouse.setMode("idle", g.time);
    this.refreshShelf();
    g.refreshForageUi();
    g.trackForage(id, result.reactions.map(r => `${r.guest}:${r.routine}`).join(","));
  }

  // ------------------------------------------------------------------ stop-motion render at 12 fps
  step12(t: number) {
    if (!this.active) return;
    const m = this.mouse;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    m.baseY = 0;
    m.update(t);
    if (this.carried && this.carried.group.parent !== m.root) {
      // rolling spool: sits just ahead of the proprietor and turns as it goes
      const ahead = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(1.05);
      this.carried.group.position.set(this.pos.x + ahead.x, DESK_Y, this.pos.z + ahead.z);
      this.carried.group.rotation.set(0, this.yaw, 0);
      this.carried.spin.rotation.set(this.rollAngle, 0, 0);
    }
  }

  dispose() {
    this.mirror.dispose();
    this.g.world.scene.remove(this.shelf.group, this.mouse.root, this.marker);
  }
}

