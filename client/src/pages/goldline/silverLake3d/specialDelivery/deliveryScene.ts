import * as THREE from "three";
import type { CourtyardActivityApi } from "../silverLakeRuntime";
import { PLANE_X } from "./deliveryCourse";
import {
  FAN_ANGLE,
  cupPosition,
  linePoint,
  previewArc,
  tailSegment,
  type CourseDef,
  type FanSetting,
  type V2,
  type WorldState,
} from "./deliveryPhysics";

/**
 * Rook's airmail course as real geometry in the Silver Lake courtyard: the station, the fan, the washing line and its
 * sheets, three cups, Bella's balcony with her basket and bicycle, and the glider. Everything that the glider can hit is
 * placed from the same course definition the simulation uses, so what you see is what it collides with.
 *
 * The simulation runs left to right; on screen the course runs right to left (Rook faces left, his painted side), so
 * sim x maps to screen u = -x + OFFSET. three.js: x = PLANE_X + depth (away from the camera), y = height, z = u.
 */
export const OFFSET = -1.62;
export const toWorld = (x: number, y: number, depth = 0) => new THREE.Vector3(PLANE_X + depth, y, -x + OFFSET);
/** sim direction to world (no depth) */
const dirWorld = (x: number, y: number) => new THREE.Vector3(0, y, -x);

export type AimView = { pull: V2; tension: number } | null;

const mat = (name: string, color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ name, color, roughness: 0.8, ...extra });

function box(w: number, h: number, d: number, m: THREE.Material) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 12) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
}

