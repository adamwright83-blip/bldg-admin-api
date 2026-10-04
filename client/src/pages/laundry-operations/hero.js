import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { HorizontalTiltShiftShader } from "three/addons/shaders/HorizontalTiltShiftShader.js";
import { VerticalTiltShiftShader } from "three/addons/shaders/VerticalTiltShiftShader.js";
import * as P from "./props.js";
import * as Q from "./props2.js";
import { rng } from "./textures.js";
import { loadWorkers } from "./people.js";
import { buildHud, setStage } from "./hud2.js";

const W = 1920, H = 1080;
const params = new URLSearchParams(location.search);
const DPR = Number(params.get("dpr") || Math.min(2, window.devicePixelRatio || 1));
const CAPTURE = params.has("capture");
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);

await Promise.all(["900 120px Inter", "800 60px Inter", "700 60px Inter"].map((f) => document.fonts.load(f))).catch(() => {});

const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(DPR);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num("exp", 1.0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  document.getElementById("stage").style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}
addEventListener("resize", fit);
fit();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2016);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = num("env", 0.3);
const camera = new THREE.PerspectiveCamera(num("fov", 34), W / H, 0.3, 400);
P.initMaterials();
// warmer stainless for this direction
P.M.steel.color.set(0xb4b0aa);
P.M.steel.roughness = 0.3;
P.M.steel.metalness = 0.72;
const R = rng(1234);

// ---------- light ----------
const hemi = new THREE.HemisphereLight(0xffdcb0, 0x3a2a1c, num("hemi", 0.3));
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffb45c, num("sun", 2.7));
sun.position.set(14, 15, -2);
sun.target.position.set(-2, 0, -1);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const bounce = new THREE.DirectionalLight(0xffb36b, 0.6);
bounce.position.set(-6, 4, 10);
scene.add(bounce);

// ---------- room ----------
const room = new THREE.Group();
scene.add(room);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 40), new THREE.MeshStandardMaterial({ map: Q.warmFloorTexture(44 / 2.0, 40 / 2.0), roughness: 0.28, metalness: 0, envMapIntensity: 0.9 }));
floor.rotation.x = -Math.PI / 2;
floor.position.set(6, 0, 10);
room.add(floor);
const WALL_H = 6.2;
const wallMat = new THREE.MeshStandardMaterial({ color: 0xa69582, roughness: 0.92 });
const backWall = new THREE.Mesh(new THREE.BoxGeometry(30, WALL_H, 0.4), wallMat);
backWall.position.set(5.5, WALL_H / 2, -7.2);
room.add(backWall);
const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.4, WALL_H, 26), wallMat);
leftWall.position.set(-9.2, WALL_H / 2, 5.5);
room.add(leftWall);
// lower wainscot
const wain = new THREE.MeshStandardMaterial({ color: 0x8f8679, roughness: 0.8 });
const wb = new THREE.Mesh(new THREE.BoxGeometry(30, 0.25, 0.1), wain);
wb.position.set(5.5, 0.125, -6.98);
room.add(wb);

