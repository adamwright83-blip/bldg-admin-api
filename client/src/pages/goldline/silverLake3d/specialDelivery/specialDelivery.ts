import * as THREE from "three";
import type { CourtyardActivityApi, SilverLakeHandle } from "../silverLakeRuntime";
import { COURSE, PLANE_X } from "./deliveryCourse";
import {
  MAX_PULL,
  MIN_PULL,
  STEP,
  createWorld,
  launch,
  setWings,
  step,
  simulate,
  type FanSetting,
  type FlightInput,
  type V2,
  type WorldEvent,
  type WorldState,
} from "./deliveryPhysics";
import { OFFSET, buildDeliveryScene, gliderMesh, toWorld, type AimView } from "./deliveryScene";
import { loadRookPuppet, type RookPuppet, type RookState } from "./rookPuppet";
import { loadBella, loadCleo, type BellaPuppet, type CleoPuppet } from "./courtyardFolk";
import { createDeliveryAudio } from "./deliveryAudio";
import { LINES, pickLine, type LineKey } from "./rookLines";
import {
  discoveriesFromFlight,
  rememberedBefore,
  type CourtyardDiscoveries,
  type CourtyardObservation,
  type DiscoveryId,
} from "@shared/courtyardDiscoveries";

/**
 * SPECIAL DELIVERY: Rook's airmail station in the Silver Lake courtyard.
 *
 * Bella ordered a replacement bicycle bell. Rook has volunteered to deliver it across the courtyard by paper glider.
 * The player works his machine: drag back to aim, release to launch, hold to open the wings, let go to dive.
 *
 * The glider, the fan, the line, the cups, Cleo's tail and Rook's reach are one deterministic simulation
 * (deliveryPhysics.ts). Everything that "happens" is an event the simulation reports; the reactions and authored payoffs
 * here only ever respond to those. Nothing here touches a customer, a message or money: this is the fiction layer, and
 * the only thing it remembers is what physically happened in the courtyard.
 */

export type ControlMode = "hold" | "toggle";
export type EnvelopeKind = "none" | "waiting";

export type SpecialDeliveryCallbacks = {
  onObserve(obs: CourtyardObservation): void;
  onNearStation(near: boolean): void;
  onEngaged(engaged: boolean): void;
  onEnvelope(visible: boolean): void;
  onOpenEnvelope(): void;
  onLine?(line: { who: "rook"; text: string } | null): void;
  /** the first-visit establishing look at the course is on screen (the page keeps its panels out of the way) */
  onShowcase?(on: boolean): void;
};

export type SpecialDeliveryController = {
  enter(): void;
  exit(): void;
  engaged(): boolean;
  setMemory(memory: CourtyardDiscoveries): void;
  setEnvelope(kind: EnvelopeKind): void;
  setControlMode(mode: ControlMode): void;
  /** keyboard and accessibility: a launch at an angle (deg) and a pull from 0..1 */
  aimBy(deltaAngleDeg: number, deltaPower: number): void;
  launchNow(): void;
  setWingsHeld(open: boolean): void;
  dispose(): void;
};

const STATION_REACH = 3.4;
/** the plaza's east lamp post (three.js x, z): it stands between the delivery camera and the course */
const EAST_LAMP = { x: 8.9, z: 0 };
/** Rook, his station, the fan and the watering can (sim x, y), for his own moments */
const STATION_SHOT = { x0: COURSE.station.x1 + 2.6, x1: COURSE.rook.x - 1.3, y0: -0.3, y1: 3.4 };
// in portrait the camera has to stand far back across the plaza: the fountain and the bench by it step aside
const PLAZA_FOUNTAIN = { x: 0.3, z: -0.6, r: 3.4, match: /water|stone|fountain/i };
const PLAZA_BENCH = { x: 4.7, z: -1.6, r: 1.8, match: /bench/i };
const RESET_AFTER_MISS = 1.25;
const RESET_AFTER_CATCH = 1.0;

