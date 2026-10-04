import * as THREE from "three";
import type { Layout } from "../logic/grid";
import { COLS, ROWS, blockedSet, key } from "../logic/grid";
import type { EpisodeState, ResidentState } from "../logic/episode";
import type { GuestId } from "../logic/guests";
import { Mouse, type Mode } from "./mice";
import { cellPos } from "./items";

interface LiveResident {
  record: ResidentState;
  mouse: Mouse;
  phaseOffset: number;
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

function authoredPose(guest: GuestId, episode: EpisodeState, layout: Layout) {
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

  sync(episode: EpisodeState, layout: Layout, now: number) {
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
      this.place(live, episode, layout, now);
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

  private place(live: LiveResident, episode: EpisodeState, layout: Layout, now: number) {
    const pose = authoredPose(live.record.guest, episode, layout);
    live.mouse.root.position.copy(pose.p);
    live.mouse.root.rotation.y = pose.yaw;
    live.mouse.lying = false;
    live.mouse.baseY = 0;
    live.mouse.setMode(pose.mode, now);
  }

  update(t: number) {
    for (const live of this.live.values()) {
      const guest = live.record.guest;
      // A tiny domestic rhythm rather than a frozen trophy pose.
      const cycle = Math.floor((t + live.phaseOffset) / 8) % 3;
      const mode: Mode =
        guest === "conductor" ? (cycle === 1 ? "idle" : "watch-train") :
        guest === "baker" ? (cycle === 2 ? "idle" : live.mouse.root.position.y > 0.5 ? "nap" : "wrap") :
        (cycle === 1 ? "idle" : "read");
      live.mouse.setMode(mode, t);
      live.mouse.update(t + live.phaseOffset);
    }
  }

  count() { return this.live.size; }
}