// windows (back wall, above the machines)
const outdoor = Q.outdoorTexture();
const glow = new THREE.MeshBasicMaterial({ map: outdoor, color: 0xffffff, toneMapped: true });
glow.color.setScalar(1.55);
const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.5, metalness: 0.4 });
for (let i = 0; i < 6; i++) {
  const x0 = -6.5 + i * 3.5;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.6), glow);
  pane.position.set(x0, 4.25, -6.99);
  room.add(pane);
  for (let k = 0; k <= 4; k++) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.64, 0.08), frameMat);
    v.position.set(x0 - 1.55 + k * 0.775, 4.25, -6.95);
    room.add(v);
  }
  for (let k = 0; k <= 3; k++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(3.14, 0.06, 0.08), frameMat);
    h.position.set(x0, 2.95 + k * 0.866, -6.95);
    room.add(h);
  }
}
// sill + plants
const sill = new THREE.Mesh(P.rbox(21, 0.08, 0.45, 0.01), new THREE.MeshStandardMaterial({ color: 0x6d655b, roughness: 0.7 }));
sill.position.set(2.25, 2.88, -6.78);
room.add(sill);
for (let i = 0; i < 9; i++) {
  const pl = Q.makePlant(R, 0.7 + R() * 0.3, 0x3a3631);
  pl.position.set(-6.8 + i * 2.35 + (R() - 0.5) * 0.6, 2.92, -6.75);
  room.add(pl);
}
// pipes
const pipeMat = new THREE.MeshStandardMaterial({ color: 0xa9a49c, metalness: 0.7, roughness: 0.35 });
const copper = new THREE.MeshStandardMaterial({ color: 0xb87344, metalness: 0.8, roughness: 0.35 });
[[2.5, 0.09, pipeMat, -6.85], [2.72, 0.06, copper, -6.82]].forEach(([y, r, m, z]) => {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 30, 16), m);
  p.rotation.z = Math.PI / 2;
  p.position.set(5.5, y, z);
  room.add(p);
  const q = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 26, 16), m);
  q.rotation.x = Math.PI / 2;
  q.position.set(-8.85, y, 5.5);
  room.add(q);
});
for (let i = 0; i < 8; i++) {
  const v = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 12), pipeMat);
  v.position.set(-5.9 + i * 1.12, 3.1, -6.86);
  room.add(v);
}
// left wall windows
for (let i = 0; i < 4; i++) {
  const z0 = -4.6 + i * 3.5;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.6), glow);
  pane.position.set(-8.99, 4.25, z0);
  pane.rotation.y = Math.PI / 2;
  room.add(pane);
  for (let k = 0; k <= 4; k++) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.64, 0.06), frameMat);
    v.position.set(-8.95, 4.25, z0 - 1.55 + k * 0.775);
    room.add(v);
  }
  for (let k = 0; k <= 3; k++) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 3.14), frameMat);
    h.position.set(-8.95, 2.95 + k * 0.866, z0);
    room.add(h);
  }
}
const sillL = new THREE.Mesh(P.rbox(0.45, 0.08, 14, 0.01), new THREE.MeshStandardMaterial({ color: 0x6d655b, roughness: 0.7 }));
sillL.position.set(-8.78, 2.88, 0.65);
room.add(sillL);
for (let i = 0; i < 5; i++) {
  const pl = Q.makePlant(R, 0.75 + R() * 0.3, 0x3a3631);
  pl.position.set(-8.72, 2.92, -5.2 + i * 2.9);
  room.add(pl);
}
const shelf2 = P.makeShelf(1.8, R, ["#f2b51d", "#2f6df6"]);
shelf2.position.set(-8.55, 0, 3.2);
shelf2.rotation.y = Math.PI / 2;
room.add(shelf2);

// ---------- machines ----------
const machines = {};
const tumblers = [];
for (let i = 0; i < 5; i++) {
  const m = Q.makeMachine({ kind: "washer", num: `W${i + 1}`, run: i !== 3, lcd: i !== 3 ? `${12 + i * 5}:00` : "--" }, R);
  m.g.position.set(-8.45, 0, -5.55 + i * 1.12);
  m.g.rotation.y = Math.PI / 2;
  room.add(m.g);
  if (i !== 3) tumblers.push({ m, speed: 2.4 });
}
for (let i = 0; i < 10; i++) {
  const n = String(i + 1).padStart(2, "0");
  const run = i !== 7;
  const m = Q.makeMachine({ kind: "dryer", num: n, run, lcd: n === "04" ? "11:00" : run ? `${8 + ((i * 7) % 30)}:00` : "--" }, R);
  m.g.position.set(-6.05 + i * 1.12, 0, -6.45);
  room.add(m.g);
  machines[n] = m;
  if (run) tumblers.push({ m, speed: 1.5 + R() * 0.3 });
}
const D04 = machines["04"];
// only the active dryer's interior is bloom-eligible; the rest stay warm but crisp
if (params.get("sball") !== "1")
  Object.values(machines).forEach((m) => { if (m !== D04) m.g.traverse((o) => (o.userData.bloom = false)); });

function makeBracket(w, h) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xff6a10, toneMapped: false, transparent: true });
  mat.color.setRGB(3.2, 0.62, 0.04);
  const t = 0.055;
  [[w, t, 0, h / 2], [w, t, 0, -h / 2], [t, h, -w / 2, 0], [t, h, w / 2, 0]].forEach(([a, b, x, y]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(a, b, t), mat);
    m.position.set(x, y, 0);
    g.add(m);
  });
  g.userData.mat = mat;
  g.traverse((o) => (o.userData.bloom = true));
  return g;
}
const bracket = makeBracket(1.22, 2.12);
bracket.position.set(0, 1.0, 0.56);
D04.g.add(bracket);
D04.g.userData.anchor = bracket;