export async function mountSpecialDelivery(
  handle: SilverLakeHandle,
  opts: { memory: CourtyardDiscoveries; visitStartedAt: number; callbacks: SpecialDeliveryCallbacks; arriveFacingStation?: boolean }
): Promise<SpecialDeliveryController> {
  const cb = opts.callbacks;
  let memory = opts.memory;
  const visitStartedAt = opts.visitStartedAt;
  let api!: CourtyardActivityApi;
  let disposed = false;

  // assets first (Rook's atlases, Cleo's and Bella's cards); the activity mounts once they are in
  const [rook, cleo, bella] = await Promise.all([loadRookPuppet(), loadCleo(COURSE, false), loadBella(COURSE)]);
  const audio = createDeliveryAudio();

  let controller!: SpecialDeliveryController;
  /** when the first-visit establishing shot of the course begins (ms, performance clock); 0 = none */
  let showcaseAt = 0;
  const unmount = handle.mountActivity(a => {
    api = a;
    const activity = createActivity();
    return activity;
  });

  function createActivity() {
    const scene3d = buildDeliveryScene(api, COURSE);
    scene3d.root.add(rook.group, cleo.group, cleo.tail, cleo.tailInk, bella.group);
    // in front of his table and just right of it, so the station never hides him from the raised camera
    const rookHome = toWorld(COURSE.rook.x - 0.1, 0, -0.62);
    rook.group.position.copy(rookHome);
    rook.play("fold", { facing: "left" });
    // A first visit to the airmail (and no deep link to a customer): she arrives at the east edge of the plaza, facing
    // the odd contraption by the yellow cottage, so the station, Rook and Bella's balcony are in view when the opening
    // camera settles. Later visits keep the courtyard's usual arrival.
    if (opts.arriveFacingStation) {
      const station = toWorld((COURSE.station.x0 + COURSE.station.x1) / 2, 0);
      const at = api.b2t(4.6, -3.2);
      api.placeHero(at, Math.atan2(station.x - at.x, station.z - at.z), { behind: true });
      // and, once the courtyard's opening camera has landed, one quiet look at the whole course: Rook at his
      // station, the line and its cups, Cleo asleep, Bella waiting on her balcony. Any key or touch ends it.
      showcaseAt = performance.now() + 2600;
    }

    // ------------------------------------------------------------ the world and its clock
    let world: WorldState = createWorld(COURSE, memory.fan as FanSetting);
    let accumulator = 0;
    let eventCursor = 0;
    let flightNo = 0;
    let flightId = "";
    let flightInput: FlightInput = { pull: { x: 0, y: 0 }, wings: [] };
    let launchStep = 0;
    let lastFlight: FlightInput | null = null;
    let replayWings: FlightInput["wings"] = [];
    let bellTaken = false;
    let portraitGhosts = false;
    let rookEagerCountdown = 2; // Rook keeps his wings to himself for the first flights of a visit

    // ------------------------------------------------------------ the episode state
    type Phase = "walking" | "entering" | "intro" | "ready" | "aiming" | "flying" | "result" | "payoff" | "orchestra";
    let phase: Phase = "walking";
    let engaged = false;
    let controlMode: ControlMode = "hold";
    let aim: { pull: V2 } | null = null;
    let lastTensionStep = -1;
    let resultAt = 0;
    let resultKind: "delivered" | "missed" | "caught" = "missed";
    let envelope: EnvelopeKind = "none";
    let envelopeOffered = false;
    let now = 0;
    let sequence: { start: number; cues: { at: number; run: () => void; done?: boolean }[] } | null = null;
    let shake = 0;
    let saidThisVisit = new Set<string>();
    let lastLineAt = -99;
    let idleSince = 0;
    let wingsHeldByKey = false;
    let wingsHeldByPointer = false;
    const discoveredThisVisit = new Set<DiscoveryId>();

    // ------------------------------------------------------------ the envelope and the orchestra sign (3D)
    const envGroup = new THREE.Group();
    const envTex = envelopeTexture();
    const envMat = new THREE.MeshBasicMaterial({ map: envTex, toneMapped: false, side: THREE.DoubleSide });
    api.noOutline(envMat);
    const envMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.28), envMat);
    envMesh.rotation.x = -Math.PI / 2.4;
    envMesh.rotation.z = Math.PI / 2;
    envGroup.add(envMesh);
    envGroup.position.copy(toWorld(COURSE.station.x0 + 0.12, COURSE.station.top + 0.04, -0.18));
    envGroup.visible = false;
    scene3d.root.add(envGroup);

    const orchestraSign = signMesh("ROOK'S COURTYARD ORCHESTRA", "ONE PERFORMANCE ONLY", api);
    orchestraSign.position.copy(toWorld(-0.3, 0.55, -0.55));
    orchestraSign.visible = false;
    scene3d.root.add(orchestraSign);

    // the crumpled first draft (intro) and a leaf (orchestra encore)
    const paperBall = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 1), new THREE.MeshToonMaterial({ color: 0xfbf6ec }));
    paperBall.visible = false;
    scene3d.root.add(paperBall);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), new THREE.MeshToonMaterial({ color: 0x8fbf5a, side: THREE.DoubleSide }));
    leaf.visible = false;
    scene3d.root.add(leaf);
    const drops = Array.from({ length: 8 }, () => {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0x9fd6f5 }));
      d.visible = false;
      scene3d.root.add(d);
      return { d, v: new THREE.Vector3() };
    });

    // windows that open on the bell, and two birds on the teal roof
    const shutters = buildShutters(api, scene3d.root);
    const birds = buildBirds(api, scene3d.root);

    // ------------------------------------------------------------ speech bubble over Rook (DOM, readable, accessible)
    const bubble = document.createElement("div");
    bubble.className = "sd-bubble";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    bubble.style.opacity = "0";
    api.container.appendChild(bubble);
    let bubbleUntil = 0;
    function say(text: string, ms = 2400) {
      bubble.textContent = text;
      bubble.style.opacity = "1";
      bubbleUntil = now + ms / 1000;
      lastLineAt = now;
      cb.onLine?.({ who: "rook", text });
    }
    function sayLine(key: LineKey, ms?: number, opts: { once?: boolean } = {}) {
      if (opts.once && saidThisVisit.has(key)) return;
      saidThisVisit.add(key);
      const text = pickLine(key);
      if (text) say(text, ms ?? Math.max(1800, 900 + text.length * 45));
    }

    // ------------------------------------------------------------ remembered things, shown on later visits
    function applyMemory() {
      orchestraSign.visible = rememberedBefore(memory.beats.orchestra_performed ?? memory.discoveries.three_cups?.firstAt, visitStartedAt);
      const improved = Boolean(memory.beats.improvements_unveiled);
      scene3d.showSecondBand(improved);
      world.fan = memory.fan as FanSetting;
    }
    applyMemory();

    // ------------------------------------------------------------ input
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const planeHit = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), PLANE_X);
    let pointerId: number | null = null;
    let pressAt: V2 | null = null;

    function toSim(e: PointerEvent | { clientX: number; clientY: number }): V2 | null {
      const rect = api.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, api.camera);
      if (!raycaster.ray.intersectPlane(plane, planeHit)) return null;
      return { x: -(planeHit.z - OFFSET), y: planeHit.y };
    }
    function hitObject(e: PointerEvent, objects: THREE.Object3D[]) {
      const rect = api.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, api.camera);
      return raycaster.intersectObjects(objects, true).length > 0;
    }

    const onPointerDown = (e: PointerEvent) => {
      if (disposed) return;
      audio.unlock();
      if (showcasing || showcaseAt) endShowcase();
      if (!engaged) {
        // walking: a tap on the station, Rook or the envelope is an invitation, nothing more
        if (hitObject(e, [scene3d.root.getObjectByName("special-delivery")!, rook.group])) {
          const dist = api.hero().position.distanceTo(scene3d.stationWorld());
          if (dist < 9) controller.enter();
        }
        return;
      }
      e.preventDefault();
      if (envelope === "waiting" && envGroup.visible && hitObject(e, [envGroup])) {
        cb.onOpenEnvelope();
        return;
      }
      if (phase === "intro") {
        skipSequence();
        return;
      }
      if (phase === "ready" && hitObject(e, [fanPickTarget()])) {
        turnFan();
        return;
      }
      if (phase === "ready") {
        const p = toSim(e);
        if (!p) return;
        pointerId = e.pointerId;
        api.canvas.setPointerCapture?.(e.pointerId);
        pressAt = p;
        aim = { pull: { x: 0, y: 0 } };
        phase = "aiming";
        rook.play("brace", { facing: "left", hold: true });
        idleSince = now;
        return;
      }
      if (phase === "flying") {
        if (controlMode === "toggle") applyWings(!world.wingOpen);
        else {
          wingsHeldByPointer = true;
          applyWings(true);
        }
        return;
      }
      if (phase === "result" && resultKind !== "delivered" && now - resultAt > 0.35) {
        resetGlider();
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (phase !== "aiming" || e.pointerId !== pointerId || !pressAt) return;
      const p = toSim(e);
      if (!p) return;
      // drag back from where you pressed: the pull is the reverse of the drag, held to the elastic's reach
      let pull = { x: pressAt.x - p.x, y: pressAt.y - p.y };
      const l = Math.hypot(pull.x, pull.y);
      if (l > MAX_PULL) pull = { x: (pull.x / l) * MAX_PULL, y: (pull.y / l) * MAX_PULL };
      // the rail aims across the courtyard, never back at Rook or down into the table
      const ang = Math.atan2(pull.y, pull.x);
      const clampedAng = Math.max(0.09, Math.min(1.5, ang));
      const ll = Math.min(MAX_PULL, Math.hypot(pull.x, pull.y));
      pull = { x: Math.cos(clampedAng) * ll, y: Math.sin(clampedAng) * ll };
      aim = { pull };
      const tension = ll / MAX_PULL;
      const stepNo = Math.floor(tension * 8);
      if (stepNo !== lastTensionStep) {
        if (stepNo > lastTensionStep) audio.stretch(tension);
        lastTensionStep = stepNo;
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (phase === "flying" && controlMode === "hold" && wingsHeldByPointer) {
        wingsHeldByPointer = false;
        if (!wingsHeldByKey) applyWings(false);
      }
      if (phase !== "aiming" || e.pointerId !== pointerId) return;
      pointerId = null;
      const pull = aim?.pull ?? { x: 0, y: 0 };
      if (Math.hypot(pull.x, pull.y) < MIN_PULL) {
        // too small a pull is a change of mind, never a launch
        aim = null;
        phase = "ready";
        lastTensionStep = -1;
        rook.play("idle", { facing: "left" });
        return;
      }
      doLaunch(pull);
    };
    const onKey = (e: KeyboardEvent, down: boolean) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "BUTTON" || t.isContentEditable)) return;
      if (!engaged) {
        if (down && (showcasing || showcaseAt)) endShowcase();
        if (down && (e.code === "KeyE" || e.code === "Enter") && nearStation) {
          controller.enter();
          e.preventDefault();
        }
        return;
      }
      if (e.code === "Escape" && down) {
        controller.exit();
        return;
      }
      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (!down) {
          if (phase === "flying" && controlMode === "hold") {
            wingsHeldByKey = false;
            if (!wingsHeldByPointer) applyWings(false);
          }
          return;
        }
        if (e.repeat) return;
        audio.unlock();
        if (phase === "intro") return skipSequence();
        if (phase === "ready" || phase === "aiming") return controller.launchNow();
        if (phase === "flying") {
          if (controlMode === "toggle") applyWings(!world.wingOpen);
          else {
            wingsHeldByKey = true;
            applyWings(true);
          }
          return;
        }
        if (phase === "result" && resultKind !== "delivered") resetGlider();
        return;
      }
      if (!down) return;
      if (e.code === "ArrowLeft") (controller.aimBy(4, 0), e.preventDefault());
      if (e.code === "ArrowRight") (controller.aimBy(-4, 0), e.preventDefault());
      if (e.code === "ArrowUp") (controller.aimBy(0, 0.06), e.preventDefault());
      if (e.code === "ArrowDown") (controller.aimBy(0, -0.06), e.preventDefault());
      if (e.code === "KeyF" && phase === "ready") turnFan();
    };
    const onKeyDown = (e: KeyboardEvent) => onKey(e, true);
    const onKeyUp = (e: KeyboardEvent) => onKey(e, false);
    api.canvas.addEventListener("pointerdown", onPointerDown);
    api.canvas.addEventListener("pointermove", onPointerMove);
    api.canvas.addEventListener("pointerup", onPointerUp);
    api.canvas.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    function fanPickTarget() {
      return scene3d.fanGroup;
    }

    function applyWings(open: boolean) {
      if (world.phase !== "flying" || world.wingOpen === open) return;
      setWings(world, open);
      flightInput.wings.push({ at: world.step - launchStep, open });
      audio.wings(open);
    }

    function doLaunch(pull: V2, fromRest = false) {
      // a new glider: the flight is a fresh world sharing the environment's state (or, for a replay from rest, a
      // settled courtyard exactly like simulate()'s)
      const fresh = createWorld(COURSE, world.fan);
      if (!fromRest) {
        fresh.cat = world.cat;
        fresh.cups = world.cups;
        fresh.lineSag = world.lineSag;
        fresh.lineSagV = world.lineSagV;
        fresh.sheets = world.sheets;
        fresh.rook.eager = rookEagerCountdown <= 0;
      }
      fresh.t = 0;
      world = fresh;
      replayWings = [];
      eventCursor = 0;
      if (!launch(world, COURSE, pull)) return;
      flightNo++;
      flightId = `f${Date.now().toString(36)}${flightNo}`;
      flightInput = { pull: { ...pull }, wings: [] };
      launchStep = world.step;
      aim = null;
      phase = "flying";
      lastTensionStep = -1;
      const power = Math.hypot(pull.x, pull.y) / MAX_PULL;
      audio.launch(power);
      rook.play(power > 0.8 ? "brace" : "point", { facing: "left", restart: true });
      if (wingsHeldByPointer || wingsHeldByKey) applyWings(true);
      rookEagerCountdown--;
    }

    function resetGlider() {
      const fresh = createWorld(COURSE, world.fan);
      fresh.cat = world.cat;
      fresh.cups = world.cups;
      fresh.lineSag = world.lineSag;
      fresh.lineSagV = world.lineSagV;
      fresh.sheets = world.sheets;
      fresh.t = world.t;
      world = fresh;
      eventCursor = 0;
      phase = "ready";
      idleSince = now;
      rook.play("idle", { facing: "left" });
      wingsHeldByKey = wingsHeldByPointer = false;
      scene3d.popGlider();
    }

    function turnFan() {
      if (!memory.discoveries.first_delivery && !discoveredThisVisit.has("first_delivery")) {
        sayLine("fan_locked", 2000);
        return;
      }
      const order: FanSetting[] = ["up", "forward", "back"];
      const next = order[(order.indexOf(world.fan) + 1) % order.length];
      world.fan = next;
      memory = { ...memory, fan: next };
      audio.click();
      cb.onObserve({ kind: "fan", setting: next });
      sayLine(next === "up" ? "fan_up" : next === "forward" ? "fan_forward" : "fan_back", 1700);
    }

    // ------------------------------------------------------------ reactions to what the world reports
    function react(ev: WorldEvent) {
      switch (ev.kind) {
        case "fan_enter":
          audio.flutter(1);
          break;
        case "fan_exit":
          audio.flutter(0);
          if (ev.rise > 1.2) rook.play("point", { facing: "left", restart: true });
          break;
        case "bell":
          audio.jingle(ev.strength);
          break;
        case "line_bounce":
          audio.rope(Math.min(1, ev.speed / 6));
          shake = Math.max(shake, 0.04);
          break;
        case "line_skim_start":
          audio.skim(true);
          rook.play("wait", { facing: "left", restart: true });
          break;
        case "sheet":
          audio.cloth(Math.min(1, ev.speed / 6));
          break;
        case "sheet_caught":
          break;
        case "cup":
          audio.cup(ev.index, Math.min(1, 0.5 + ev.speed / 8));
          scene3d.ringCup(ev.index);
          break;
        case "cat_near":
          cleo.twitch();
          break;
        case "cat_bell":
          cleo.look("one", 1500);
          audio.meow("mrrp");
          break;
        case "cat_hit":
          audio.thud(ev.speed);
          audio.meow(ev.speed > 4 ? "indignant" : "mrrp");
          shake = Math.max(shake, 0.05);
          break;
        case "cat_tail_land":
          audio.pat();
          cleo.look("open", 600);
          break;
        case "cat_fling":
          audio.whoosh();
          audio.meow("indignant");
          break;
        case "cat_tail":
          audio.whap();
          break;
        case "rook_reach":
          rook.play(ev.toward.y > 1.9 ? "catch" : "lunge", { facing: "left", restart: true });
          break;
        case "rook_catch":
          audio.pat();
          break;
        case "rook_flick":
          audio.whap();
          rook.play("flick", { facing: "left", restart: true });
          break;
        case "rook_miss":
          rook.play("lunge", { facing: "left", restart: true });
          break;
        case "wall":
        case "rim":
          audio.clonk();
          shake = Math.max(shake, 0.05);
          break;
        case "bella":
          bella.setPose("selected");
          bella.hop();
          break;
        case "balcony":
          audio.thud(2);
          break;
        case "ground":
          audio.thud(ev.speed);
          audio.jingle(0.3);
          break;
        case "basket":
          audio.basket();
          break;
        default:
          break;
      }
    }

    function flightFinished() {
      const outcome = world.outcome ?? "missed";
      resultKind = outcome;
      resultAt = now;
      phase = "result";
      audio.flutter(0);
      const observed = { flightId, delivered: outcome === "delivered", via: [...world.via], cups: [...world.cupSequence] };
      lastFlight = { pull: { ...flightInput.pull }, wings: [...flightInput.wings] };
      cb.onObserve({ kind: "flight", flight: observed });
      const proved = discoveriesFromFlight(observed);
      const firstTimes = proved.filter(id => !memory.discoveries[id] && !discoveredThisVisit.has(id));
      proved.forEach(id => discoveredThisVisit.add(id));
      const cupsInOrder = world.cupSequence.join(",").includes("0,1,2");

      if (outcome === "delivered") {
        const isFirst = firstTimes.includes("first_delivery");
        const catAssist = world.via.includes("tail");
        if (cupsInOrder && !memory.beats.orchestra_performed) return startOrchestra(true, true);
        return startPayoff({ first: isFirst, catAssist, firstCat: firstTimes.includes("cat_assist") });
      }
      if (cupsInOrder) return startOrchestra(!memory.beats.orchestra_performed, false);
      // a miss: something quick and funny, then straight back to ready
      const where = world.restWhere;
      if (outcome === "caught") {
        rook.play("catch", { facing: "left", restart: true, then: () => rook.play("talk", { facing: "front" }) });
        sayLine("caught", 1500);
        return;
      }
      if (world.via.includes("rook_flick")) sayLine("flick_missed", 1700);
      else if (where === "away") sayLine("away", 1800);
      else if (world.events.some(e => e.kind === "sheet_caught")) sayLine("laundry", 1700);
      else if (where === "balcony") {
        bella.setPose("selected");
        sayLine("balcony", 1700);
      } else if (world.via.includes("cat")) {
        sayLine(saidThisVisit.has("cat_first") ? "cat_again" : "cat_first", 2000);
        saidThisVisit.add("cat_first");
      } else if (world.cupSequence.length >= 2) sayLine("two_cups", 1500);
      else if (Math.random() < 0.6) sayLine("miss", 1500);
      rook.play("shrug", { facing: "left", restart: true, then: () => rook.play("idle", { facing: "left" }) });
    }

    // ------------------------------------------------------------ authored sequences
    function startSequence(cues: { at: number; run: () => void }[], kind: Phase) {
      sequence = { start: now, cues: cues.map(c => ({ ...c })) };
      phase = kind;
    }
    function skipSequence() {
      if (!sequence) return;
      for (const c of sequence.cues) if (!c.done) {
        c.done = true;
        try {
          c.run();
        } catch {
          /* a skipped beat is fine */
        }
      }
      sequence = null;
      if (phase === "intro") toReady();
    }
    function toReady(line?: LineKey) {
      sequence = null;
      camFocus = null;
      bellTaken = false;
      bella.holdBell(false);
      if (bella.pose !== "idle") setTimeout(() => !disposed && phase !== "payoff" && bella.setPose("idle"), 1600);
      resetGlider();
      if (line) sayLine(line);
      offerEnvelopeIfAny();
    }

    function startIntro() {
      // Rook is folding; the first try is a crumpled ball; he notices you; it goes in the watering can
      const ball = () => {
        paperBall.visible = true;
        paperBall.position.copy(rook.group.position).add(new THREE.Vector3(-0.1, 0.9, -0.25));
      };
      startSequence(
        [
          // close on Rook and his station for his routine; the test ding lets the camera go, so the whole course
          // (and Cleo opening one eye) is in view for "Aim for the basket"
          { at: 0.0, run: () => ((camFocus = STATION_SHOT), rook.play("fold", { facing: "left" })) },
          { at: 0.9, run: () => (ball(), rook.play("hide", { facing: "left", restart: true })) },
          { at: 1.7, run: () => (paperBall.visible = false, rook.play("talk", { facing: "front" }), say(LINES.intro_plan[0], 2100)) },
          { at: 3.9, run: () => (ball(), rook.play("shrug", { facing: "front", restart: true })) },
          { at: 4.6, run: () => say(LINES.intro_working[0], 2000) },
          { at: 6.4, run: () => (rook.play("toss", { facing: "left", restart: true }), throwBall()) },
          { at: 7.6, run: () => rook.play("idle", { facing: "front" }) },
          { at: 8.3, run: () => rook.play("letter", { facing: "left", restart: true }) },
          { at: 9.1, run: () => ((camFocus = null), scene3d.popGlider(), audio.testDing(), cleo.look("one", 1900)) },
          { at: 9.9, run: () => rook.play("idle", { facing: "left" }) },
          { at: 10.6, run: () => (rook.play("talk", { facing: "front" }), say(LINES.intro_aim[0], 2600)) },
          { at: 12.6, run: () => (cb.onObserve({ kind: "beat", beat: "intro_seen" }), memory = { ...memory, beats: { ...memory.beats, intro_seen: new Date().toISOString() } }, toReady()) },
        ],
        "intro"
      );
    }
    let ballFlight: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null = null;
    function throwBall() {
      paperBall.visible = true;
      const from = rook.group.position.clone().add(new THREE.Vector3(0, 1.3, -0.2));
      ballFlight = { from, to: scene3d.canWorld().clone().add(new THREE.Vector3(0, 0.18, 0)), t: 0 };
    }

    function startPayoff(o: { first: boolean; catAssist: boolean; firstCat: boolean }) {
      const cues: { at: number; run: () => void }[] = [];
      const balconyShot = { x0: COURSE.balcony.x1 + 0.9, x1: COURSE.basket.x - 1.5, y0: COURSE.balcony.floor - 1.0, y1: COURSE.balcony.floor + 1.9 };
      const bellToHand = () => {
        bellTaken = true;
        bella.holdBell(true);
        bella.hop();
      };
      const ringOnce = (big: boolean) => {
        bella.ringBell(big);
        bella.hop();
        // on the ring the camera lets go of the balcony, so the whole courtyard can be seen to react
        camFocus = null;
        audio.bigBell(big ? 3.2 : 1.8);
        shake = Math.max(shake, big ? 0.12 : 0.06);
        cleo.sitUp(big ? 2600 : 1600);
        rook.play("ears", { facing: "front" });
      };
      if (o.catAssist && o.firstCat) {
        cues.push(
          { at: 0.3, run: () => rook.play("point", { facing: "left", restart: true }) },
          { at: 1.1, run: () => say(LINES.cat_assist_first[0], 2400) }
        );
      }
      const t0 = o.catAssist && o.firstCat ? 2.2 : 0;
      // hold on the balcony from the landing until the ring
      cues.push({ at: t0, run: () => (camFocus = balconyShot) });
      if (o.first) {
        cues.push(
          // a small silence: she takes the bell, holds it up, looks at it
          { at: t0 + 0.9, run: bellToHand },
          { at: t0 + 1.9, run: () => rook.play("idle", { facing: "left" }) },
          { at: t0 + 2.6, run: () => ringOnce(true) },
          { at: t0 + 2.85, run: () => shutters.open(0, audio) },
          { at: t0 + 3.05, run: () => birds.fly(audio) },
          { at: t0 + 3.15, run: () => shutters.open(1, audio) },
          { at: t0 + 3.3, run: () => audio.meow("indignant") },
          { at: t0 + 3.45, run: () => shutters.open(2, audio) },
          { at: t0 + 3.6, run: () => shutters.dropPaper(audio) },
          { at: t0 + 4.4, run: () => say(LINES.bell_first[0], 2300) },
          { at: t0 + 6.4, run: () => ringOnce(false) },
          { at: t0 + 6.55, run: () => shutters.slam(audio) },
          { at: t0 + 6.7, run: () => audio.meow("mrrp") },
          { at: t0 + 8.0, run: () => (bella.setPose("selected"), rook.play("talk", { facing: "front" }), say(LINES.next_delivery[0], 1800)) },
          { at: t0 + 9.6, run: () => (shutters.reset(), toReady()) }
        );
      } else {
        cues.push(
          { at: t0 + 0.7, run: bellToHand },
          { at: t0 + 1.4, run: () => ringOnce(false) },
          { at: t0 + 1.6, run: () => (Math.random() < 0.5 ? shutters.open(Math.floor(Math.random() * 3), audio) : birds.fly(audio)) },
          { at: t0 + 2.6, run: () => sayLine("bell_again") },
          { at: t0 + 4.4, run: () => (bella.setPose("selected"), shutters.reset(), toReady()) }
        );
      }
      startSequence(cues, "payoff");
    }

    let conductBeat = -1;
    function startOrchestra(firstTime: boolean, delivered: boolean) {
      if (!firstTime) {
        // the reprise: three notes, a nod, back to work
        startSequence(
          [
            { at: 0.4, run: () => [0, 1, 2].forEach((i, k) => setTimeout(() => (audio.chord(i), scene3d.ringCup(i)), k * 260)) },
            { at: 1.4, run: () => (rook.play("bow", { facing: "front", restart: true }), sayLine("orchestra_again")) },
            { at: 3.2, run: () => (delivered ? startPayoff({ first: false, catAssist: false, firstCat: false }) : toReady()) },
          ],
          "orchestra"
        );
        return;
      }
      const stand = toWorld(COURSE.cups[1].anchor.x, 0, -0.7);
      walkTarget = stand;
      conductBeat = -1;
      startSequence(
        [
          // the courtyard holds its breath for a beat
          { at: 0.0, run: () => (audio.fanHum(false), rook.play("walk", { facing: "left" })) },
          { at: 1.6, run: () => (rook.play("conduct", { facing: "front" }), (conductBeat = 0)) },
          { at: 2.1, run: () => (audio.chord(0), scene3d.ringCup(0)) },
          { at: 2.65, run: () => (audio.chord(1), scene3d.ringCup(1)) },
          { at: 3.2, run: () => (audio.chord(2), scene3d.ringCup(2)) },
          { at: 3.75, run: () => (audio.chord(0), scene3d.ringCup(0)) },
          { at: 4.3, run: () => (audio.chord(1), scene3d.ringCup(1)) },
          // the finale... and Cleo, at exactly the wrong moment
          { at: 4.85, run: () => (audio.meow("indignant"), cleo.sitUp(1500)) },
          { at: 4.9, run: () => rook.freeze() },
          { at: 5.8, run: () => say(LINES.orchestra_finale[0], 2000) },
          { at: 7.4, run: () => (rook.play("bow", { facing: "front", restart: true }), audio.finale()) },
          { at: 8.2, run: () => (shutters.open(0, audio), shutters.open(2, audio)) },
          { at: 8.7, run: () => dropLeaf() },
          { at: 10.2, run: () => (shutters.reset(), (walkTarget = rookHome), rook.play("walk", { facing: "right" })) },
          {
            at: 11.6,
            run: () => {
              cb.onObserve({ kind: "beat", beat: "orchestra_performed" });
              memory = { ...memory, beats: { ...memory.beats, orchestra_performed: new Date().toISOString() } };
              audio.fanHum(true);
              if (delivered) startPayoff({ first: !memory.discoveries.first_delivery && !discoveredThisVisit.has("first_delivery") ? true : false, catAssist: false, firstCat: false });
              else toReady();
            },
          },
        ],
        "orchestra"
      );
    }
    let walkTarget: THREE.Vector3 | null = null;
    let leafT = -1;
    function dropLeaf() {
      leaf.visible = true;
      leafT = 0;
    }

    function offerEnvelopeIfAny() {
      const show = envelope === "waiting" && (memory.discoveries.first_delivery || discoveredThisVisit.has("first_delivery"));
      envGroup.visible = Boolean(show);
      cb.onEnvelope(Boolean(show));
      if (show && !envelopeOffered && engaged) {
        envelopeOffered = true;
        setTimeout(() => {
          if (disposed || phase !== "ready") return;
          rook.play("confide", { facing: "front" });
          sayLine("envelope_offer", 3000, { once: true });
          cb.onObserve({ kind: "beat", beat: "desk_offered" });
          setTimeout(() => !disposed && phase === "ready" && rook.play("idle", { facing: "left" }), 3000);
        }, 900);
      }
    }

    // ------------------------------------------------------------ camera
    const camPos = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    let camBlend = 0;
    /** a closer box (sim coordinates) a sequence holds, e.g. Bella's balcony while the bell is rung; null is the course */
    let camFocus: { x0: number; x1: number; y0: number; y1: number } | null = null;
    let walkHeroBefore: { position: THREE.Vector3; heading: number } | null = null;
    function framing(out: { pos: THREE.Vector3; look: THREE.Vector3 }, follow: V2 | null) {
      const cam = api.camera;
      const aspect = cam.aspect || 1.6;
      // the box to keep in view: station and Rook, the balcony and the basket, ground to the line
      let x0 = COURSE.basket.x + 2.0; // sim x: Bella's side, her whole balcony and a bit of the yellow cottage
      let x1 = COURSE.rook.x - 1.4; // sim x: Rook's side, with room for what he says
      let y0 = -0.2;
      let y1 = 5.2;
      const portrait = aspect < 1;
      // a phone held upright: just the station to Bella, no spare cottage either side
      if (portrait) {
        x0 = COURSE.basket.x + 1.25;
        x1 = COURSE.rook.x - 0.7;
      }
      if (camFocus && !follow) ({ x0, x1, y0, y1 } = camFocus);
      if (follow) {
        // in flight: lean in on the glider and the basket, never closer than 7 m across, the basket always in frame
        x0 = Math.max(COURSE.basket.x + 1.25, follow.x + 1.4);
        x1 = Math.min(COURSE.basket.x - 1.4, follow.x - 1.6);
        if (x0 - x1 < 7) x1 = x0 - 7;
        y1 = Math.max(4.8, follow.y + 1.0);
      }
      const w = Math.abs(x0 - x1);
      const h = y1 - y0;
      const fov = portrait ? 72 : 48;
      if (Math.abs(cam.fov - fov) > 0.01) {
        cam.fov = fov;
        cam.updateProjectionMatrix();
      }
      const t = Math.tan(THREE.MathUtils.degToRad(fov / 2));
      const d = Math.min(17, Math.max((h / 2) / t, (w / 2) / (t * aspect)) * 1.05);
      // farther back means higher up, so the plaza's fountain stays below the view (and never around the camera)
      const camX = PLANE_X - d;
      // (in portrait the fountain is ghosted, so the camera can stay lower and look at the course square on)
      const lift = portrait ? Math.max(0, d - 8.5) * 0.18 : Math.max(Math.max(0, d - 8.5) * 0.42, Math.abs(camX) < 2.8 ? 1.3 : 0);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2 - (portrait ? 0.4 : 0);
      const center = toWorld(cx, cy);
      out.look.copy(center);
      out.pos.set(PLANE_X - d, cy + 0.6 + lift, center.z);
    }
    const goal = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
    const placeCamera = (camera: THREE.PerspectiveCamera, dt: number) => {
      const follow = phase === "flying" && !api.reduceMotion ? { x: world.p.x, y: world.p.y } : null;
      framing(goal, follow);
      if (camBlend < 1) {
        camBlend = Math.min(1, camBlend + dt / (api.reduceMotion ? 0.01 : 1.15));
        const u = THREE.MathUtils.smootherstep(camBlend, 0, 1);
        camera.position.lerpVectors(camPos, goal.pos, u);
        const look = new THREE.Vector3().lerpVectors(camLook, goal.look, u);
        camera.lookAt(look);
        return;
      }
      const k = 1 - Math.exp(-dt * 3.2);
      camera.position.lerp(goal.pos, k);
      const look = new THREE.Vector3();
      camera.getWorldDirection(look);
      const cur = camera.position.clone().addScaledVector(look, camera.position.distanceTo(goal.look));
      cur.lerp(goal.look, 1 - Math.exp(-dt * 4));
      if (shake > 0.001 && !api.reduceMotion) {
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
      }
      camera.lookAt(cur);
    };

    // ------------------------------------------------------------ walking near the station
    let nearStation = false;
    let showcasing = false;
    let showcaseStart = 0;
    function beginShowcase() {
      showcasing = true;
      cb.onShowcase?.(true);
      showcaseStart = performance.now();
      camPos.copy(api.camera.position);
      const dir = new THREE.Vector3();
      api.camera.getWorldDirection(dir);
      camLook.copy(api.camera.position).addScaledVector(dir, 10);
      camBlend = 0;
      api.overrideCamera(placeCamera);
      api.setVillagersHiddenWhere(p => p.x > PLANE_X - 2.8 && p.x < PLANE_X + 1.2 && Math.abs(p.z - OFFSET) < 8);
      api.setVillagerLabelsHidden(true);
      api.ghostProps(EAST_LAMP.x, EAST_LAMP.z, 0.9, true);
      rook.play("fold", { facing: "left" });
    }
    function endShowcase() {
      showcaseAt = 0;
      if (!showcasing) return;
      showcasing = false;
      cb.onShowcase?.(false);
      if (engaged) return;
      api.overrideCamera(null);
      api.setVillagersHiddenWhere(null);
      api.setVillagerLabelsHidden(false);
      api.ghostProps(EAST_LAMP.x, EAST_LAMP.z, 0.9, false);
    }

    function update(dt: number, elapsed: number) {
      if (disposed) return;
      now = elapsed;
      // fixed steps: the world advances the same way whatever the frame rate
      accumulator = Math.min(accumulator + dt, 0.1);
      while (accumulator >= STEP) {
        accumulator -= STEP;
        // a replayed input opens and folds the wings on its recorded steps, the way simulate() does
        while (replayWings.length && world.phase === "flying" && world.step - launchStep >= replayWings[0].at) applyWings(replayWings.shift()!.open);
        step(world, COURSE);
      }
      while (eventCursor < world.events.length) react(world.events[eventCursor++]);
      if (phase === "flying" && world.phase === "done") flightFinished();

      // sequences
      if (sequence) {
        const t = now - sequence.start;
        for (const c of sequence.cues) {
          if (!c.done && t >= c.at) {
            c.done = true;
            c.run();
          }
        }
      }

      // results that don't have a payoff go back to ready by themselves, fast
      if (phase === "result") {
        const wait = resultKind === "caught" ? RESET_AFTER_CATCH : RESET_AFTER_MISS;
        if (now - resultAt > wait) resetGlider();
      }

      // Rook walks when asked to, otherwise stands at his station
      if (walkTarget) {
        const p = rook.group.position;
        const d = walkTarget.clone().sub(p);
        d.y = 0;
        const l = d.length();
        if (l < 0.05) {
          walkTarget = null;
        } else {
          p.addScaledVector(d.normalize(), Math.min(l, dt * 1.9));
        }
      }

      // idle variety at the ready, never a nag
      if (phase === "ready" && engaged && now - idleSince > 9 && now - lastLineAt > 18) {
        idleSince = now;
        if (Math.random() < 0.5) sayLine("idle");
        else rook.play(Math.random() < 0.5 ? "wait" : "shrug", { facing: "left", restart: true, then: () => rook.play("idle", { facing: "left" }) });
      }
      if (phase === "aiming" && aim) {
        const tension = Math.hypot(aim.pull.x, aim.pull.y) / MAX_PULL;
        rook.scrub("brace", tension, "left");
      }

      // the paper ball into the watering can
      if (ballFlight) {
        ballFlight.t += dt / 0.75;
        const u = Math.min(1, ballFlight.t);
        paperBall.position.lerpVectors(ballFlight.from, ballFlight.to, u);
        paperBall.position.y += Math.sin(u * Math.PI) * 1.1;
        paperBall.rotation.x += dt * 9;
        if (u >= 1) {
          ballFlight = null;
          paperBall.visible = false;
          audio.splash();
          drops.forEach((dr, i) => {
            dr.d.visible = true;
            dr.d.position.copy(scene3d.canWorld()).add(new THREE.Vector3(0, 0.25, 0));
            const a = (i / drops.length) * Math.PI * 2;
            dr.v.set(Math.cos(a) * 0.6, 1.6 + (i % 3) * 0.3, Math.sin(a) * 0.6);
          });
        }
      }
      drops.forEach(dr => {
        if (!dr.d.visible) return;
        dr.v.y -= 9 * dt;
        dr.d.position.addScaledVector(dr.v, dt);
        if (dr.d.position.y < 0.05) dr.d.visible = false;
      });
      if (leafT >= 0) {
        leafT += dt;
        const start = toWorld(COURSE.balcony.x0 + 0.6, 4.4, 0.1);
        leaf.position.copy(start).add(new THREE.Vector3(Math.sin(leafT * 3) * 0.3, -leafT * 0.55, Math.sin(leafT * 1.7) * 0.4));
        leaf.rotation.set(leafT * 2, leafT * 3.1, Math.sin(leafT * 4));
        if (leaf.position.y < 0.05) {
          leafT = -1;
          setTimeout(() => (leaf.visible = false), 1500);
        }
      }

      shake = Math.max(0, shake - dt * 0.35);
      scene3d.tickPop(dt);
      rook.update(dt, api.camera);
      cleo.update(world, dt, elapsed, now * 1000, api.camera);
      bella.update(dt, elapsed, api.camera);
      shutters.update(dt);
      birds.update(dt, world);
      const aimView: AimView = aim ? { pull: aim.pull, tension: Math.hypot(aim.pull.x, aim.pull.y) / MAX_PULL } : null;
      scene3d.sync(world, dt, elapsed, aimView, {
        fan: world.fan,
        showGlow: engaged && !memory.discoveries.first_delivery && !discoveredThisVisit.has("first_delivery"),
        gliderHidden: (phase === "intro" && (sequence ? now - sequence.start < 9.1 : false)) || bellTaken,
      });
      envGroup.rotation.y = Math.sin(elapsed * 2) * 0.04;

      // portrait: the plaza's fountain and bench would stand between the far-back camera and the course
      const wantPortraitGhosts = engaged && (api.camera.aspect || 1.6) < 1;
      if (wantPortraitGhosts !== portraitGhosts) {
        portraitGhosts = wantPortraitGhosts;
        for (const g of [PLAZA_FOUNTAIN, PLAZA_BENCH]) api.ghostProps(g.x, g.z, g.r, portraitGhosts, g.match, 0);
      }

      // bubble follows Rook's head
      if (bubbleUntil && now > bubbleUntil) {
        bubble.style.opacity = "0";
        bubbleUntil = 0;
        cb.onLine?.(null);
      }
      if (bubbleUntil) {
        const head = rook.group.position.clone().add(new THREE.Vector3(0, 1.75, 0)).project(api.camera);
        const rect = api.container.getBoundingClientRect();
        const bw = bubble.offsetWidth || 240;
        const bh = bubble.offsetHeight || 48;
        const hx = ((head.x + 1) / 2) * rect.width;
        const hy = ((1 - head.y) / 2) * rect.height;
        const cx = Math.min(rect.width - 12 - bw / 2, Math.max(12 + bw / 2, hx));
        const cy = Math.max(bh + 14, hy);
        bubble.style.transform = `translate(-50%, -100%) translate(${cx}px, ${cy}px)`;
        bubble.style.setProperty("--tail", `${Math.max(16, Math.min(bw - 16, bw / 2 + (hx - cx)))}px`);
      }

      // the first-visit establishing shot of the course, then back to her
      if (!engaged && showcaseAt) {
        const t = performance.now();
        if (!showcasing && t >= showcaseAt) beginShowcase();
        if (showcasing && t - showcaseStart > 3600) endShowcase();
      }

      // walking: is the hero at the station?
      if (!engaged) {
        const d = api.hero().position.distanceTo(scene3d.stationWorld().setY(0));
        const near = d < STATION_REACH;
        if (near !== nearStation) {
          nearStation = near;
          cb.onNearStation(near);
          if (near && !memory.beats.intro_seen) rook.play("talk", { facing: "front" });
          if (!near) rook.play("fold", { facing: "left" });
        }
      }
    }

    controller = {
      enter() {
        if (engaged || disposed) return;
        const fromShowcase = showcasing;
        showcasing = false;
        showcaseAt = 0;
        engaged = true;
        nearStation = false;
        cb.onNearStation(false);
        cb.onEngaged(true);
        cb.onObserve({ kind: "session" });
        api.lockWalking(true);
        api.setVillagerLabelsHidden(true);
        // the two doorstep neighbours in front of the course step out of the shot, and the plaza's east lamp post
        // (between the camera and the course) turns see-through, while the airmail is open
        api.setVillagersHiddenWhere(p => p.x > PLANE_X - 2.8 && p.x < PLANE_X + 1.2 && Math.abs(p.z - OFFSET) < 8);
        api.ghostProps(EAST_LAMP.x, EAST_LAMP.z, 0.9, true);
        walkHeroBefore = api.hero();
        // the hero steps to the side of the station, just out of the shot, watching the course with Rook
        api.placeHero(toWorld(COURSE.rook.x - 2.2, 0, -1.6), -Math.PI / 2 - 0.4);
        if (!fromShowcase) {
          // glide from wherever the walking camera is; from the establishing shot it is already framed
          camPos.copy(api.camera.position);
          const dir = new THREE.Vector3();
          api.camera.getWorldDirection(dir);
          camLook.copy(api.camera.position).addScaledVector(dir, 10);
          camBlend = 0;
        }
        api.overrideCamera(placeCamera);
        audio.unlock();
        audio.fanHum(true);
        world.fan = memory.fan as FanSetting;
        if (!memory.beats.intro_seen) {
          startIntro();
          return;
        }
        // a later visit: a short, remembered greeting, then straight to it
        const returning = rememberedBefore(memory.discoveries.first_delivery?.firstAt, visitStartedAt);
        let line: LineKey | undefined;
        if (returning && !memory.beats.improvements_unveiled) {
          cb.onObserve({ kind: "beat", beat: "improvements_unveiled" });
          memory = { ...memory, beats: { ...memory.beats, improvements_unveiled: new Date().toISOString() } };
          scene3d.showSecondBand(true);
          startSequence(
            [
              { at: 0.0, run: () => (camFocus = STATION_SHOT) },
              { at: 0.9, run: () => (rook.play("talk", { facing: "front" }), say(LINES.improvements[0], 1800)) },
              { at: 2.8, run: () => rook.play("idle", { facing: "left" }) },
              { at: 3.4, run: () => (rook.play("shrug", { facing: "front", restart: true }), say(LINES.improvements_untested[0], 1900)) },
              { at: 5.4, run: () => toReady() },
            ],
            "intro"
          );
          return;
        }
        if (orchestraSign.visible) line = "orchestra_remembered";
        else if (rememberedBefore(memory.discoveries.cat_assist?.firstAt, visitStartedAt)) line = "cat_remembered";
        else line = "welcome_back";
        if (saidThisVisit.has(line)) line = undefined;
        setTimeout(() => !disposed && toReady(line), api.reduceMotion ? 50 : 1100);
        phase = "entering";
      },
      exit() {
        if (!engaged) return;
        engaged = false;
        skipSequence();
        sequence = null;
        aim = null;
        pointerId = null;
        phase = "walking";
        resetGlider();
        phase = "walking";
        api.overrideCamera(null);
        api.lockWalking(false);
        api.setVillagerLabelsHidden(false);
        api.setVillagersHiddenWhere(null);
        api.ghostProps(EAST_LAMP.x, EAST_LAMP.z, 0.9, false);
        if (walkHeroBefore) api.placeHero(walkHeroBefore.position, walkHeroBefore.heading);
        audio.fanHum(false);
        audio.flutter(0);
        bubble.style.opacity = "0";
        envGroup.visible = envelope === "waiting" && Boolean(memory.discoveries.first_delivery || discoveredThisVisit.has("first_delivery"));
        cb.onEngaged(false);
        rook.play("fold", { facing: "left" });
      },
      engaged: () => engaged,
      setMemory(m) {
        memory = m;
        applyMemory();
      },
      setEnvelope(kind) {
        envelope = kind;
        if (kind === "none") {
          envGroup.visible = false;
          cb.onEnvelope(false);
        } else if (phase === "ready" || phase === "walking") offerEnvelopeIfAny();
      },
      setControlMode(mode) {
        controlMode = mode;
      },
      aimBy(dAngle, dPower) {
        if (!engaged || (phase !== "ready" && phase !== "aiming")) return;
        const cur = aim?.pull ?? { x: Math.cos(0.75) * MAX_PULL * 0.55, y: Math.sin(0.75) * MAX_PULL * 0.55 };
        const ang = Math.max(0.09, Math.min(1.5, Math.atan2(cur.y, cur.x) + THREE.MathUtils.degToRad(dAngle)));
        const pw = Math.max(MIN_PULL + 0.02, Math.min(MAX_PULL, Math.hypot(cur.x, cur.y) + dPower * MAX_PULL));
        aim = { pull: { x: Math.cos(ang) * pw, y: Math.sin(ang) * pw } };
        phase = "aiming";
        audio.stretch(pw / MAX_PULL);
      },
      launchNow() {
        if (!engaged) return;
        if (phase === "ready") controller.aimBy(0, 0);
        if (phase === "aiming" && aim) doLaunch(aim.pull);
      },
      setWingsHeld(open) {
        if (phase === "flying") applyWings(open);
      },
      dispose() {
        unmountAll();
      },
    };

    // dev and capture hooks: these give the same input a player gives (a pull, then wings on given steps) and the
    // simulation decides what happens; nothing here places the glider or picks an outcome
    (window as unknown as { __specialDelivery?: unknown }).__specialDelivery = {
      state: () => ({ phase, engaged, worldPhase: world.phase, outcome: world.outcome, rest: world.restWhere, via: [...world.via], cups: [...world.cupSequence], fan: world.fan, p: { ...world.p }, t: world.t, cat: world.cat.phase }),
      enter: () => controller.enter(),
      exit: () => controller.exit(),
      /** the last flight as it was actually flown: replaying it from rest reproduces it */
      lastFlight: () => lastFlight,
      /**
       * Fly a recorded input: { pull: {x,y}, wings: [{ at: stepAfterLaunch, open }] }. With `fromRest` the courtyard is
       * settled first (cups still, Cleo asleep), so the flight is exactly what `predict` says; without it, the glider
       * meets the courtyard as it is right now, the way a player's next throw does.
       */
      fly(input: FlightInput, opts: { fromRest?: boolean } = {}) {
        if (!engaged) controller.enter();
        if (sequence) skipSequence();
        if (phase !== "ready") resetGlider();
        doLaunch(input.pull, opts.fromRest);
        replayWings = [...input.wings].sort((a, b) => a.at - b.at);
        return phase === "flying";
      },
      /** what this exact input does from a settled courtyard, simulated offline (for tests and captures) */
      predict(input: FlightInput) {
        const w = simulate(COURSE, input, world.fan);
        return { outcome: w.outcome, rest: w.restWhere, via: w.via, cups: w.cupSequence, t: w.t };
      },
      setFan(f: FanSetting) {
        world.fan = f;
      },
      skip: () => skipSequence(),
      /** capture: the screen points of a drag that makes this pull, so a capture can use the real pointer */
      dragFor(pull: V2) {
        const rect = api.canvas.getBoundingClientRect();
        const at = (x: number, y: number) => {
          const v = toWorld(x, y).project(api.camera);
          return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
        };
        const from = { x: COURSE.launch.x + 0.4, y: COURSE.launch.y + 1.4 };
        return { from: at(from.x, from.y), to: at(from.x - pull.x, from.y - pull.y) };
      },
    };

    function unmountAll() {
      unmount();
    }

    return {
      update,
      dispose() {
        disposed = true;
        api.canvas.removeEventListener("pointerdown", onPointerDown);
        api.canvas.removeEventListener("pointermove", onPointerMove);
        api.canvas.removeEventListener("pointerup", onPointerUp);
        api.canvas.removeEventListener("pointercancel", onPointerUp);
        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
        bubble.remove();
        scene3d.dispose();
        rook.dispose();
        cleo.dispose();
        bella.dispose();
        audio.dispose();
        envTex.dispose();
        delete (window as unknown as { __specialDelivery?: unknown }).__specialDelivery;
      },
    };
  }

  return controller;
}

