import * as THREE from "three";
import { PAL, ball, cyl, toon, inked } from "./style";
import { SHELF_OBJECTS, SHELF_ORDER, TIN_CAN, type ShelfObjectId } from "../logic/foraging";

/** the desk top, where the lost-property shelf sits */
export const DESK_Y = -0.3;

export interface ShelfProp { id: ShelfObjectId; group: THREE.Group; spin: THREE.Group; radius: number }

/** each object is built once, oversized against the proprietor, and re-used as both shelf prop and carried load */
export function buildShelfProp(id: ShelfObjectId): ShelfProp {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  let radius = 0.6;
  if (id === "brass_button") {
    radius = 0.72;
    const disc = cyl(0.7, 0.7, 0.16, PAL.brass, 28); disc.position.y = 0.08;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.05, 8, 28), toon("#f2cc6b")); rim.rotation.x = Math.PI / 2; rim.position.y = 0.17; inked(rim, 0.03);
    const dish = cyl(0.5, 0.5, 0.02, "#caa24b", 24, false); dish.position.y = 0.17;
    spin.add(disc, rim, dish);
    for (const [x, z] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]] as const) {
      const hole = cyl(0.045, 0.045, 0.03, "#3b2a1a", 10, false); hole.position.set(x, 0.185, z); spin.add(hole);
    }
  } else if (id === "thread_spool") {
    radius = 0.62;
    // axis along local X so it can roll along local +Z
    const inner = new THREE.Group();
    const core = cyl(0.4, 0.4, 0.9, "#c8323c", 22); core.position.y = 0;
    const topE = cyl(0.62, 0.62, 0.1, "#e8d3a1", 22); topE.position.y = 0.5;
    const botE = cyl(0.62, 0.62, 0.1, "#e8d3a1", 22); botE.position.y = -0.5;
    const stripe = cyl(0.405, 0.405, 0.08, "#8E2F3F", 22, false); stripe.position.y = 0.15;
    inner.add(core, topE, botE, stripe);
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.025, 6, 16, Math.PI * 1.2), toon("#c8323c")); tail.position.set(0.5, -0.2, 0.2); tail.rotation.set(0.4, 1.0, 0); inner.add(tail);
    inner.rotation.z = Math.PI / 2;
    spin.add(inner);
    spin.position.y = 0.62;
  } else {
    radius = 0.45;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.62, 22, 1, true), toon("#d6dde3")); body.position.y = 0.31; (body.material as THREE.Material).side = THREE.DoubleSide; inked(body, 0.03);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon("#e4eaee")); cap.position.y = 0.62; inked(cap, 0.03);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.04, 8, 24), toon("#aeb8c0")); lip.rotation.x = Math.PI / 2; lip.position.y = 0.02;
    spin.add(body, cap, lip);
    for (let i = 0; i < 12; i++) { const d = ball(0.025, "#9ba7b0", false); const a = i * 0.9; d.position.set(Math.cos(a) * 0.37, 0.15 + (i % 4) * 0.12, Math.sin(a) * 0.37); spin.add(d); }
  }
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return { id, group, spin, radius };
}

/** the shelf: three scavengeable objects and a sealed tin can nobody can open yet */
export class Shelf {
  group = new THREE.Group();
  props = new Map<ShelfObjectId, ShelfProp>();
  rings = new Map<ShelfObjectId, THREE.Mesh>();
  tin = new THREE.Group();
  lipMarker: THREE.Mesh;

  constructor() {
    for (const id of SHELF_ORDER) {
      const prop = buildShelfProp(id);
      const s = SHELF_OBJECTS[id].spot;
      prop.group.position.set(s.x, DESK_Y, s.z);
      prop.group.rotation.y = id === "thimble" ? 0.4 : id === "brass_button" ? -0.3 : 0.9;
      this.group.add(prop.group);
      this.props.set(id, prop);
      const ring = new THREE.Mesh(new THREE.RingGeometry(prop.radius + 0.18, prop.radius + 0.3, 32), new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, DESK_Y + 0.03, s.z); this.group.add(ring); this.rings.set(id, ring);
    }
    this.buildTinCan();
    this.lipMarker = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.64, 28), new THREE.MeshBasicMaterial({ color: "#7be28a", transparent: true, opacity: 0.9, depthWrite: false }));
    this.lipMarker.rotation.x = -Math.PI / 2; this.lipMarker.position.set(-2.5, DESK_Y + 0.03, 3.1); this.group.add(this.lipMarker);
    this.group.visible = false;
  }

  private buildTinCan() {
    const t = this.tin;
    const body = cyl(1.45, 1.45, 2.7, "#cfd3d8", 32); body.position.y = 1.35;
    const label = cyl(1.47, 1.47, 1.2, "#b8412f", 32, false); label.position.y = 1.35;
    const band = cyl(1.48, 1.48, 0.12, "#f1e1b0", 32, false); band.position.y = 1.9;
    const band2 = cyl(1.48, 1.48, 0.12, "#f1e1b0", 32, false); band2.position.y = 0.8;
    const rimTop = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.09, 8, 36), toon("#aeb4ba")); rimTop.rotation.x = Math.PI / 2; rimTop.position.y = 2.7; inked(rimTop, 0.04);
    const lid = cyl(1.38, 1.38, 0.05, "#dfe3e7", 32, false); lid.position.y = 2.72;
    const pull = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 18), toon("#aeb4ba")); pull.rotation.x = Math.PI / 2 - 0.5; pull.position.set(0.3, 2.9, 0.2); inked(pull, 0.03);
    t.add(body, label, band, band2, rimTop, lid, pull);
    t.position.set(TIN_CAN.x, DESK_Y, TIN_CAN.z); t.rotation.y = 0.5; t.rotation.z = 0.04;
    t.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    this.group.add(t);
  }

  setActive(on: boolean) { this.group.visible = on; }

  /** hide shelf objects whose fixture is already built (and the one in the proprietor's hands) */
  setAvailable(remaining: readonly ShelfObjectId[], carrying: ShelfObjectId | null) {
    for (const id of SHELF_ORDER) {
      const here = remaining.includes(id) && carrying !== id;
      this.props.get(id)!.group.visible = here;
      this.rings.get(id)!.visible = here;
    }
  }

  update(t: number) {
    for (const [id, ring] of this.rings) {
      if (!ring.visible) continue;
      const k = 1 + Math.sin(t * 3 + id.length) * 0.06;
      ring.scale.setScalar(k);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3 + id.length) * 0.25;
    }
    (this.lipMarker.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 2.4) * 0.3;
  }
}