// ---------- shelving + bollards (left) ----------
const shelf = P.makeShelf(1.8, R, ["#2f6df6", "#16a34a"]);
shelf.position.set(-8.55, 0, 0.9);
shelf.rotation.y = Math.PI / 2;
room.add(shelf);
[[-7.7, -0.3], [-7.7, 2.0], [-6.9, -6.2], [5.3, -6.0]].forEach(([x, z]) => {
  const b = Q.makeBollard();
  b.position.set(x, 0, z);
  room.add(b);
});

// ---------- lanes ----------
const blue = Q.laneDecal(2.5, 9.5, Q.paintLane({ color: "rgba(31,104,224,0.9)", label: "RECEIVING", icon: "truck", textSize: 0.62, textOffset: 1.8, arrows: [[0.5, 0.1, 0, 0.8]] }));
blue.position.set(-6.85, 0.004, 4.6);
room.add(blue);
const green = Q.laneDecal(9.2, 2.6, Q.paintLane({ color: "rgba(38,160,72,0.9)", label: "FOLDING", icon: "shirt", textSize: 0.52, iconOffset: -1.0, arrows: [[0.08, 0.5, -Math.PI / 2, 0.8], [0.93, 0.5, -Math.PI / 2, 0.6]] }));
green.position.set(-0.4, 0.004, -2.75);
room.add(green);
const yellow = Q.laneDecal(3.8, 3.8, Q.paintLane({ color: "rgba(236,170,28,0.9)", label: "DISPATCH", icon: "truck", textSize: 0.56, iconOffset: -0.9, hatch: true, arrows: [[0.15, 0.5, -Math.PI / 2, 0.9]] }));
yellow.position.set(6.3, 0.004, -2.6);
room.add(yellow);

// ---------- folding table + worker ----------
const navy = [0x1c2a52, 0x1c2a52, 0x22325e, 0x1c2a52, 0x18244a];
const white = [0xf6f4ef, 0xf3f0ea, 0xf8f6f2, 0xf1eee7];
const table = P.makeTable(3.2, 1.3, R, [
  [-1.15, 0.15, white.concat(white), 0.05],
  [-0.55, -0.2, white.concat(white).concat(white.slice(0, 2)), -0.03],
  [0.15, 0.2, navy.concat(navy.slice(0, 3)), 0.02],
  [0.7, -0.15, navy.concat(navy), -0.04],
]);
table.position.set(-3.4, 0, 1.0);
room.add(table);
// bins under the table
for (let i = 0; i < 3; i++) {
  const bin = new THREE.Mesh(P.rbox(0.8, 0.32, 0.9, 0.04), new THREE.MeshStandardMaterial({ color: 0xbfc3c8, roughness: 0.6 }));
  bin.position.set(-4.4 + i * 1.0, 0.16, 1.0);
  room.add(bin);
}

// ---------- carts ----------
const cartDefs = [
  [-6.6, -3.3, 0.1, "white", 1.0],
  [-6.6, -1.2, -0.1, "white", 0.9],
  [-4.25, -5.1, 0.05, "white", 1.0],
  [-2.7, -4.95, 0.0, "white", 0], // in front of Dryer 04 (receives the load)
  [2.7, -2.3, 0.2, "navy", 1.0],

  [-5.4, 4.9, 0.25, "white", 1.2], // foreground left
  [0.4, 5.6, -0.15, "navy", 1.0], // foreground bottom
];
const carts = cartDefs.map(([x, z, ry, load, heap], i) => {
  const c = Q.makeWireCart({ load, heap, seed: 10 + i * 13 });
  c.position.set(x, 0, z);
  c.rotation.y = ry;
  room.add(c);
  return c;
});
const cart04 = carts[3];

