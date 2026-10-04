import * as THREE from "three";
import type { Layout } from "../logic/grid";
import { COLS, ROWS, blockedSet, key } from "../logic/grid";
import type { EpisodeState, ResidentState } from "../logic/episode";
import type { GuestId } from "../logic/guests";
import { Mouse, type Mode } from "./mice";
import { cellPos } from "./items";
import { FIXTURES, type FixtureId, type RoutineId } from "../logic/foraging";

const ROUTINE_FIXTURE: Record<Exclude<RoutineId, "ignores_it">, FixtureId> = {
  signals_trains: "signal_mirror",
  perches_by_window: "spool_stool",
  warms_hands: "thimble_stove",
  has_tea: "thimble_stove",
};
const ROUTINE_MODE: Record<Exclude<RoutineId, "ignores_it">, Mode> = {
  signals_trains: "signal",
  perches_by_window: "sit",
  warms_hands: "warm",
  has_tea: "warm",
};

interface LiveResident {
  record: ResidentState;
  mouse: Mouse;
  phaseOffset: number;
  placed?: boolean;
  /** set when a fixture has changed what this resident does */
  routineMode?: Mode;
  /** a visible walk to a new routine spot rather than a teleport */
  move?: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number; yaw: number; mode: Mode };
}

function firstFree(layout: Layout, preferred: { x: number; z: number }[]) {
  const blocked = blockedSet(layout);
  for (const c of preferred) {
    if (c.x < 0 || c.z < 0 || c.x >= COLS || c.z >= ROWS) continue;
    if (!blocked.has(key(c))) return c;
  }
  for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) {
    if (!blocked.has(key({ x, z }))) return { x, z };
  }
  return { x: 0, z: ROWS - 1 };
}

function fallbackPose(guest: GuestId, layout: Layout): { p: THREE.Vector3; yaw: number; mode: Mode } {
  if (guest === "conductor") {
    const c = firstFree(layout, [
      { x: Math.min(COLS - 1, layout.windowCol + 1), z: 0 },
      { x: layout.windowCol, z: 0 },
      { x: COLS - 1, z: 1 },
    ]);
    return { p: cellPos(c), yaw: Math.PI, mode: layout.windowCut ? "watch-train" : "idle" };
  }
  if (guest === "baker") {
    const c = firstFree(layout, [{ x: 1, z: 1 }, { x: 0, z: 1 }, { x: 1, z: 2 }]);
    return { p: cellPos(c), yaw: Math.PI * 0.15, mode: "wrap" };
  }
  const c = firstFree(layout, [{ x: COLS - 2, z: 1 }, { x: COLS - 1, z: 1 }, { x: COLS - 2, z: 2 }]);
  return { p: cellPos(c), yaw: -0.25, mode: "read" };
}

function routinePose(guest: GuestId, episode: EpisodeState) {
  const routine = episode.routines[guest];
  if (!routine || routine === "ignores_it") return null;
  const fixture = ROUTINE_FIXTURE[routine];
  if (!episode.fixtures.includes(fixture)) return null;
  const fx = FIXTURES[fixture];
  const yaw = routine === "perches_by_window" ? Math.PI : Math.atan2(fx.home.x - fx.stand.x, fx.home.z - fx.stand.z);
  return { p: new THREE.Vector3(fx.stand.x, fx.stand.y, fx.stand.z), yaw, mode: ROUTINE_MODE[routine] };
}

function authoredPose(guest: GuestId, episode: EpisodeState, layout: Layout) {
  const routine = routinePose(guest, episode);
  if (routine) return routine;
  if (guest === "baker" && episode.projects.includes("strap_hammock")) {
    return { p: new THREE.Vector3(-1.15, 0.72, -1.20), yaw: 0.1, mode: "nap" as Mode };
  }
  if (guest === "reader" && episode.projects.includes("pocket_loft")) {
    return { p: new THREE.Vector3(1.45, 1.18, -1.54), yaw: Math.PI, mode: "read" as Mode };
  }
  return fallbackPose(guest, layout);
}