// ---------------------------------------------------------------- small props

function envelopeTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 170;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fbf3df";
  g.fillRect(0, 0, 256, 170);
  g.strokeStyle = "#c9b48a";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(4, 4);
  g.lineTo(128, 96);
  g.lineTo(252, 4);
  g.stroke();
  g.strokeRect(2, 2, 252, 166);
  g.fillStyle = "#9c2b23";
  g.beginPath();
  g.arc(128, 96, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#1f2a3a";
  g.font = "800 22px 'Trebuchet MS', system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText("YOUR BUSINESS", 128, 150);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signMesh(title: string, sub: string, api: CourtyardActivityApi) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 224;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f6e7c8";
  g.fillRect(0, 0, 512, 224);
  g.strokeStyle = "#7b5232";
  g.lineWidth = 10;
  g.strokeRect(5, 5, 502, 214);
  g.fillStyle = "#3b5a8a";
  g.textAlign = "center";
  g.font = "900 40px 'Trebuchet MS', system-ui, sans-serif";
  g.fillText(title.split(" ").slice(0, 2).join(" "), 256, 72);
  g.fillText(title.split(" ").slice(2).join(" "), 256, 120);
  g.fillStyle = "#9c2b23";
  g.font = "800 26px 'Trebuchet MS', system-ui, sans-serif";
  g.fillText(sub, 256, 178);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  api.noOutline(m);
  const group = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.39), m);
  board.position.y = 0.55;
  board.rotation.y = -Math.PI / 2;
  const stake = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 0.04), new THREE.MeshStandardMaterial({ name: "timber", color: 0x7b5232 }));
  stake.position.y = 0.27;
  group.add(board, stake);
  api.stylize(stake);
  return group;
}