/** A painted plank sign: big hand-lettered title, small line under it. */
function signTexture(title: string, sub: string, w = 512, h = 256, opts: { bg?: string; ink?: string } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = opts.bg ?? "#f3e2c0";
  g.fillRect(0, 0, w, h);
  // wood grain
  g.strokeStyle = "rgba(120,80,40,0.16)";
  g.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    g.beginPath();
    const y = 14 + i * (h / 9);
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
    g.stroke();
  }
  g.strokeStyle = "rgba(90,55,25,0.85)";
  g.lineWidth = 8;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = opts.ink ?? "#7b2d1c";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const titleFont = (px: number) => `900 ${px}px "Trebuchet MS", "Arial Rounded MT Bold", system-ui, sans-serif`;
  let titlePx = Math.round(h * 0.3);
  g.font = titleFont(titlePx);
  // the whole title fits inside the frame, however the font measures on this device
  const room = w - 56;
  if (g.measureText(title).width > room) {
    titlePx = Math.floor((titlePx * room) / g.measureText(title).width);
    g.font = titleFont(titlePx);
  }
  // hand-painted wobble: each letter slightly off its line
  const letters = title.split("");
  const total = g.measureText(title).width;
  let x = w / 2 - total / 2;
  letters.forEach((ch, i) => {
    const cw = g.measureText(ch).width;
    g.save();
    g.translate(x + cw / 2, h * 0.42 + Math.sin(i * 1.7) * 3);
    g.rotate(Math.sin(i * 2.3) * 0.05);
    g.fillText(ch, 0, 0);
    g.restore();
    x += cw;
  });
  if (sub) {
    g.font = `700 ${Math.round(h * 0.13)}px "Trebuchet MS", system-ui, sans-serif`;
    g.fillStyle = "#4a3422";
    g.fillText(sub, w / 2, h * 0.76);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildDeliveryScene(api: CourtyardActivityApi, course: CourseDef) {
  const root = new THREE.Group();
  root.name = "special-delivery";
  api.scene.add(root);
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

  const wood = mat("timber", 0xb07a4a);
  const darkWood = mat("timber", 0x7b5232);
  const crateWood = mat("crate", 0xc9955f);
  const brass = mat("brass", 0xd4a640, { metalness: 0.5, roughness: 0.35 });
  const paper = mat("paper", 0xfffaf0);
  const red = mat("paint_red", 0xd9534f);
  const teal = mat("paint_teal", 0x5fa8a0);
  const cream = mat("cream_paint", 0xf6ead2);
  const rope = mat("rope", 0xd8c3a0);
  const rubber = mat("rubber", 0xc0392b);

  // ---------------------------------------------------------------- Rook's station
  const station = new THREE.Group();
  station.name = "rook-station";
  const st = course.station;
  const stMid = (st.x0 + st.x1) / 2;
  const stW = st.x1 - st.x0;
  const top = box(0.9, 0.08, stW + 0.15, wood);
  top.position.copy(toWorld(stMid, st.top - 0.04));
  station.add(top);
  for (const dx of [-0.4, 0.4])
    for (const du of [-stW / 2 + 0.06, stW / 2 - 0.06]) {
      const leg = box(0.08, st.top - 0.08, 0.08, darkWood);
      leg.position.copy(toWorld(stMid + du, (st.top - 0.08) / 2, dx));
      station.add(leg);
    }
  // the launching rail: two runners along the table toward the course
  for (const dx of [-0.07, 0.07]) {
    const runner = box(0.03, 0.04, stW + 0.1, darkWood);
    runner.position.copy(toWorld(stMid, st.top + 0.02, dx));
    station.add(runner);
  }
  // the elastic's two posts at the course end of the rail
  const postAt = { x: course.launch.x + 0.12, y: st.top };
  const posts: THREE.Vector3[] = [];
  for (const dx of [-0.22, 0.22]) {
    const p = cyl(0.03, 0.035, 0.42, darkWood, 8);
    p.position.copy(toWorld(postAt.x, st.top + 0.21, dx));
    station.add(p);
    posts.push(toWorld(postAt.x, st.top + 0.36, dx));
  }
  // the brass aiming dial on the side of the table, needle follows the aim
  const dial = cyl(0.13, 0.13, 0.03, brass, 24);
  dial.rotation.z = Math.PI / 2;
  dial.position.copy(toWorld(st.x0 + 0.2, st.top - 0.17, -0.47));
  station.add(dial);
  const needle = box(0.012, 0.11, 0.018, mat("needle", 0x2b1d12));
  needle.geometry.translate(0, 0.05, 0);
  needle.position.copy(dial.position).add(new THREE.Vector3(-0.02, 0, 0));
  station.add(needle);
  // the glider-folding contraption: a crank box with a big handle and a paper roll
  const folder = box(0.36, 0.3, 0.34, teal);
  folder.position.copy(toWorld(st.x0 - 0.05, st.top + 0.15, 0.22));
  station.add(folder);
  const roll = cyl(0.07, 0.07, 0.4, paper, 14);
  roll.rotation.x = Math.PI / 2;
  roll.position.copy(folder.position).add(new THREE.Vector3(0, 0.22, 0));
  station.add(roll);
  const crank = new THREE.Group();
  const crankArm = box(0.03, 0.2, 0.03, brass);
  crankArm.position.y = 0.1;
  const crankKnob = cyl(0.03, 0.03, 0.08, red, 8);
  crankKnob.rotation.x = Math.PI / 2;
  crankKnob.position.set(-0.05, 0.2, 0);
  crank.add(crankArm, crankKnob);
  crank.position.copy(folder.position).add(new THREE.Vector3(-0.19, 0.0, 0));
  station.add(crank);
  // a tray of replacement gliders
  const tray = box(0.3, 0.04, 0.26, darkWood);
  tray.position.copy(toWorld(stMid - 0.25, st.top + 0.02, -0.3));
  station.add(tray);
  for (let i = 0; i < 4; i++) {
    const g = gliderMesh(paper);
    g.scale.setScalar(0.42);
    g.position.copy(tray.position).add(new THREE.Vector3(0, 0.03 + i * 0.018, 0));
    g.rotation.set(0, Math.PI / 2 + i * 0.12, 0);
    station.add(g);
  }
  // Rook's mast: it holds the washing line's end
  const mastX = course.line.a.x;
  const mast = cyl(0.045, 0.06, course.line.a.y + 0.1, darkWood, 8);
  mast.position.copy(toWorld(mastX, (course.line.a.y + 0.1) / 2, 0.02));
  station.add(mast);
  const pennant = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 3), red);
  pennant.rotation.z = Math.PI / 2;
  pennant.position.copy(toWorld(mastX - 0.22, course.line.a.y + 0.05, 0.02));
  station.add(pennant);
  const signTex = track(signTexture("ROOK'S AIRMAIL", "MOSTLY RELIABLE"));
  const signMat = new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false });
  api.noOutline(signMat);
  // the stall's sign, ROOK'S AIRMAIL, MOSTLY RELIABLE, hung on the front of the table under the brass dial
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.49), signMat);
  sign.position.copy(toWorld(stMid, 0.42, -0.5));
  sign.rotation.y = -Math.PI / 2;
  sign.rotation.z = 0.03;
  station.add(sign);
  // the watering can, at the foot of the station (where a crumpled first draft ends up)
  const can = new THREE.Group();
  const canBody = cyl(0.16, 0.19, 0.3, teal, 16);
  const canSpout = cyl(0.025, 0.04, 0.34, teal, 8);
  canSpout.position.set(0, 0.08, 0.22);
  canSpout.rotation.x = Math.PI / 3.1;
  const canHandle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 14, Math.PI), teal);
  canHandle.position.set(0, 0.16, -0.04);
  canHandle.rotation.y = Math.PI / 2;
  can.add(canBody, canSpout, canHandle);
  const canAt = toWorld(st.x1 + 0.55, 0.15, -0.35);
  can.position.copy(canAt);
  station.add(can);
  // the second elastic band: one of Rook's "improvements" (shown on a later visit)
  root.add(station);

  // ---------------------------------------------------------------- the elastic band
  const bandMat = rubber;
  const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([posts[0], posts[1]]), 8, 0.018, 6, false), bandMat);
  root.add(band);
  const band2 = new THREE.Mesh(band.geometry.clone(), mat("rubber_blue", 0x4f79b8));
  band2.visible = false;
  root.add(band2);
  let bandPull = new THREE.Vector3();
  function updateBand(mesh: THREE.Mesh, pullPoint: THREE.Vector3 | null, lift = 0) {
    const a = posts[0].clone().add(new THREE.Vector3(0, lift, 0));
    const b = posts[1].clone().add(new THREE.Vector3(0, lift, 0));
    const pts = pullPoint ? [a, pullPoint.clone().add(new THREE.Vector3(-0.06, lift, 0)), pullPoint.clone().add(new THREE.Vector3(0.06, lift, 0)), b] : [a, a.clone().lerp(b, 0.5), b];
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.1), 16, 0.016, 6, false);
  }

  // ---------------------------------------------------------------- the fan
  const fan = new THREE.Group();
  const fx = course.fan.x;
  const crate = box(0.7, 0.55, 0.7, crateWood);
  crate.position.copy(toWorld(fx, 0.275));
  fan.add(crate);
  const fanHead = new THREE.Group();
  const housing = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 8, 28), cream);
  housing.rotation.x = Math.PI / 2;
  const grilleMat = mat("grille", 0xe8dcc4);
  const grille = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.4, 24, 1), grilleMat);
  grille.rotation.x = -Math.PI / 2;
  grille.position.y = 0.08;
  (grilleMat as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  (grilleMat as THREE.MeshStandardMaterial).transparent = true;
  (grilleMat as THREE.MeshStandardMaterial).opacity = 0.35;
  const blades = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const blade = box(0.34, 0.015, 0.13, mat("blade", 0x8fc6ef));
    blade.position.x = 0.19;
    blade.rotation.x = 0.35;
    const arm = new THREE.Group();
    arm.rotation.y = (i * Math.PI) / 2;
    arm.add(blade);
    blades.add(arm);
  }
  const hub = cyl(0.07, 0.07, 0.06, red, 12);
  blades.add(hub);
  fanHead.add(housing, blades, grille);
  fanHead.position.copy(toWorld(fx, course.fan.y));
  fan.add(fanHead);
  // a little cloth streamer tied to the grille shows the wind
  const streamerMat = new THREE.MeshBasicMaterial({ color: 0xff8a73, side: THREE.DoubleSide, toneMapped: false });
  api.noOutline(streamerMat);
  const streamer = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.5, 1, 6), streamerMat);
  streamer.geometry.translate(0, 0.25, 0);
  streamer.position.copy(toWorld(fx + 0.3, course.fan.y + 0.08, -0.05));
  fan.add(streamer);
  root.add(fan);
  // wind motes rising in the column
  const MOTES = api.reduceMotion ? 8 : 26;
  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(MOTES * 3);
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.7, depthWrite: false });
  api.noOutline(moteMat);
  const motes = new THREE.Points(moteGeo, moteMat);
  root.add(motes);
  const moteSeed = Array.from({ length: MOTES }, (_, i) => ({ s: (i * 0.618) % 1, a: (i * 0.37) % 1, d: ((i * 0.73) % 1) - 0.5 }));

  // ---------------------------------------------------------------- the washing line, its sheets, the cups
  const lineMesh = new THREE.Mesh(new THREE.BufferGeometry(), rope);
  root.add(lineMesh);
  const hookA = cyl(0.03, 0.03, 0.12, brass, 6);
  hookA.position.copy(toWorld(course.line.a.x, course.line.a.y, 0.02));
  const hookB = hookA.clone();
  hookB.position.copy(toWorld(course.line.b.x, course.line.b.y, 0.02));
  root.add(hookA, hookB);
  function linePts(extraSag: number, depth = 0, n = 32) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = linePoint(course, i / n, extraSag);
      pts.push(toWorld(p.x, p.y, depth));
    }
    return pts;
  }
  let lastSag = NaN;
  function updateLine(sag: number) {
    if (Math.abs(sag - lastSag) < 0.0008) return;
    lastSag = sag;
    lineMesh.geometry.dispose();
    lineMesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(linePts(sag)), 48, 0.014, 5, false);
  }
  updateLine(0);

  type Cloth = { mesh: THREE.Mesh; base: Float32Array; w: number; h: number; x0: number; x1: number; depth: number; phase: number };
  const cloths: Cloth[] = [];
  function makeCloth(x0: number, x1: number, drop: number, color: number, depth: number, pattern: "stripe" | "dots" | "plain") {
    const w = Math.abs(x1 - x0);
    const geo = new THREE.PlaneGeometry(w, drop, 8, 6);
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "rgba(255,255,255,0.55)";
    if (pattern === "stripe") for (let i = 0; i < 128; i += 22) g.fillRect(i, 0, 8, 128);
    if (pattern === "dots") for (let y = 10; y < 128; y += 24) for (let x = 10 + ((y / 24) % 2) * 12; x < 128; x += 24) g.beginPath(), g.arc(x, y, 5, 0, Math.PI * 2), g.fill();
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ name: "cloth", map: tex, side: THREE.DoubleSide, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.y = -Math.PI / 2;
    const mid = (x0 + x1) / 2;
    const s = (mid - course.line.a.x) / (course.line.b.x - course.line.a.x);
    const top = linePoint(course, s).y - 0.02;
    mesh.position.copy(toWorld(mid, top - drop / 2, depth));
    mesh.castShadow = true;
    root.add(mesh);
    const base = (geo.attributes.position.array as Float32Array).slice();
    const cloth = { mesh, base, w, h: drop, x0, x1, depth, phase: x0 * 1.7 };
    cloths.push(cloth);
    // pegs
    for (const px of [x0 + 0.06, x1 - 0.06]) {
      const peg = box(0.03, 0.09, 0.03, wood);
      const sp = (px - course.line.a.x) / (course.line.b.x - course.line.a.x);
      peg.position.copy(toWorld(px, linePoint(course, sp).y - 0.02, depth));
      root.add(peg);
    }
    return cloth;
  }
  // the sheet in the glider's plane
  course.sheets.forEach((sh, i) => makeCloth(sh.x0, sh.x1, sh.drop, i % 2 ? 0x8fc6ef : 0xf6d36b, 0, "stripe"));
  // a nearer line with laundry that only sways: the glider passes behind it
  const nearDepth = -1.25;
  const nearA = toWorld(1.2, 3.25, nearDepth);
  const nearB = toWorld(-1.6, 3.05, nearDepth);
  const nearLine = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([nearA, nearA.clone().lerp(nearB, 0.5).add(new THREE.Vector3(0, -0.22, 0)), nearB]), 24, 0.012, 5, false), rope);
  root.add(nearLine);
  const nearCloths: Cloth[] = [];
  function nearCloth(x0: number, x1: number, drop: number, color: number, pattern: "stripe" | "dots" | "plain") {
    const w = Math.abs(x1 - x0);
    const geo = new THREE.PlaneGeometry(w, drop, 6, 5);
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "rgba(255,255,255,0.6)";
    if (pattern === "dots") for (let y = 6; y < 64; y += 14) for (let x = 6 + ((y / 14) % 2) * 7; x < 64; x += 14) g.beginPath(), g.arc(x, y, 3, 0, Math.PI * 2), g.fill();
    if (pattern === "stripe") for (let i = 0; i < 64; i += 12) g.fillRect(0, i, 64, 4);
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ name: "cloth", map: tex, side: THREE.DoubleSide, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.y = -Math.PI / 2;
    const mid = (x0 + x1) / 2;
    const t = (mid - 1.2) / (-1.6 - 1.2);
    const topY = 3.25 + (3.05 - 3.25) * t - 0.22 * 4 * t * (1 - t) - 0.02;
    mesh.position.copy(toWorld(mid, topY - drop / 2, nearDepth));
    root.add(mesh);
    const base = (geo.attributes.position.array as Float32Array).slice();
    const cl = { mesh, base, w, h: drop, x0, x1, depth: nearDepth, phase: x0 * 2.3 + 1 };
    nearCloths.push(cl);
    return cl;
  }
  nearCloth(0.7, 0.15, 0.7, 0xff9a8a, "dots");
  nearCloth(-0.05, -0.75, 0.95, 0xfbf6ec, "stripe");
  nearCloth(-0.95, -1.4, 0.55, 0xb6dfa8, "plain");

  // the cups: cream china with a coloured band, each a different size and note
  const cupColors = [0x8fc6ef, 0xff8a73, 0x7fb8a4];
  const cups = course.cups.map((cup, i) => {
    const g = new THREE.Group();
    const china = mat("china", 0xfbf6ec);
    const r = cup.radius * (1.75 - i * 0.15);
    const body = cyl(r, r * 0.72, r * 1.3, china, 16);
    const bandM = mat("cup_band", cupColors[i]);
    const bandMesh = cyl(r * 1.01, r * 0.95, r * 0.28, bandM, 16);
    bandMesh.position.y = r * 0.25;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(r * 0.38, r * 0.1, 6, 12), china);
    handle.position.set(0, 0, r * 1.02);
    handle.rotation.y = Math.PI / 2;
    g.add(body, bandMesh, handle);
    // hung upside down by the handle, the way you dry a cup on a line
    g.rotation.z = Math.PI;
    const holder = new THREE.Group();
    holder.add(g);
    root.add(holder);
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 1, 4), rope);
    root.add(string);
    return { holder, cup: g, string, ring: 0 };
  });

  // ---------------------------------------------------------------- Bella's balcony, basket and bicycle
  const bal = course.balcony;
  const balcony = new THREE.Group();
  const floorW = bal.x1 - bal.x0;
  const floorMid = (bal.x0 + bal.x1) / 2;
  const floor = box(1.5, 0.12, floorW, wood);
  floor.position.copy(toWorld(floorMid, bal.floor - 0.06, 0.25));
  balcony.add(floor);
  // brackets under the slab
  for (const dx of [-0.5, 0.5]) {
    const br = box(0.08, 0.5, 0.08, darkWood);
    br.position.copy(toWorld(bal.x1 - 0.25, bal.floor - 0.35, 0.25 + dx));
    br.rotation.x = 0.6;
    balcony.add(br);
  }
  // railing: a front rail facing the course and side rails
  const railTop = box(1.5, 0.07, 0.07, wood);
  railTop.position.copy(toWorld(bal.x0, bal.rail, 0.25));
  balcony.add(railTop);
  for (let i = 0; i < 5; i++) {
    const baluster = box(0.04, bal.rail - bal.floor, 0.04, wood);
    baluster.position.copy(toWorld(bal.x0, (bal.rail + bal.floor) / 2, -0.45 + i * 0.35));
    balcony.add(baluster);
  }
  const sideRail = box(0.07, 0.07, floorW, wood);
  sideRail.position.copy(toWorld(floorMid, bal.rail, -0.48));
  balcony.add(sideRail);
  // flower box on the rail
  const flowerBox = box(0.26, 0.16, 0.5, red);
  flowerBox.position.copy(toWorld(bal.x0 - 0.02, bal.rail + 0.06, 0.75));
  balcony.add(flowerBox);
  for (let i = 0; i < 5; i++) {
    const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mat("bloom", [0xffd25e, 0xff8a73, 0xffffff][i % 3]));
    bloom.position.copy(flowerBox.position).add(new THREE.Vector3((i % 2) * 0.05 - 0.02, 0.12 + (i % 3) * 0.02, -0.2 + i * 0.1));
    balcony.add(bloom);
  }
  // the big wicker laundry basket
  const bk = course.basket;
  const basket = new THREE.Group();
  const wicker = mat("wicker", 0xd9a35c);
  const basketBody = cyl(bk.width / 2, bk.width / 2 - 0.08, bk.depth, wicker, 20);
  basketBody.scale.set(1, 1, 1);
  basketBody.position.y = bk.depth / 2;
  const basketRim = new THREE.Mesh(new THREE.TorusGeometry(bk.width / 2, 0.035, 8, 24), mat("wicker_rim", 0xb07a3a));
  basketRim.rotation.x = Math.PI / 2;
  basketRim.position.y = bk.depth;
  const cushion = cyl(bk.width / 2 - 0.05, bk.width / 2 - 0.05, 0.06, mat("cushion", 0xfbf6ec), 18);
  cushion.position.y = bk.depth - 0.18;
  basket.add(basketBody, basketRim, cushion);
  basket.position.copy(toWorld(bk.x, bal.floor, 0.25));
  balcony.add(basket);
  // a soft glow ring that marks the basket as the target until the first delivery
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false });
  api.noOutline(glowMat);
  const glow = new THREE.Mesh(new THREE.RingGeometry(bk.width / 2 + 0.05, bk.width / 2 + 0.16, 32), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.copy(toWorld(bk.x, bk.y + 0.02, 0.25));
  balcony.add(glow);
  // the bicycle, leaning on the wall behind Bella, with an empty bell mount (she has been waiting for that bell)
  const bike = new THREE.Group();
  const tyre = mat("tyre", 0x3b2a1e);
  const frameM = mat("bike_frame", 0x5fa8a0);
  for (const dz of [-0.36, 0.36]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.025, 6, 24), tyre);
    wheel.position.set(0, 0.25, dz);
    wheel.rotation.y = Math.PI / 2;
    bike.add(wheel);
  }
  const tube = (a: THREE.Vector3, b: THREE.Vector3) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, a.distanceTo(b), 6), frameM);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    bike.add(m);
  };
  tube(new THREE.Vector3(0, 0.25, -0.36), new THREE.Vector3(0, 0.5, -0.05));
  tube(new THREE.Vector3(0, 0.5, -0.05), new THREE.Vector3(0, 0.5, 0.25));
  tube(new THREE.Vector3(0, 0.25, -0.36), new THREE.Vector3(0, 0.27, 0.0));
  tube(new THREE.Vector3(0, 0.27, 0.0), new THREE.Vector3(0, 0.5, 0.25));
  tube(new THREE.Vector3(0, 0.25, 0.36), new THREE.Vector3(0, 0.62, 0.3));
  tube(new THREE.Vector3(-0.17, 0.66, 0.3), new THREE.Vector3(0.17, 0.66, 0.3));
  const saddle = box(0.07, 0.04, 0.16, mat("saddle", 0x7b5232));
  saddle.position.set(0, 0.55, -0.08);
  bike.add(saddle);
  const mount = box(0.03, 0.03, 0.05, brass);
  mount.position.set(0.12, 0.68, 0.3);
  bike.add(mount);
  bike.position.copy(toWorld(bal.x1 - 0.3, bal.floor, 0.65));
  bike.rotation.y = 0.15;
  balcony.add(bike);
  root.add(balcony);

  // ---------------------------------------------------------------- the glider and its bell
  const glider = new THREE.Group();
  const gliderBody = gliderMesh(paper);
  glider.add(gliderBody);
  const bellHolder = new THREE.Group();
  const bellString = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 4), rope);
  bellString.position.y = -0.06;
  const gliderBell = bellMesh(brass, 0.55);
  gliderBell.position.y = -0.14;
  bellHolder.add(bellString, gliderBell);
  bellHolder.position.set(0.02, -0.03, 0);
  glider.add(bellHolder);
  root.add(glider);
  const gliderGeo = gliderBody.geometry as THREE.BufferGeometry;
  // a cartoon-sized glider: big enough to read across the courtyard and on a phone
  const GLIDER_SCALE = 1.55;
  // a soft paper-white trail of where it has just been, so its swoop and speed read at a glance
  const TRAIL = 26;
  const trailPos = new Float32Array(TRAIL * 2 * 3);
  const trailAlpha = new Float32Array(TRAIL * 2);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setAttribute("alpha", new THREE.BufferAttribute(trailAlpha, 1));
  const trailIdx: number[] = [];
  for (let i = 0; i < TRAIL - 1; i++) trailIdx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  trailGeo.setIndex(trailIdx);
  const trailMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(0xffffff) } },
    vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 color; varying float vA; void main(){ gl_FragColor = vec4(color, vA * 0.55); }",
  });
  api.noOutline(trailMat);
  const trail = new THREE.Mesh(trailGeo, trailMat);
  trail.frustumCulled = false;
  root.add(trail);
  const trailHist: V2[] = [];
  let trailFade = 0;
  // the aim guide: a few dots along the first moments of the launch
  const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  api.noOutline(dotMat);
  const dots = Array.from({ length: 7 }, () => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), dotMat);
    d.visible = false;
    root.add(d);
    return d;
  });
  // a soft shadow under the glider so its height reads
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x2b3b1c, transparent: true, opacity: 0.2, depthWrite: false });
  api.noOutline(shadowMat);
  const gliderShadow = new THREE.Mesh(new THREE.CircleGeometry(0.25, 20).rotateX(-Math.PI / 2), shadowMat);
  root.add(gliderShadow);

  api.stylize(root);
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material !== shadowMat && m.material !== dotMat && m.material !== glowMat) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  // stylize swapped materials; keep handles to the ones we animate
  const toonOf = (m: THREE.Mesh) => m.material as THREE.MeshToonMaterial;
  void toonOf;

  // hero colliders, so walking around the set feels solid
  api.addCollider(...xz(toWorld(stMid, 0)), 0.75);
  api.addCollider(...xz(toWorld(fx, 0)), 0.5);
  api.addCollider(...xz(toWorld(course.cat.x, 0)), 0.45);

  // ---------------------------------------------------------------- per-frame sync
  let fanAngle = FAN_ANGLE.up;
  let fanTarget = FAN_ANGLE.up;
  let bladeSpin = 0;
  const tmpV = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const qBank = new THREE.Quaternion();
  const baseYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

  function setGliderShape(open: number) {
    const span = 0.1 + 0.24 * open;
    const rise = 0.1 - 0.08 * open;
    const sweep = 0.06 * (1 - open);
    const p = gliderGeo.attributes.position as THREE.BufferAttribute;
    // vertex order matches gliderMesh(): nose, tail, left tip, right tip, keel
    p.setXYZ(2, -0.28 + sweep, rise, -span);
    p.setXYZ(3, -0.28 + sweep, rise, span);
    p.needsUpdate = true;
    gliderGeo.computeVertexNormals();
  }

  function sync(world: WorldState, dt: number, elapsed: number, aim: AimView, opts: { gliderHidden?: boolean; fan: FanSetting; showGlow: boolean }) {
    // fan: blades spin, the head leans to its setting
    fanTarget = FAN_ANGLE[opts.fan];
    fanAngle += (fanTarget - fanAngle) * (1 - Math.exp(-dt * 6));
    // the fan leans toward the basket for "forward"; sim +x is screen -z
    fanHead.rotation.x = -fanAngle;
    bladeSpin += dt * (api.reduceMotion ? 8 : 26);
    blades.rotation.y = bladeSpin;
    streamer.rotation.x = -fanAngle + Math.sin(elapsed * 23) * 0.12;
    streamer.rotation.z = Math.sin(elapsed * 17) * 0.08;
    // motes rise along the column
    const dir = new THREE.Vector2(Math.sin(fanAngle), Math.cos(fanAngle));
    for (let i = 0; i < MOTES; i++) {
      const m = moteSeed[i];
      const s = (m.s + elapsed * (0.35 + m.a * 0.3)) % 1;
      const along = s * course.fan.reach * 0.9;
      const across = m.d * course.fan.width * 0.8;
      const px = fx + dir.x * along + dir.y * across;
      const py = course.fan.y + dir.y * along - dir.x * across;
      tmpV.copy(toWorld(px, py, m.d * 0.4));
      motePos.set([tmpV.x, tmpV.y, tmpV.z], i * 3);
    }
    moteGeo.attributes.position.needsUpdate = true;
    moteMat.opacity = 0.55;

    // line, sheets, cups
    updateLine(world.lineSag);
    cloths.forEach((cl, i) => {
      const st2 = world.sheets[i];
      const p = cl.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        const bx = cl.base[k];
        const by = cl.base[k + 1];
        const hang = (cl.h / 2 - by) / cl.h; // 0 at the pegs, 1 at the hem
        const breeze = (api.reduceMotion ? 0.3 : 1) * Math.sin(elapsed * 1.7 + cl.phase + bx * 2) * 0.04 * hang;
        const push = (st2?.push ?? 0) * hang * 0.9;
        arr[k + 2] = cl.base[k + 2] + breeze + push * 0.6;
        arr[k] = bx + push * 0.25 * Math.sin(by * 3);
      }
      p.needsUpdate = true;
    });
    nearCloths.forEach(cl => {
      const p = cl.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const arr = p.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        const by = cl.base[k + 1];
        const hang = (cl.h / 2 - by) / cl.h;
        arr[k + 2] = cl.base[k + 2] + (api.reduceMotion ? 0.3 : 1) * Math.sin(elapsed * 1.3 + cl.phase + cl.base[k] * 3) * 0.05 * hang;
      }
      p.needsUpdate = true;
    });
    course.cups.forEach((cup, i) => {
      const pos = cupPosition(course, world, i);
      const c = cups[i];
      c.holder.position.copy(toWorld(pos.x, pos.y));
      // swing in the plane: sim angle about the depth axis; mirrored on screen
      c.holder.rotation.x = world.cups[i].angle;
      const s = (cup.anchor.x - course.line.a.x) / (course.line.b.x - course.line.a.x);
      const anchor = linePoint(course, s, world.lineSag);
      const a = toWorld(anchor.x, anchor.y);
      const b = toWorld(pos.x, pos.y + cup.radius);
      c.string.position.copy(a).lerp(b, 0.5);
      c.string.scale.y = Math.max(0.01, a.distanceTo(b));
      c.string.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      c.ring = Math.max(0, c.ring - dt * 3);
      const wobble = c.ring * Math.sin(elapsed * 60) * 0.06;
      c.cup.rotation.y = wobble;
    });

    // glider
    const hidden = opts.gliderHidden || (world.phase === "done" && world.outcome === "caught");
    glider.visible = !hidden;
    gliderShadow.visible = !hidden;
    let gp: V2 = world.p;
    if (world.phase === "ready") {
      gp = aim ? { x: course.launch.x - aim.pull.x, y: course.launch.y - aim.pull.y } : course.launch;
    }
    glider.position.copy(toWorld(gp.x, gp.y));
    const angle = world.phase === "ready" ? (aim ? Math.atan2(aim.pull.y, aim.pull.x) : 0.25) : world.angle;
    // nose along the sim direction (mirrored), banked toward the camera so the wings read
    const nose = dirWorld(Math.cos(angle), Math.sin(angle)).normalize();
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), nose);
    const bank = world.phase === "flying" ? -0.8 + Math.sin(elapsed * 2.1) * 0.06 + (world.tumble > 0 ? Math.sin(elapsed * 30) * 0.5 : 0) : -0.55;
    qBank.setFromAxisAngle(new THREE.Vector3(1, 0, 0), bank);
    qPitch.copy(q).multiply(qBank);
    glider.quaternion.copy(qPitch);
    void baseYaw;
    setGliderShape(world.phase === "ready" ? 0.2 : world.wing);
    // the bell swings under it and shivers when it rings
    const ringShake = world.bellEnergy > 0.2 ? Math.sin(elapsed * 70) * world.bellEnergy * 0.5 : 0;
    bellHolder.rotation.z = Math.sin(elapsed * 6) * 0.2 + ringShake;
    // the trail: where it has just been, thin and faint at the old end
    if (world.phase === "flying" && !hidden) {
      trailHist.push({ ...gp });
      if (trailHist.length > TRAIL) trailHist.shift();
      trailFade = 1;
    } else {
      trailFade = Math.max(0, trailFade - dt * 2.5);
      if (trailFade === 0) trailHist.length = 0;
    }
    trail.visible = trailHist.length > 1 && trailFade > 0;
    if (trail.visible) {
      const n = trailHist.length;
      for (let i = 0; i < TRAIL; i++) {
        const k = Math.min(i, n - 1);
        const p = trailHist[k];
        const q2 = trailHist[Math.min(k + 1, n - 1)];
        const pr = trailHist[Math.max(k - 1, 0)];
        let dx = q2.x - pr.x;
        let dy = q2.y - pr.y;
        const l = Math.hypot(dx, dy) || 1;
        dx /= l;
        dy /= l;
        const f = k / Math.max(1, n - 1);
        const w = 0.012 + 0.07 * f;
        const a = toWorld(p.x - dy * w, p.y + dx * w, 0.02);
        const b = toWorld(p.x + dy * w, p.y - dx * w, 0.02);
        trailPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
        const alpha = i < n ? Math.pow(f, 1.6) * trailFade : 0;
        trailAlpha[i * 2] = alpha;
        trailAlpha[i * 2 + 1] = alpha;
      }
      trailGeo.attributes.position.needsUpdate = true;
      (trailGeo.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
    }

    gliderShadow.position.copy(toWorld(gp.x, 0.03));
    const hgt = Math.max(0.2, gp.y);
    gliderShadow.scale.setScalar(Math.max(0.4, 1.3 - hgt * 0.15));
    shadowMat.opacity = Math.max(0.05, 0.26 - hgt * 0.035);

    // aim: the elastic stretches to the glider's tail, the dial follows, dots show where it sets off
    if (world.phase === "ready" && aim && aim.tension > 0) {
      bandPull = toWorld(gp.x - Math.cos(angle) * 0.25, gp.y - Math.sin(angle) * 0.25);
      updateBand(band, bandPull);
      if (band2.visible) updateBand(band2, bandPull, 0.05);
      const arc = previewArc(course, aim.pull, 0.32, dots.length);
      dots.forEach((d, i) => {
        const p = arc[i];
        d.visible = Boolean(p) && i > 0;
        if (p) d.position.copy(toWorld(p.x, p.y));
        d.scale.setScalar(1 - i * 0.09);
      });
      dotMat.opacity = 0.35 + 0.55 * aim.tension;
      needle.rotation.x = -(angle - 0.6);
    } else {
      if (band.userData.rest !== true) {
        updateBand(band, null);
        if (band2.visible) updateBand(band2, null, 0.05);
        band.userData.rest = true;
      }
      dots.forEach(d => (d.visible = false));
    }
    if (world.phase === "ready" && aim && aim.tension > 0) band.userData.rest = false;
    crank.rotation.x += dt * 0.0;

    // the target glows softly until it has been hit once
    glowMat.opacity = opts.showGlow ? 0.35 + Math.sin(elapsed * 3) * 0.15 : Math.max(0, glowMat.opacity - dt);
  }

  function ringCup(i: number) {
    if (cups[i]) cups[i].ring = 1;
  }

  let pop = 1;
  return {
    root,
    fanGroup: fan,
    /** a fresh glider appears on the rail with a little pop */
    popGlider() {
      pop = 0;
    },
    tickPop(dt: number) {
      pop = Math.min(1, pop + dt * 4);
      const k = pop < 1 ? 0.3 + 0.7 * pop + Math.sin(pop * Math.PI) * 0.25 : 1;
      glider.scale.setScalar(k * GLIDER_SCALE);
    },
    sync,
    ringCup,
    basketWorld: () => toWorld(course.basket.x, course.basket.y + 0.1, 0.25),
    stationWorld: () => toWorld(stMid, st.top),
    canWorld: () => canAt.clone(),
    crank,
    showSecondBand(on: boolean) {
      band2.visible = on;
      band.userData.rest = false;
    },
    tailWorld(world: WorldState) {
      const s = tailSegment(course, world.cat.tail);
      return { a: toWorld(s.a.x, s.a.y), b: toWorld(s.b.x, s.b.y) };
    },
    dispose() {
      api.scene.remove(root);
      root.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh || (o as THREE.Points).isPoints) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          mats.forEach(mt => mt?.dispose());
        }
      });
      disposables.forEach(d => d.dispose());
    },
  };
}

function xz(v: THREE.Vector3): [number, number] {
  return [v.x, v.z];
}

/** A folded paper dart: nose, tail, two wing tips, keel. Wing tips move to open and fold it. */
export function gliderMesh(material: THREE.Material) {
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0.34, 0, 0, // 0 nose
    -0.28, 0.0, 0, // 1 tail centre
    -0.28, 0.06, -0.2, // 2 left tip
    -0.28, 0.06, 0.2, // 3 right tip
    -0.2, -0.07, 0, // 4 keel
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex([0, 2, 1, 0, 1, 3, 0, 4, 1]);
  geo.computeVertexNormals();
  const m = material.clone();
  (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  return new THREE.Mesh(geo, m);
}

/** A little brass bicycle bell: dome, rim and lever. */
export function bellMesh(material: THREE.Material, scale = 1) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), material);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.01, 6, 16), material);
  rim.rotation.x = Math.PI / 2;
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.016), material);
  lever.position.set(0.05, 0.015, 0);
  g.add(dome, rim, lever);
  g.scale.setScalar(scale);
  return g;
}
