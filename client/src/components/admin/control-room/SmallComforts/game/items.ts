import * as THREE from "three";
import { Cell, COLS, ROWS, Item, footprint, Rot } from "../logic/grid";
import { PAL, rbox, cyl, ball, toon, canvasTex, inked } from "./style";

export const cellPos = (c: Cell, y = 0) => new THREE.Vector3(c.x - (COLS - 1) / 2, y, c.z - (ROWS - 1) / 2);

export function itemCenter(it: Item): THREE.Vector3 {
  const cells = footprint(it.kind, it.x, it.z, it.rot);
  const v = new THREE.Vector3();
  for (const c of cells) v.add(cellPos(c));
  return v.multiplyScalar(1 / cells.length);
}
/** the cell where a sleeper's head goes on a bed */
export function bedHeadCell(it: Item): { head: Cell; foot: Cell } {
  const c = footprint("bed", it.x, it.z, it.rot);
  return it.rot < 2 ? { head: c[0], foot: c[1] } : { head: c[1], foot: c[0] };
}

function bed(): THREE.Group {
  const g = new THREE.Group();
  const sleeve = rbox(0.92, 0.32, 1.92, "#c98c4a", 0.06); sleeve.position.y = 0.16; g.add(sleeve);
  const tray = rbox(0.78, 0.12, 1.78, PAL.cream, 0.04); tray.position.y = 0.36; g.add(tray);
  const mattress = rbox(0.74, 0.16, 1.7, "#7fb0a6", 0.07); mattress.position.y = 0.46; g.add(mattress);
  const pillow = rbox(0.58, 0.14, 0.4, "#ffffff", 0.07); pillow.position.set(0, 0.6, -0.62); g.add(pillow);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.05, 0.3), toon(PAL.burgundy)); stripe.position.set(0, 0.2, 0.2); g.add(stripe);
  return g;
}
function blanket(): THREE.Group {
  const g = new THREE.Group();
  const b = rbox(0.82, 0.12, 1.12, PAL.mustard, 0.06); b.position.set(0, 0.66, 0.36); g.add(b);
  for (let i = -3; i <= 3; i++) { const s = ball(0.065, PAL.cream, false); s.position.set(i * 0.12, 0.66, 0.94); s.scale.set(1, 0.7, 1); g.add(s); }
  return g;
}
function armchair(): THREE.Group {
  const g = new THREE.Group();
  const seat = rbox(0.74, 0.34, 0.74, PAL.leaf, 0.12); seat.position.y = 0.3; g.add(seat);
  const back = rbox(0.74, 0.74, 0.22, "#4f8a4d", 0.1); back.position.set(0, 0.58, -0.28); g.add(back);
  for (const s of [-1, 1]) { const arm = rbox(0.18, 0.4, 0.62, "#4f8a4d", 0.08); arm.position.set(s * 0.4, 0.46, 0.02); g.add(arm); }
  const cushion = rbox(0.5, 0.12, 0.5, "#86bf7e", 0.06); cushion.position.set(0, 0.52, 0.06); g.add(cushion);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const f = cyl(0.05, 0.04, 0.14, PAL.honey, 10, false); f.position.set(sx * 0.3, 0.07, sz * 0.3); g.add(f); }
  return g;
}
function lamp(): THREE.Group {
  const g = new THREE.Group();
  const base = cyl(0.2, 0.24, 0.1, PAL.brass, 16); base.position.y = 0.05; g.add(base);
  const stem = cyl(0.035, 0.035, 0.6, PAL.brass, 10, false); stem.position.y = 0.4; g.add(stem);
  // a giant button for a shade
  const shadeMat = toon("#fff2cf", { emissive: PAL.warm, emissiveIntensity: 0.9 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 24), shadeMat);
  shade.position.y = 0.78; shade.userData.shade = true; shade.castShadow = false; g.add(shade);
  inked(shade, 0.06);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.04, 8, 24), toon(PAL.burgundy)); rim.rotation.x = Math.PI / 2; rim.position.y = 0.84; g.add(rim);
  for (const [x, z] of [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), toon(PAL.ink)); h.position.set(x, 0.85, z); g.add(h); }
  const light = new THREE.PointLight(PAL.warm, 5, 4.2, 1.6); light.position.y = 0.8; light.userData.lampLight = true; g.add(light);
  g.userData.shadeMat = shadeMat;
  return g;
}
function table(): THREE.Group {
  const g = new THREE.Group();
  const core = cyl(0.12, 0.12, 0.5, PAL.honey, 16); core.position.y = 0.3; g.add(core);
  for (const y of [0.08, 0.56]) { const f = cyl(0.34, 0.34, 0.1, "#e7c58a", 24); f.position.y = y; g.add(f); }
  const thread = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.36, 18), toon(PAL.burgundy)); thread.position.y = 0.32; g.add(thread);
  return g;
}
function rug(): THREE.Group {
  const g = new THREE.Group();
  const tex = canvasTex(128, 128, c => {
    c.fillStyle = PAL.burgundy; c.fillRect(0, 0, 128, 128);
    c.strokeStyle = PAL.cream; c.lineWidth = 6; c.strokeRect(10, 10, 108, 108);
    c.strokeStyle = PAL.mustard; c.lineWidth = 4; c.strokeRect(22, 22, 84, 84);
    c.fillStyle = PAL.cream; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(64, 34 + i * 6); c.lineTo(94 - i * 8, 64); c.lineTo(64, 94 - i * 6); c.lineTo(34 + i * 8, 64); c.closePath(); c.fill(); c.fillStyle = i % 2 ? PAL.cream : PAL.leaf; }
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.04, 1.86), [toon("#7a2535"), toon("#7a2535"), new THREE.MeshToonMaterial({ map: tex, gradientMap: toon("#fff").gradientMap }), toon("#7a2535"), toon("#7a2535"), toon("#7a2535")]);
  m.position.y = 0.02; m.receiveShadow = true; g.add(m);
  return g;
}

export function makeItem(kind: Item["kind"]): THREE.Group {
  switch (kind) {
    case "bed": return bed();
    case "blanket": return blanket();
    case "armchair": return armchair();
    case "lamp": return lamp();
    case "table": return table();
    case "rug": return rug();
  }
}

/** position+rotate an item's group from its model */
export function place(g: THREE.Group, it: Item) {
  g.position.copy(itemCenter(it));
  g.rotation.y = rotY(it.rot);
  // blankets ride on their bed; their model is authored in bed space
  if (it.kind === "blanket") g.rotation.y = 0;
}
export const rotY = (r: Rot) => r * (Math.PI / 2);