// ---------- floor plants ----------
[[-8.2, -6.3, 1.4], [-7.6, 5.4, 1.6], [-3.6, 8.2, 1.9], [3.4, 8.6, 1.7], [8.8, -5.2, 1.3], [-8.3, 8.6, 1.8]].forEach(([x, z, s]) => {
  const p = Q.makePlant(R, s);
  p.position.set(x, 0, z);
  room.add(p);
});

// ---------- workers ----------
const crew = await loadWorkers(room, [
  { model: "m", act: "talk", x: -3.6, z: 1.95, yaw: Math.PI + 0.25, skin: "#c18a64", hair: "#15100d", head: "#121316", apron: "#d6c3a0", h: 1.78, phase: 0.4 },
  { model: "f", act: "idle", act2: "walk", x: 3.0, z: -3.9, yaw: -Math.PI / 2, skin: "#8c5a3c", hair: "#15100d", apron: "#d6c3a0", h: 1.7, phase: 0.2 },
]);
const puller = crew.workers[1];

// shadows
scene.traverse((o) => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  o.castShadow = !mats.some((m) => m.transparent || m.isMeshBasicMaterial);
  o.receiveShadow = true;
});
backWall.castShadow = false;
leftWall.castShadow = true;

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, W * DPR, H * DPR);
gtao.updateGtaoMaterial({ radius: num("aor", 0.5), distanceExponent: num("aoe", 1.6), thickness: num("aot", 0.35), scale: num("aos", 1.8), samples: num("aon", 24), distanceFallOff: num("aof", 0.08), screenSpaceRadius: false });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: num("pdr", 6), rings: 3, samples: 16 });
gtao.blendIntensity = num("aob", 1);
// Wire baskets are alpha-cut and the door glass / wrap film are transparent: the AO G-buffer would see them as
// solid slabs (milky film inside the carts, halos). Leave them out of the AO depth/normal pass.
if (params.get("aoskip") !== "0") {
  const baseOverride = gtao._overrideVisibility.bind(gtao);
  gtao._overrideVisibility = () => {
    baseOverride();
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.transparent || m.alphaTest > 0)) {
        o.visible = false;
        gtao._visibilityCache.push(o);
      }
    });
  };
}
if (params.get("gtao") !== "0") composer.addPass(gtao);
if (params.get("aoview") === "1") gtao.output = GTAOPass.OUTPUT.Denoise;
const outline = new OutlinePass(new THREE.Vector2(W * DPR, H * DPR), scene, camera);
Object.assign(outline, { edgeStrength: 4, edgeGlow: 0.25, edgeThickness: 1.5, pulsePeriod: 0 });
outline.visibleEdgeColor.set(0xff6a10);
outline.hiddenEdgeColor.set(0x000000);
composer.addPass(outline);
// Bloom. Default is SELECTIVE (official webgl_postprocessing_unreal_bloom_selective pattern): a second composer
// renders only meshes tagged userData.bloom (dryer interiors, selection frames), everything else drawn black so it
// still occludes; the result is added back in the main chain. ?sbloom=0 restores the old full-scene bloom.
const SELECTIVE = params.get("sbloom") !== "0";
let bloomComposer = null, selBloom = null;
if (!SELECTIVE) {
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(W * DPR, H * DPR), num("bloom", 0.7), 0.5, num("bt", 1.4)));
} else {
  bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.setPixelRatio(DPR);
  bloomComposer.setSize(W, H);
  bloomComposer.addPass(new RenderPass(scene, camera));
  selBloom = new UnrealBloomPass(new THREE.Vector2(W * DPR, H * DPR), num("sbs", 0.45), num("sbr", 0.35), num("sbt", 0.5));
  bloomComposer.addPass(selBloom);
  const mix = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: { baseTexture: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }`,
    }),
    "baseTexture",
  );
  mix.needsSwap = true;
  composer.addPass(mix);
}
const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000 });
const blackCut = new Map();
const swapped = new Map(), hidden = [];
let savedBg = null;
function darkenForBloom() {
  savedBg = scene.background;
  scene.background = new THREE.Color(0x000000);
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible || o.userData.bloom) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m.transparent)) {
      o.visible = false;
      hidden.push(o);
      return;
    }
    const cut = mats.find((m) => m.alphaTest > 0);
    let black = BLACK;
    if (cut) {
      if (!blackCut.has(cut)) blackCut.set(cut, new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: cut.alphaMap, alphaTest: cut.alphaTest, side: cut.side }));
      black = blackCut.get(cut);
    }
    swapped.set(o, o.material);
    o.material = black;
  });
}
function restoreAfterBloom() {
  swapped.forEach((m, o) => (o.material = m));
  swapped.clear();
  hidden.forEach((o) => (o.visible = true));
  hidden.length = 0;
  scene.background = savedBg;
}
function renderFrame() {
  if (bloomComposer) {
    darkenForBloom();
    bloomComposer.render();
    restoreAfterBloom();
  }
  composer.render();
}
const ts = num("ts", 2.2);
const hts = new ShaderPass(HorizontalTiltShiftShader);
hts.uniforms.h.value = ts / (W * DPR);
hts.uniforms.r.value = num("focus", 0.52);
const vts = new ShaderPass(VerticalTiltShiftShader);
vts.uniforms.v.value = ts / (H * DPR);
vts.uniforms.r.value = num("focus", 0.52);
composer.addPass(hts);
composer.addPass(vts);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass());

// ---------- HUD ----------
const hud = document.getElementById("hud");
buildHud(hud);
setStage(hud, "drying");
const uline = hud.querySelector("#uline");
function placeUnderline() {
  const on = hud.querySelector(".st.on");
  const strip = hud.querySelector(".strip");
  if (!on) return;
  const a = on.getBoundingClientRect(), b = strip.getBoundingClientRect();
  const s = b.width / 1741;
  uline.style.left = `${(a.left - b.left) / s - 6}px`;
  uline.style.width = `${a.width / s + 12}px`;
}

// ---------- camera ----------
const camTarget = new THREE.Vector3(num("tx", -2.2), num("ty", 0.4), num("tz", -1.5));
const camDir = new THREE.Vector3(num("dx", 1), num("dy", 1.05), num("dz", 1.0)).normalize();
const camDist = num("dist", 19.5);
function placeCamera() {
  camera.position.copy(camTarget).addScaledVector(camDir, camDist);
  camera.lookAt(camTarget);
  camera.updateProjectionMatrix();
}
placeCamera();

// ---------- connector from the selected object to the inspector ----------
const v = new THREE.Vector3();
const box = new THREE.Box3();
function screenBox(obj) {
  box.setFromObject(obj);
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < 8; i++) {
    v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
    const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { x0, y0, x1, y1 };
}
function placeLink(obj, alpha = 1) {
  const b = screenBox(obj.userData.anchor || obj);
  const ax = b.x1, ay = b.y0 + (b.y1 - b.y0) * 0.3;
  const bx = 1525, by = 262;
  const kx = ax + 30;
  hud.querySelector("#link-l").setAttribute("points", `${ax},${ay} ${kx},${ay} ${bx - 60},${by} ${bx},${by}`);
  const A = hud.querySelector("#link-a"), B = hud.querySelector("#link-b");
  A.setAttribute("cx", ax); A.setAttribute("cy", ay);
  B.setAttribute("cx", bx); B.setAttribute("cy", by);
  hud.querySelector("#link").style.opacity = alpha;
}

// ---------- motion: Dryer 04 -> cart -> folding -> ready -> dispatch ----------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const B = { count: 1.8, done: 4.4, door: 4.7, drop: 5.2, sel: 6.3, pull: 6.6, arrive: 10.0, fold: 10.3, ready: 13.4, bundle: 13.8, ship: 14.6, shipEnd: 17.2, toast: 17.0, end: 20 };

function makePath(pts) {
  const P2 = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const L = [0];
  for (let i = 1; i < P2.length; i++) L.push(L[i - 1] + P2[i].distanceTo(P2[i - 1]));
  const total = L[L.length - 1];
  const at = (u, out = new THREE.Vector2()) => {
    const d = clamp01(u) * total;
    let i = 1;
    while (i < L.length - 1 && L[i] < d) i++;
    const k = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
    return out.lerpVectors(P2[i - 1], P2[i], k);
  };
  return { at, total };
}
const pathFold = makePath([[-2.7, -4.95], [-2.7, -3.3], [-1.0, -0.9], [-0.9, 0.9]]);
const pathShip = makePath([[-0.9, 0.9], [1.2, -0.1], [3.4, -1.3], [5.0, -1.9]]);
const pathWalkIn = makePath([[3.0, -3.9], [-2.7, -4.05]]);
const p2 = new THREE.Vector2(), p3 = new THREE.Vector2();
function heading(path, u) {
  path.at(u - 0.02, p2);
  path.at(u + 0.02, p3);
  return p3.sub(p2).normalize();
}

// laundry that leaves Dryer 04 and lands in the cart
const loadBlobs = [];
{
  const cols = [0xf6f4ef, 0xf1eee7, 0xfbfaf6, 0xe8e3d8, 0x1c2a52, 0xf6f4ef, 0x22325e, 0xf1eee7, 0xfbfaf6];
  const rr = rng(404);
  cols.forEach((c, i) => {
    const m = new THREE.Mesh(P.bagGeometry(i), P.fabric(c, 0.95));
    const s = 0.2 + rr() * 0.1;
    m.scale.set(s * 1.5, s * 0.7, s * 1.2);
    m.castShadow = true;
    m.visible = false;
    cart04.add(m);
    loadBlobs.push({ m, end: new THREE.Vector3((rr() - 0.5) * 0.65, 0.88 + rr() * 0.12 + (i > 5 ? 0.08 : 0), (rr() - 0.5) * 0.38), rot: new THREE.Euler(rr() * 0.5, rr() * 6, rr() * 0.5) });
  });
}
// stack that appears on the table while folding
const foldStack = new THREE.Group();
foldStack.position.set(-2.15, 0.92, 1.05);
room.add(foldStack);
const foldLayers = [];
{
  const cols = [0xf6f4ef, 0xf3f0ea, 0x1c2a52, 0xf6f4ef, 0xf8f6f2, 0x22325e, 0xf1eee7, 0xf6f4ef, 0xf3f0ea];
  let y = 0;
  cols.forEach((c, i) => {
    const h = 0.05;
    const m = new THREE.Mesh(P.rbox(0.4, h, 0.32, 0.02, 2), P.fabric(c, 0.92));
    m.position.set((i % 2 ? 0.01 : -0.01), y + h / 2, 0);
    m.rotation.y = (i % 3 - 1) * 0.03;
    m.visible = false;
    m.castShadow = true;
    foldStack.add(m);
    foldLayers.push(m);
    y += h;
  });
  const wrap = new THREE.Mesh(P.rbox(0.46, y + 0.04, 0.38, 0.05), P.M.wrap.clone());
  wrap.position.y = y / 2;
  wrap.material.opacity = 0;
  foldStack.add(wrap);
  foldStack.userData.wrap = wrap;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), new THREE.MeshBasicMaterial({ color: 0x16a34a, transparent: true, opacity: 0 }));
  tag.position.set(0, y / 2, 0.195);
  foldStack.add(tag);
  foldStack.userData.tag = tag;
}
// orange floor frame that follows the cart once it is selected
const cartBracket = makeBracket(1.4, 1.05);
cartBracket.rotation.x = -Math.PI / 2;
cartBracket.position.y = 0.03;
cart04.add(cartBracket);
cart04.userData.anchor = cart04;
const doorWorld = new THREE.Vector3();
const tmp = new THREE.Vector3();
const lcdAt = (t) => {
  if (t >= B.done) return Q.lcdTex("DONE", "#5dff9a");
  const m = Math.ceil(lerp(11, 0, seg(t, B.count, B.done)));
  return Q.lcdTex(`${m}:00`, "#ff6a3a");
};

// underline positions per step (measured once)
const strip = hud.querySelector(".strip");
const stepBoxes = [...hud.querySelectorAll(".st")].map((el) => ({ l: el.offsetLeft - 6, w: el.offsetWidth + 12 }));
const STEP_I = { drying: 3, folding: 4, ready: 5 };

const pill = hud.querySelector("#i-pill"), bar = hud.querySelector("#i-bar"), pct = hud.querySelector("#i-pct");
const mDry = hud.querySelector("#m-dryers"), mOrders = hud.querySelector("#m-orders");
const toast = hud.querySelector("#toast2");
toast.innerHTML = `<svg width="40" height="40" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#16a34a"/><path d="m7 12.5 3.2 3.2L17 9" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>READY FOR RETURN</b><small>#2817 · 2 bags · 28 lb · due back 5:30 PM</small></div>`;
let hudKey = "";
function setPanel(key, text, color, p, label) {
  if (key !== hudKey) {
    hudKey = key;
    pill.textContent = text;
    pill.style.background = color;
  }
  bar.style.width = `${Math.round(p * 100)}%`;
  bar.style.background = color === "#16a34a" ? "#16a34a" : "";
  pct.textContent = label;
}

const tgt0 = camTarget.clone(), tgt1 = new THREE.Vector3(-1.7, 0.4, -1.0), tgt2 = new THREE.Vector3(1.6, 0.4, -0.6);
function frame(t) {
  crew.update(t);
  // ambient tumbling (Dryer 04 slows to a stop when done)
  tumblers.forEach(({ m, speed }) => {
    if (m === D04) {
      const stop = seg(t, B.done - 0.6, B.done + 0.3);
      m.tumble.rotation.z = speed * (Math.min(t, B.done) - 0.3 * stop * stop);
    } else m.tumble.rotation.z = t * speed;
  });

  // Dryer 04: countdown, cool-down, door, unload
  D04.screen.material.map = lcdAt(t);
  const cool = 1 - seg(t, B.done, B.done + 0.8);
  D04.drumMat.emissiveIntensity = 2.6 * cool;
  D04.backMat.emissiveIntensity = 4.0 * cool;
  D04.glassMat.emissiveIntensity = 1.1 * cool;
  D04.loadMats.forEach((m) => (m.emissiveIntensity = 1.0 * cool));
  D04.lamp.intensity = 2.2 * cool;
  D04.inner.intensity = 1.4 * cool;
  D04.door.rotation.y = -1.75 * ease(seg(t, B.door, B.door + 0.6));
  D04.tumble.visible = t < B.drop + 0.2;
  D04.g.localToWorld(doorWorld.set(0, D04.doorY, D04.front + 0.1));
  loadBlobs.forEach((b, i) => {
    const a = B.drop + i * 0.11, k = seg(t, a, a + 0.45);
    const folded = t > B.fold + i * 0.33;
    b.m.visible = k > 0 && !folded;
    if (!b.m.visible) return;
    cart04.worldToLocal(tmp.copy(doorWorld));
    b.m.position.lerpVectors(tmp, b.end, ease(k));
    b.m.position.y += Math.sin(k * Math.PI) * 0.45;
    b.m.rotation.set(b.rot.x * k, b.rot.y * k, b.rot.z * k);
  });

  // cart: pulled down the FOLDING lane, then to DISPATCH
  let u, path, moving = false;
  if (t < B.ship) {
    u = ease(seg(t, B.pull, B.arrive));
    path = pathFold;
    moving = t > B.pull && t < B.arrive;
  } else {
    u = ease(seg(t, B.ship, B.shipEnd));
    path = pathShip;
    moving = t < B.shipEnd;
  }
  const cp = path.at(u, new THREE.Vector2());
  cart04.position.set(cp.x, 0, cp.y);
  const dir = heading(path, Math.min(0.98, Math.max(0.02, u)));
  if (t > B.pull) cart04.rotation.y = Math.atan2(-dir.y, dir.x);
  // puller walks in along the dryers, then pulls the cart
  if (t < B.pull) {
    const wk = seg(t, B.door - 0.2, B.sel);
    const wp = pathWalkIn.at(ease(wk), new THREE.Vector2());
    puller.root.position.set(wp.x, 0, wp.y);
    const walking = wk > 0 && wk < 1;
    puller.blend = walking ? 1 : 0;
    puller.root.rotation.y = wk >= 1 ? lerp(-Math.PI / 2, 0, seg(t, B.sel, B.pull)) : -Math.PI / 2;
  } else {
    puller.root.position.set(cp.x + dir.x * 0.95, 0, cp.y + dir.y * 0.95);
    puller.root.rotation.y = Math.atan2(dir.x, dir.y);
    puller.blend = moving ? 1 : 0;
  }

  // folding: layers appear on the table as blobs leave the cart
  foldLayers.forEach((m, i) => (m.visible = t > B.fold + i * 0.33 && t < B.bundle + 0.05));
  const wrapK = seg(t, B.ready, B.ready + 0.4);
  foldStack.userData.wrap.material.opacity = 0.35 * wrapK;
  foldStack.userData.tag.material.opacity = wrapK;
  if (t >= B.bundle) {
    // wrapped bundle hops into the cart and rides to dispatch
    foldLayers.forEach((m) => (m.visible = true));
    const k = seg(t, B.bundle, B.bundle + 0.5);
    const from = new THREE.Vector3(-2.15, 0.92, 1.05);
    const to = cart04.localToWorld(new THREE.Vector3(0, 0.72, 0));
    foldStack.position.lerpVectors(from, to, ease(k));
    foldStack.position.y += Math.sin(k * Math.PI) * 0.5;
    if (k >= 1) foldStack.rotation.y = cart04.rotation.y;
  } else foldStack.position.set(-2.15, 0.92, 1.05);

  // selection: dryer -> cart
  const selCart = t >= B.sel;
  const bk = selCart ? 0 : 1 - seg(t, B.sel - 0.3, B.sel);
  const ck = seg(t, B.sel, B.sel + 0.3);
  const pulse = 0.5 + 0.5 * Math.sin(t * 4.0);
  bracket.userData.mat.opacity = bk * (0.75 + 0.25 * pulse);
  cartBracket.userData.mat.opacity = ck * (0.75 + 0.25 * pulse);
  bracket.visible = bk > 0.01;
  cartBracket.visible = ck > 0.01;
  outline.selectedObjects = [selCart ? cart04 : D04.g];
  outline.edgeStrength = 3 + 2 * pulse;

  // panel + timeline
  let stage = "drying";
  if (t < B.done) setPanel("dry", "IN DRYER 04", "#f2581b", lerp(0.72, 1, seg(t, B.count, B.done)), `${Math.round(lerp(72, 100, seg(t, B.count, B.done)))}% complete`);
  else if (t < B.sel) setPanel("drydone", "DRY COMPLETE · DRYER 04", "#16a34a", 1, "100% complete");
  else if (t < B.fold) { stage = "folding"; setPanel("move", "TO FOLDING · TABLE 1", "#f2581b", 0.04, "On the way"); }
  else if (t < B.ready) { stage = "folding"; const k = seg(t, B.fold, B.ready - 0.3); setPanel("fold", "FOLDING · TABLE 1", "#f2581b", k, `${Math.round(k * 100)}% folded`); }
  else { stage = "ready"; setPanel("ready", t < B.ship ? "READY · WRAPPED" : "TO DISPATCH · BAY 2", "#16a34a", 1, "100% complete"); }
  setStage(hud, stage);
  // slide the underline between steps
  const fromI = t < B.sel + 0.5 ? 3 : t < B.ready + 0.5 ? 4 : 5;
  const toI = STEP_I[stage];
  const sk = toI === 4 ? ease(seg(t, B.sel, B.sel + 0.45)) : toI === 5 ? ease(seg(t, B.ready, B.ready + 0.45)) : 1;
  const a = stepBoxes[toI === 3 ? 3 : toI - 1], bb = stepBoxes[toI];
  uline.style.left = `${lerp(a.l, bb.l, toI === 3 ? 1 : sk)}px`;
  uline.style.width = `${lerp(a.w, bb.w, toI === 3 ? 1 : sk)}px`;
  mDry.textContent = t < B.done ? "18/20" : "17/20";
  toast.style.opacity = seg(t, B.toast, B.toast + 0.35);
  toast.style.transform = `translateX(-50%) scale(${0.94 + 0.06 * ease(seg(t, B.toast, B.toast + 0.35))})`;

  // camera: slow push toward the work
  const ck2 = ease(seg(t, 2, 11)), ck3 = ease(seg(t, 13.6, 17.4));
  camTarget.lerpVectors(tgt0, tgt1, ck2).lerp(tgt2, ck3);
  camera.position.copy(camTarget).addScaledVector(camDir, lerp(lerp(camDist, camDist * 0.9, ck2), camDist * 0.95, ck3));
  camera.lookAt(camTarget);

  renderFrame();
  placeLink(selCart ? cart04 : D04.g, 1);
}

window.__frame = (t) => frame(t);
window.__ready = true;
if (!CAPTURE) {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => frame((num("t", 0) + clock.getElapsedTime()) % B.end));
} else frame(num("t", 1));