function buildShutters(api: CourtyardActivityApi, root: THREE.Group) {
  // The neighbours are napping with their shutters shut. Each pair is mounted flush on a real window of the cottages
  // either side of the course (positions surveyed on the Silver Lake model; sim x, y and depth, and the facade's
  // outward normal), so when the bell goes they are thrown open where the camera can see them.
  const YELLOW_N = new THREE.Vector3(-0.87, 0, 0.5);
  const TEAL_N = new THREE.Vector3(-0.87, 0, -0.5);
  const spots: { x: number; y: number; depth: number; w: number; h: number; normal: THREE.Vector3; color: number; glass: boolean }[] = [
    // the teal cottage's front window, by Rook's station
    { x: -5.68, y: 2.27, depth: 1.18, w: 0.98, h: 0.62, normal: TEAL_N, color: 0xf1e3c2, glass: false },
    // the yellow cottage's window beside the balcony
    { x: 2.2, y: 2.15, depth: 1.31, w: 0.6, h: 0.62, normal: YELLOW_N, color: 0x6fa06a, glass: false },
    // and a little one on the yellow cottage's plaster, left of the balcony (its own frame and glass)
    { x: 4.86, y: 2.5, depth: -0.04, w: 0.52, h: 0.56, normal: YELLOW_N, color: 0x6fa06a, glass: true },
  ];
  const items = spots.map(sp => {
    const unit = new THREE.Group();
    unit.position.copy(toWorld(sp.x, sp.y, sp.depth));
    unit.lookAt(unit.position.clone().add(sp.normal));
    if (sp.glass) {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(sp.w * 0.92, sp.h * 0.92), new THREE.MeshToonMaterial({ name: "window_glass", color: 0x2f4a66 }));
      glass.position.z = 0.005;
      unit.add(glass);
      const frameMat = new THREE.MeshToonMaterial({ name: "window_frame", color: 0xf6ead2 });
      for (const [fw, fh, fx, fy] of [[sp.w + 0.06, 0.05, 0, sp.h / 2], [sp.w + 0.06, 0.07, 0, -sp.h / 2], [0.05, sp.h, -sp.w / 2, 0], [0.05, sp.h, sp.w / 2, 0], [0.03, sp.h, 0, 0]] as const) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.04), frameMat);
        f.position.set(fx, fy, 0.02);
        unit.add(f);
      }
    }
    const panelMat = new THREE.MeshStandardMaterial({ name: "door_shutter", color: sp.color });
    const panels = [-1, 1].map(side => {
      const hinge = new THREE.Group();
      hinge.position.set((side * sp.w) / 2, 0, 0.035);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(sp.w / 2, sp.h, 0.035), panelMat);
      panel.position.x = (-side * sp.w) / 4;
      // two slats so a shutter reads as a shutter
      for (const dy of [-sp.h / 4, sp.h / 4]) {
        const slat = new THREE.Mesh(new THREE.BoxGeometry(sp.w / 2 - 0.06, 0.035, 0.02), panelMat);
        slat.position.set(0, dy, 0.025);
        panel.add(slat);
      }
      hinge.add(panel);
      unit.add(hinge);
      return { hinge, side };
    });
    root.add(unit);
    api.stylize(unit);
    return { panels, target: 0, angle: 0 };
  });
  // a folded newspaper, dropped from the window beside the balcony
  const paper = new THREE.Group();
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.36), new THREE.MeshToonMaterial({ color: 0xf2efe6 }));
  const print = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.05, 0.28), new THREE.MeshToonMaterial({ color: 0x8a8a8a }));
  print.position.y = 0.06;
  paper.add(sheet, print);
  paper.visible = false;
  root.add(paper);
  let paperV = 0;
  let paperSpin = 0;
  return {
    open(i: number, audio: { shutter(): void }) {
      const it = items[i];
      if (!it) return;
      it.target = 2.2;
      audio.shutter();
    },
    slam(audio: { shutter(): void; clonk(): void }) {
      items.forEach(it => (it.target = 0));
      audio.clonk();
    },
    reset() {
      items.forEach(it => (it.target = 0));
    },
    dropPaper(audio: { flop(): void }) {
      paper.visible = true;
      paper.position.copy(toWorld(2.2, 1.95, 0.95));
      paper.rotation.set(0, 0, 0);
      paperV = 0.6;
      paperSpin = 5;
      setTimeout(() => audio.flop(), 520);
    },
    update(dt: number) {
      items.forEach(it => {
        // thrown open with a bounce; slammed shut fast
        const k = 1 - Math.exp(-dt * (it.target === 0 ? 16 : 11));
        it.angle += (it.target - it.angle) * k;
        it.panels.forEach(pn => (pn.hinge.rotation.y = pn.side * it.angle));
      });
      if (paper.visible) {
        paperV -= 8.5 * dt;
        paper.position.y = Math.max(0.03, paper.position.y + paperV * dt);
        if (paper.position.y > 0.03) {
          paper.rotation.z += paperSpin * dt;
          paper.rotation.x = Math.sin(paper.position.y * 6) * 0.5;
        } else {
          paper.rotation.set(0, 0.4, Math.PI / 2);
        }
      }
    },
    hidePaper() {
      paper.visible = false;
    },
  };
}
type ShutterSet = ReturnType<typeof buildShutters>;
void ({} as ShutterSet);