export class ResidentLife {
  private live = new Map<GuestId, LiveResident>();

  constructor(private room: THREE.Group) {}

  sync(episode: EpisodeState, layout: Layout, now: number, animated = false) {
    const wanted = new Set(episode.residents.map(r => r.guest));
    for (const [guest, live] of this.live) {
      if (!wanted.has(guest)) {
        live.mouse.root.parent?.remove(live.mouse.root);
        this.live.delete(guest);
      }
    }

    for (const record of episode.residents) {
      let live = this.live.get(record.guest);
      if (!live) {
        const mouse = new Mouse(record.guest);
        this.room.add(mouse.root);
        live = { record, mouse, phaseOffset: record.arrivedOrder * 2.13 };
        this.live.set(record.guest, live);
      } else {
        live.record = record;
      }
      this.place(live, episode, layout, now, animated);
    }
  }

  adopt(record: ResidentState, mouse: Mouse, episode: EpisodeState, layout: Layout, now: number) {
    const previous = this.live.get(record.guest);
    if (previous && previous.mouse !== mouse) previous.mouse.root.parent?.remove(previous.mouse.root);
    mouse.lying = false;
    mouse.baseY = 0;
    const live: LiveResident = { record, mouse, phaseOffset: record.arrivedOrder * 2.13 };
    this.live.set(record.guest, live);
    if (mouse.root.parent !== this.room) this.room.add(mouse.root);
    this.place(live, episode, layout, now);
  }

  private place(live: LiveResident, episode: EpisodeState, layout: Layout, now: number, animated = false) {
    const pose = authoredPose(live.record.guest, episode, layout);
    live.routineMode = routinePose(live.record.guest, episode)?.mode;
    if (animated && live.placed) {
      const from = live.mouse.root.position.clone();
      const dist = Math.hypot(pose.p.x - from.x, pose.p.z - from.z);
      if (dist > 0.05) {
        live.move = { from, to: pose.p.clone(), t0: now, dur: Math.max(0.6, dist / 1.9), yaw: pose.yaw, mode: pose.mode };
        live.mouse.lying = false; live.mouse.baseY = 0;
        return;
      }
    }
    live.placed = true;
    live.move = undefined;
    live.mouse.root.position.copy(pose.p);
    live.mouse.root.rotation.y = pose.yaw;
    live.mouse.lying = false;
    live.mouse.baseY = 0;
    live.mouse.setMode(pose.mode, now);
  }

  update(t: number, now = t) {
    for (const live of this.live.values()) {
      const guest = live.record.guest;
      if (live.move) {
        const m = live.move;
        const k = Math.min(1, (now - m.t0) / m.dur);
        live.mouse.root.position.lerpVectors(m.from, m.to, k);
        const heading = Math.atan2(m.to.x - m.from.x, m.to.z - m.from.z);
        live.mouse.root.rotation.y = k < 1 ? heading : m.yaw;
        live.mouse.walkPhase += 0.9;
        live.mouse.setMode(k < 1 ? "walk" : m.mode, t);
        live.mouse.update(t + live.phaseOffset);
        if (k >= 1) { live.mouse.root.position.copy(m.to); live.move = undefined; live.placed = true; }
        continue;
      }
      // A tiny domestic rhythm rather than a frozen trophy pose.
      const cycle = Math.floor((t + live.phaseOffset) / 8) % 3;
      const mode: Mode =
        live.routineMode === "signal" ? (cycle === 1 ? "watch-train" : "signal") :
        live.routineMode === "sit" ? (cycle === 1 ? "sigh" : "sit") :
        live.routineMode === "warm" ? "warm" :
        guest === "conductor" ? (cycle === 1 ? "idle" : "watch-train") :
        guest === "baker" ? (cycle === 2 ? "idle" : live.mouse.root.position.y > 0.5 ? "nap" : "wrap") :
        (cycle === 1 ? "idle" : "read");
      live.mouse.setMode(mode, t);
      live.mouse.update(t + live.phaseOffset);
    }
  }

  count() { return this.live.size; }
}