function buildBirds(api: CourtyardActivityApi, root: THREE.Group) {
  // four sparrows napping on the washing line (between the cups and the sheet); a glider that passes close makes one
  // hop off and come back, and the bell sends them all off
  const PERCH = [-4.3, -2.05, 1.55, 2.55];
  const colors = [0x8a6a4a, 0x5f7fa8, 0xa86f4a, 0x6a7f5a];
  const birds = PERCH.map((x, i) => {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshToonMaterial({ color: colors[i] });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 9), bodyMat);
    body.scale.set(1.25, 1, 1);
    body.position.y = 0.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), bodyMat);
    head.position.set(0, 0.2, i % 2 ? 0.08 : -0.08);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.07, 6), new THREE.MeshToonMaterial({ color: 0xf2b84b }));
    beak.rotation.x = i % 2 ? Math.PI / 2 : -Math.PI / 2;
    beak.position.set(0, 0.2, i % 2 ? 0.16 : -0.16);
    const wingMat = new THREE.MeshToonMaterial({ color: 0x3b2a1e });
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.22), wingMat);
    wingL.position.set(0.05, 0.14, 0);
    const wingR = wingL.clone();
    wingR.position.x = -0.05;
    g.add(body, head, beak, wingL, wingR);
    root.add(g);
    return { g, wingL, wingR, x, t: -1, hop: -1, i, dir: new THREE.Vector3(-0.6 - (i % 2) * 0.5, 1, (i < 2 ? 1 : -1) * (0.8 + i * 0.15)) };
  });
  const perchAt = (x: number, sag: number) => {
    const { a, b } = COURSE.line;
    const s = (x - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * s - 4 * (COURSE.line.sag + sag) * s * (1 - s);
  };
  return {
    fly(audio: { birds(): void }) {
      audio.birds();
      birds.forEach(b => (b.t = 0));
    },
    update(dt: number, world: WorldState) {
      for (const b of birds) {
        const home = toWorld(b.x, perchAt(b.x, world.lineSag), 0);
        // a glider passing close: this one hops up and settles again
        if (b.t < 0 && b.hop < 0 && world.phase === "flying" && Math.hypot(world.p.x - b.x, world.p.y - perchAt(b.x, world.lineSag)) < 0.55) b.hop = 0;
        let flap = 0;
        if (b.t >= 0) {
          b.t += dt;
          const out = Math.min(b.t, 3.2);
          // off and away, out of the frame; then, a while later, a glide back down to the line
          const back = b.t > 6.5 ? Math.min(1, (b.t - 6.5) / 1.6) : 0;
          const away = home.clone().addScaledVector(b.dir, out * 2.4);
          b.g.position.lerpVectors(away, home, THREE.MathUtils.smoothstep(back, 0, 1));
          flap = back < 1 ? Math.sin(b.t * 34) : 0;
          if (b.t > 8.1) b.t = -1;
        } else if (b.hop >= 0) {
          b.hop += dt;
          const up = Math.sin(Math.min(1, b.hop / 1.4) * Math.PI) * 0.6;
          b.g.position.copy(home).add(new THREE.Vector3(0, up, 0));
          flap = b.hop < 1.4 ? Math.sin(b.hop * 34) : 0;
          if (b.hop > 1.6) b.hop = -1;
        } else {
          b.g.position.copy(home);
        }
        b.wingL.rotation.z = flap * 0.9 + (flap ? 0.4 : 0);
        b.wingR.rotation.z = -flap * 0.9 - (flap ? 0.4 : 0);
      }
    },
  };
}

void gliderMesh;
