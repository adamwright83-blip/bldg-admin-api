import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import * as T from "./textures.js";
import * as P from "./props.js";
import { ORDERS, byCart, STAGE_STYLE, SITE } from "./data.js";
import { renderHud, chipHtml } from "./ui.js";
import { loadWorkers } from "./people.js";
import { buildCity } from "./city.js";

const W = 1920,
  H = 1080;
const params = new URLSearchParams(location.search);
const DPR = Number(params.get("dpr") || Math.min(2, window.devicePixelRatio || 1));
const CAPTURE = params.has("capture");

await Promise.all(["800 120px Inter", "700 60px Inter", "600 60px Inter"].map((f) => document.fonts.load(f))).catch(() => {});

// ---------- renderer ----------
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(DPR);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  const st = document.getElementById("stage");
  st.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}
addEventListener("resize", fit);
fit();

const scene = new THREE.Scene();
const BG = 0xe6ebf0;
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 45, 90);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

const camera = new THREE.PerspectiveCamera(24, W / H, 0.5, 2500);

P.initMaterials();
const R = T.rng(42);

// ---------- lights ----------
const hemi = new THREE.HemisphereLight(0xf5f8ff, 0xd4ccbf, 0.85);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e2, 2.3);
sun.position.set(-7, 16, 9);
sun.target.position.set(0, 0, -1);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 11, bottom: -11, near: 1, far: 50 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.025;
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight(0xe8f0ff, 0.55);
fill.position.set(12, 8, 14);
scene.add(fill);

// ---------- room ----------
const RX = 8,
  RZ = 5.5;
const room = new THREE.Group();
scene.add(room);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(RX * 2, RZ * 2),
  new THREE.MeshStandardMaterial({ map: T.floorTexture((RX * 2) / 2.4, (RZ * 2) / 2.4), roughness: 0.42, metalness: 0 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
room.add(floor);
const slab = new THREE.Mesh(P.rbox(RX * 2 + 0.3, 0.55, RZ * 2 + 0.3, 0.04), P.M.slab);
slab.position.set(0, -0.28, 0);
room.add(slab);
// exterior ground + sidewalk
const groundMat = new THREE.MeshStandardMaterial({ color: 0xe3e8ee, roughness: 1 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.55;
ground.receiveShadow = true;
scene.add(ground);
const walkMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 1 });
const walk = new THREE.Mesh(new THREE.PlaneGeometry(RX * 2 + 12, RZ * 2 + 12), walkMat);
walk.rotation.x = -Math.PI / 2;
walk.position.y = -0.545;
walk.receiveShadow = true;
scene.add(walk);

// walls (cutaway: back + left)
const WH = 3.3;
const back = new THREE.Mesh(P.rbox(RX * 2 + 0.3, WH, 0.28, 0.03), P.M.wall);
back.position.set(0, WH / 2, -RZ - 0.14);
room.add(back);
const left = new THREE.Mesh(P.rbox(0.28, WH, RZ * 2 + 0.3, 0.03), P.M.wall);
left.position.set(-RX - 0.14, WH / 2, 0);
room.add(left);
// cap trims + skirting
const cap = new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.5 });
const capA = new THREE.Mesh(P.rbox(RX * 2 + 0.34, 0.06, 0.32, 0.01), cap);
capA.position.set(0, WH, -RZ - 0.14);
const capB = new THREE.Mesh(P.rbox(0.32, 0.06, RZ * 2 + 0.34, 0.01), cap);
capB.position.set(-RX - 0.14, WH, 0);
room.add(capA, capB);
// black machine surround behind dryers
const sur = new THREE.Mesh(P.rbox(9.6, 2.3, 0.06, 0.01), P.M.wallTrim);
sur.position.set(-2.75, 1.15, -RZ + 0.02);
room.add(sur);

// ---------- dryers on back wall ----------
const tumblers = [];
const dryerUnits = {};
let dryersOn = 0;
const DRY_Z = -RZ + 0.58;
const louiseColors = [0xf3f1ec, 0xe6ddd0, 0x93a9c2, 0x3a4660];
for (let s = 0; s < 10; s++) {
  const topN = String(s * 2 + 1).padStart(2, "0"),
    botN = String(s * 2 + 2).padStart(2, "0");
  const topRun = R() > 0.38,
    botRun = botN === "04" ? true : R() > 0.35;
  dryersOn += topRun + botRun;
  const mins = () => `${Math.floor(8 + R() * 30)}:00`;
  const d = P.makeDryerStack(topN, botN, {
    topRun, botRun,
    topLcd: topRun ? mins() : "--",
    botLcd: botN === "04" ? "18:00" : botRun ? mins() : "--",
    botLaundry: botN === "04" ? louiseColors : null,
  }, R);
  d.g.position.set(1.4 - s * 0.9, 0, DRY_Z);
  room.add(d.g);
  if (topRun) tumblers.push({ g: d.tumblers[0], speed: 1.6 + R() * 0.4 });
  if (botRun) tumblers.push({ g: d.tumblers[1], speed: 1.6 + R() * 0.4 });
  dryerUnits[topN] = d.units.top;
  dryerUnits[botN] = d.units.bot;
}

{
  const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 9.4, 32), P.M.steelSatin);
  pl.rotation.z = Math.PI / 2;
  pl.position.set(-2.65, 3.0, DRY_Z - 0.22);
  room.add(pl);
  for (let i = 0; i < 6; i++) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 32), P.M.steelDark);
    band.rotation.z = Math.PI / 2;
    band.position.set(-7.0 + i * 1.75, 3.0, DRY_Z - 0.22);
    room.add(band);
  }
}

// ---------- washers on left wall ----------
let washersOn = 0;
const washers = {};
for (let i = 0; i < 7; i++) {
  const n = i + 1;
  const run = n === 3 ? true : n === 6 ? false : R() > 0.25;
  washersOn += run;
  const w = P.makeWasher(`W${n}`, run, run ? `${Math.floor(10 + R() * 25)}:00` : "--", R);
  w.g.position.set(-RX + 0.55, 0, -3.9 + i * 1.08);
  w.g.rotation.y = Math.PI / 2;
  room.add(w.g);
  washers[n] = w.g;
  if (run) tumblers.push({ g: w.tumble, speed: 2.6 });
}

for (let i = 0; i < 4; i++) {
  const n = 8 + i;
  for (const side of [1, -1]) {
    if (side === -1) continue;
    const run = R() > 0.3;
    washersOn += run;
    const w = P.makeWasher(`W${n}`, run, run ? `${Math.floor(10 + R() * 25)}:00` : "--", R);
    w.g.scale.setScalar(1.12);
    w.g.position.set(-4.65 + i * 1.08, 0, -0.1);
    room.add(w.g);
    washers[n] = w.g;
    if (run) tumblers.push({ g: w.tumble, speed: 2.4 });
  }
}
{
  const plinth = new THREE.Mesh(P.rbox(4.5, 1.25, 0.5, 0.02), P.M.steelDark);
  plinth.position.set(-3.03, 0.625, -0.72);
  room.add(plinth);
  // detergent drums by the left wall
  const drumMat = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.45 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  [[-7.5, -4.85], [-7.0, -4.85], [-7.5, -4.35]].forEach(([x, z]) => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.85, 28), drumMat);
    d.position.set(x, 0.425, z);
    room.add(d);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12), capMat);
    c.position.set(x + 0.08, 0.87, z);
    room.add(c);
  });
}

// ---------- signage ----------
const sign = (tex, w, h, x, y, z, ry = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  room.add(m);
};
sign(T.signTexture("DRY", "DRYERS 01 – 20"), 1.6, 0.4, -5.6, 2.75, -RZ + 0.01);
sign(T.signTexture("WASH", "WASHERS W1 – W11"), 1.6, 0.4, -RX + 0.01, 2.6, -1.0, Math.PI / 2);
sign(T.signTexture("READY", "FOR RETURN TODAY"), 1.6, 0.4, 6.5, 2.75, -RZ + 0.01);
// wall monitor
const mon = new THREE.Group();
mon.add(new THREE.Mesh(P.rbox(1.7, 0.98, 0.06, 0.02), P.M.black));
const scr = new THREE.Mesh(
  new THREE.PlaneGeometry(1.62, 0.9),
  new THREE.MeshBasicMaterial({
    map: T.monitorTexture([
      ["THE LOUISE · Dryer 04", "18 min", "#f08a24"],
      ["OPUS LA · Washer W3", "22 min", "#2f7cf6"],
      ["LOS FELIZ TOWERS · Table 1", "Folding", "#8b5cf6"],
      ["CENTURY PARK EAST · Scale", "41 lb", "#64748b"],
      ["OPUS LA · Ready rack", "Ready", "#16a34a"],
    ]),
    toneMapped: false,
  }),
);
scr.position.z = 0.032;
mon.add(scr);
mon.position.set(3.6, 2.6, -RZ + 0.05);
room.add(mon);

// ---------- floor zones ----------
const tapeMat = new THREE.MeshStandardMaterial({ color: 0xe8b52a, roughness: 0.6 });
function tapeRect(x0, z0, x1, z1) {
  const t = 0.06;
  const seg = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), tapeMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.004, z);
    m.receiveShadow = true;
    room.add(m);
  };
  seg(x1 - x0, t, (x0 + x1) / 2, z0);
  seg(x1 - x0, t, (x0 + x1) / 2, z1);
  seg(t, z1 - z0, x0, (z0 + z1) / 2);
  seg(t, z1 - z0, x1, (z0 + z1) / 2);
}
tapeRect(-7.6, 2.4, -3.0, 5.3);
tapeRect(2.3, -5.35, 7.8, -2.3);
tapeRect(0.9, -1.6, 6.0, 2.2);
const floorLabel = (txt, sub, x, z, w = 2.2) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: T.floorLabelTexture(txt, sub), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.006, z);
  room.add(m);
};
floorLabel("RECEIVING", "WEIGH · TAG · SORT", -5.0, 4.9);
floorLabel("FOLD", "TABLES 1 – 2", 2.25, 1.75, 1.9);
floorLabel("READY", "RETURN TODAY", 3.5, -2.75, 1.9);

// ---------- folding tables ----------
const towel = [0xf4f2ed, 0xf4f2ed, 0xe9e4da],
  tees = [0x2f3a4f, 0x8a97a8, 0xf1efe9, 0x2f3a4f, 0xb9c7d6],
  mix = [0xd8c6b4, 0xf1efe9, 0x6c7f99, 0xe7d9cf];
const t1 = P.makeTable(3.4, 1.15, R, [
  [-1.2, 0.1, tees.concat(tees.slice(0, 2)), 0.05],
  [-0.65, -0.15, towel.concat(towel), -0.04],
  [0.2, 0.15, mix.concat(mix), 0.02],
  [1.05, -0.1, towel.concat([0xdfe6ee, 0xdfe6ee]), 0.03],
]);
t1.position.set(3.6, 0, -0.35);
room.add(t1);
const t2 = P.makeTable(3.4, 1.15, R, [
  [-0.9, 0.05, mix, 0.04],
  [0.3, -0.1, towel.concat(towel.slice(0, 2)), -0.03],
  [1.1, 0.12, tees, 0.05],
]);
t2.position.set(3.6, 0, 1.35);
room.add(t2);

// ---------- ready zone ----------
const shelf = P.makeShelf(2.6, R, ["#16a34a", "#2f7cf6", "#e9a91f", "#16a34a"]);
shelf.position.set(3.6, 0, -RZ + 0.36);
room.add(shelf);
const rack = P.makeGarmentRack(2.3, R, [0x2f3a4f, 0xf1efe9, 0x6c7f99, 0x1f2430, 0xb9a48f, 0x8a97a8]);
rack.position.set(6.6, 0, -4.35);
room.add(rack);

// ---------- receiving ----------
const scaleP = P.makeScale("41.2 LB");
scaleP.position.set(-6.4, 0, 3.55);
scaleP.rotation.y = Math.PI / 2;
room.add(scaleP);
[[0xf1efe9, -6.35, 3.45], [0x3a4660, -6.45, 3.75]].forEach(([c, x, z], i) => {
  const b = P.makeBag(c, 20 + i, 0.6, 0.48, 0.5);
  b.position.set(x, 0.32, z);
  b.rotation.y = i * 1.3;
  room.add(b);
});
const pile = [[0xf1efe9, -7.3, 4.6], [0x9fb3c8, -6.8, 4.9], [0x2f3a4f, -7.35, 4.0], [0xd9cdb5, -7.0, 5.0], [0xf1efe9, -7.1, 4.35, 0.62]];
pile.forEach(([c, x, z, y = 0.22], i) => {
  const b = P.makeBag(c, 30 + i, 0.6, 0.5, 0.52);
  b.position.set(x, y, z);
  b.rotation.y = i * 2.1;
  room.add(b);
});

// ---------- carts ----------
const CANVAS = { tan: 0xdcc59a, navy: 0x34405a, grey: 0x9aa1aa, white: 0xe9e6df };
const cartDefs = [
  { cart: "C-07", pos: [0.5, -3.75], rot: 0.05, canvas: CANVAS.tan, bags: [0xf3f1ec] },
  { cart: "C-03", pos: [-6.05, -0.7], rot: Math.PI / 2 + 0.1, canvas: CANVAS.navy, bags: [0x9fb3c8, 0xf1efe9, 0x2f3a4f] },
  { cart: "C-11", pos: [1.45, 0.75], rot: 0.15, canvas: CANVAS.white, bundles: 3 },
  { cart: "C-05", pos: [-4.6, 3.75], rot: -0.25, canvas: CANVAS.grey, bags: [0xf1efe9, 0x3a4660, 0xd9cdb5, 0x9fb3c8] },
  { cart: "C-01", pos: [5.55, -2.75], rot: 0, canvas: CANVAS.tan, bundles: 4 },
  { cart: null, pos: [-2.9, -3.7], rot: -0.12, canvas: CANVAS.grey, bags: [0xd9cdb5, 0x9fb3c8], label: ["LOS FELIZ TOWERS", "C-09 · Drying"] },
  { cart: null, pos: [-6.2, 1.25], rot: Math.PI / 2 - 0.08, canvas: CANVAS.tan, bags: [0xf1efe9, 0x6c7f99], label: ["THE LOUISE", "C-04 · Washing"] },
];
const carts = {};
cartDefs.forEach((d, i) => {
  const o = d.cart ? byCart[d.cart] : null;
  const [name, sub] = o ? [o.building, `${o.cart} · ${o.lb} lb`] : d.label;
  const color = o ? STAGE_STYLE[o.stage].tex : STAGE_STYLE[d.label[1].includes("Dry") ? "drying" : "washing"].tex;
  const g = P.makeCart({ canvas: d.canvas, bags: d.bags || [], bundles: d.bundles || 0, seed: 100 + i * 7, tag: T.tagTexture(name, sub, color) });
  g.position.set(d.pos[0], 0, d.pos[1]);
  g.rotation.y = d.rot;
  room.add(g);
  if (d.cart) carts[d.cart] = g;
});

// ---------- workers ----------
const crew = await loadWorkers(room, [
  { model: "m", act: "kneel", x: -6.62, z: -1.74, yaw: -Math.PI / 2, skin: "#a8704e" },
  { model: "f", act: "carry", x: -4.9, z: 2.7, yaw: Math.atan2(-0.45, -1), skin: "#e0b394", hair: "#2a1d15", path: [-4.9, 2.7, -5.6, 1.1, 0.22], bag: 0x9fb3c8 },
  { model: "f", act: "talk", x: 2.9, z: -1.32, yaw: 0.15, skin: "#c99a78", hair: "#15100d" },
  { model: "m", act: "idle", x: 4.7, z: -1.3, yaw: -0.1, skin: "#6e4631", hair: "#0f0b09" },
  { model: "m", act: "talk", x: 3.3, z: 2.42, yaw: Math.PI, skin: "#d2a07f", hair: "#3a2a1c", phase: 1.3 },
  { model: "f", act: "folded", x: -5.5, z: 3.05, yaw: -Math.PI / 2 - 0.3, skin: "#8c5a3c", hair: "#15100d" },
  { model: "m", act: "idle", act2: "walk", x: 4.6, z: -2.75, yaw: Math.PI / 2, skin: "#e0b394", hair: "#5b3a24", phase: 0.6 },
]);
const pusher = crew.workers[6];

// ---------- van on the loading dock ----------
const van = P.makeVan(T.vanLogoTexture(SITE.brand));
van.position.set(11.0, -0.55, -2.4);
scene.add(van);
const dock = new THREE.Mesh(P.rbox(0.2, 0.5, 2.6, 0.03), P.M.rubber);
dock.position.set(8.2, -0.3, -2.4);
scene.add(dock);

// ---------- exterior trees ----------
[[-3.5, -8.6, 1.2], [-10.8, -6.8, 1.15], [-11.2, -1.8, 1.0]].forEach(([x, z, s]) => {
  const t = P.makeTree(R, s);
  t.position.set(x, -0.55, z);
  scene.add(t);
});

// shadows everywhere (except transparent)
scene.traverse((o) => {
  if (o.isMesh) {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const transparent = mats.some((m) => m.transparent);
    o.castShadow = !transparent && !mats[0].isMeshBasicMaterial;
    o.receiveShadow = true;
  }
});

// ---------- city + sky ----------
const city = buildCity(scene);
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(1800, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(BG) }, uHor: { value: new THREE.Color(BG) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHor; varying vec3 vP;
      void main(){ float h = clamp(vP.y * 2.2, 0.0, 1.0); gl_FragColor = vec4(mix(uHor, uTop, pow(h, 0.7)), 1.0);
      #include <colorspace_fragment>
      }`,
  }),
);
scene.add(sky);
scene.background = null;
const nightLights = [[-4, 2.8, -2], [3, 2.8, -2], [-4, 2.8, 3], [3.5, 2.8, 2.5]].map(([x, y, z]) => {
  const l = new THREE.PointLight(0xffd9a0, 0, 16, 1);
  l.position.set(x, y, z);
  room.add(l);
  return l;
});

// ---------- selection visuals ----------
const halo = new THREE.Group();
const haloDisc = new THREE.Mesh(new THREE.CircleGeometry(1.0, 64), new THREE.MeshBasicMaterial({ map: T.haloTexture(), transparent: true, depthWrite: false, toneMapped: false }));
haloDisc.rotation.x = -Math.PI / 2;
haloDisc.position.y = 0.008;
const haloRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.9, 96), new THREE.MeshBasicMaterial({ color: 0xffc23a, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
haloRing.rotation.x = -Math.PI / 2;
haloRing.position.y = 0.01;
halo.add(haloDisc, haloRing);
const brMat = new THREE.MeshBasicMaterial({ color: 0xffc23a, toneMapped: false, transparent: true });
[[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sz]) => {
  const a = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.035), brMat);
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.22), brMat);
  [a, b].forEach((m) => { m.rotation.x = -Math.PI / 2; });
  a.position.set(sx * 0.66 - sx * 0.11 + sx * 0.0175, 0.012, sz * 0.48);
  b.position.set(sx * 0.66, 0.012, sz * 0.48 - sz * 0.11 + sz * 0.0175);
  halo.add(a, b);
});
room.add(halo);

// ---------- post ----------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(DPR);
composer.setSize(W, H);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, W * DPR, H * DPR);
gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 3, samples: 16 });
gtao.blendIntensity = 1.0;
composer.addPass(gtao);
const outline = new OutlinePass(new THREE.Vector2(W * DPR, H * DPR), scene, camera);
Object.assign(outline, { edgeStrength: 7, edgeGlow: 0.9, edgeThickness: 2.2, pulsePeriod: 0 });
outline.visibleEdgeColor.set(0xffc23a);
outline.hiddenEdgeColor.set(0xb07d10);
composer.addPass(outline);
const bloom = new UnrealBloomPass(new THREE.Vector2(W * DPR, H * DPR), 0, 0.5, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.addPass(new SMAAPass());

// ---------- timeline helpers ----------
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const lerp = (a, b, k) => a + (b - a) * k;
const BEAT = {
  click: 3.2, // select C-01
  push: 6.3, // cart starts rolling to the van
  doors: 8.9,
  drive: 9.5,
  done: 10.2, // RETURN COMPLETE
  dusk: 13.6,
  route: 15.0,
  lit: 17.4,
};

function orderAt(cart, t) {
  const o = byCart[cart];
  if (cart !== "C-01") return o;
  if (t < BEAT.push + 0.15) return o;
  if (t < BEAT.done)
    return { ...o, stage: "returning", machine: "Van 2", left: "Loading · Van 2", pct: 0.35 + 0.6 * seg(t, BEAT.push, BEAT.done) };
  return { ...o, stage: "returned", machine: "Delivered", left: "Delivered 11:24 AM", pct: 1 };
}
function clockAt(t) {
  const m = Math.round(lerp(56, 84, ease(seg(t, BEAT.push, BEAT.done))));
  return `${10 + Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

// ---------- HUD + chips ----------
const hud = document.getElementById("hud");
const chipsEl = document.getElementById("chips");
const cityEl = document.createElement("div");
cityEl.id = "cityui";
document.getElementById("stage").appendChild(cityEl);
cityEl.innerHTML = `
  <div class="lcount"><span class="lic"></span><b id="lnum">102</b><small>LANTERNS LIT</small></div>
  <div class="ltag" id="ltag"><div class="plus">+1 LANTERN</div><b>OPUS LA</b><small>Return complete · 11:24 AM</small></div>
  ${city.lanterns.filter((l) => !l.hero).map((l, i) => `<div class="lsmall" id="ls${i}">${l.name}</div>`).join("")}
`;
const cursor = document.createElement("div");
cursor.className = "cursor";
cursor.innerHTML = `<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5 19.5 12l-7 1.6L9 20.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg><i></i>`;
document.getElementById("stage").appendChild(cursor);

const baseRows = ORDERS.slice(0, 4).map((o) => ({ machine: o.machine, building: o.building, stage: o.stage, left: o.stage === "drying" || o.stage === "washing" ? o.left.replace(" left", "") : STAGE_STYLE[o.stage].text }));
const chips = ORDERS.map((o) => {
  const el = document.createElement("div");
  el.className = "chip";
  chipsEl.appendChild(el);
  return { cart: o.cart, el, obj: carts[o.cart], key: "" };
});
let hudKey = "";
const v = new THREE.Vector3();
function project(p) {
  v.copy(p).project(camera);
  return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H, v.z];
}

// ---------- camera ----------
const DIR_A = new THREE.Vector3(12.5, 14.2, 15.5);
const DIST_A = DIR_A.length() * 1.1;
DIR_A.normalize();
const DIR_C = new THREE.Vector3(10.5, 15.5, 13.5).normalize();
const DIR_B = new THREE.Vector3(3.5, 13.5, 18.5).normalize();
const KEYS = {
  A: { target: new THREE.Vector3(0.2, 0.4, -0.9), dist: DIST_A, ox: 150 },
  B: { target: new THREE.Vector3(5.4, 0.4, -2.6), dist: DIST_A * 0.84, ox: 150 },
  C: { target: new THREE.Vector3(8.4, 0.4, -2.6), dist: DIST_A * 0.98, ox: 150 },
  D: { target: new THREE.Vector3(4.0, 0.4, -1.6), dist: DIST_A * 0.95, ox: 150 },
  E: { target: new THREE.Vector3(Number(params.get('ex') ?? -20), Number(params.get('ey') ?? 34), Number(params.get('ez') ?? -44)), dist: Number(params.get('ed') ?? 270), ox: 0 },
};
const tgt = new THREE.Vector3(),
  dir = new THREE.Vector3();
function mixKey(a, b, k) {
  tgt.lerpVectors(a.target, b.target, k);
  return { dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), k)), ox: lerp(a.ox, b.ox, k) };
}
function camAt(t) {
  let r;
  if (t < 3.4) r = mixKey(KEYS.A, KEYS.A, 0);
  else if (t < 6.3) r = mixKey(KEYS.A, KEYS.B, ease(seg(t, 3.4, 5.9)));
  else if (t < 10.2) r = mixKey(KEYS.B, KEYS.C, ease(seg(t, 6.3, 9.8)));
  else if (t < 13.8) r = mixKey(KEYS.C, KEYS.D, ease(seg(t, 10.2, 13.8)));
  else {
    const kd = ease(seg(t, 13.8, 17.6));
    const kt = ease(seg(t, 14.6, 18.8));
    r = mixKey(KEYS.D, KEYS.E, kt);
    r.dist = Math.exp(lerp(Math.log(KEYS.D.dist), Math.log(KEYS.E.dist), kd));
    r.ox = lerp(KEYS.D.ox, KEYS.E.ox, kd);
    r.k = kd;
  }
  const kc = r.k || 0;
  // orbit toward a front view while the cart is loaded, then back
  const kb = ease(seg(t, 5.0, 7.6)) * (1 - ease(seg(t, 10.6, 13.6)));
  dir.copy(DIR_A).lerp(DIR_B, kb).lerp(DIR_C, kc).normalize();
  // slow orbit drift in the final hold
  const drift = seg(t, 18.6, 23) * 0.06;
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), drift);
  camera.fov = lerp(24, 30, kc);
  camera.position.copy(tgt).addScaledVector(dir, r.dist);
  camera.lookAt(tgt);
  camera.updateProjectionMatrix();
  camera.setViewOffset(W, H, r.ox, -10 * (1 - kc), W, H);
  scene.fog.near = Math.max(45, r.dist * 1.7);
  scene.fog.far = Math.max(90, r.dist * 4.5);
}

// ---------- palette for day -> dusk ----------
const C = (h) => new THREE.Color(h);
const DAY = { top: C(0xdfe6ee), hor: C(0xeef2f6), fog: C(BG), ground: C(0xe3e8ee), walk: C(0xf2f4f7), hemiS: C(0xf5f8ff), hemiG: C(0xd4ccbf) };
const DUSK = { top: C(0x0d1424), hor: C(0x6b4a5c), fog: C(0x2a2838), ground: C(0x1c2230), walk: C(0x262d3b), hemiS: C(0x5e74a8), hemiG: C(0x1a1d26) };
const tmpC = new THREE.Color();
function setDusk(k) {
  sky.material.uniforms.uTop.value.lerpColors(DAY.top, DUSK.top, k);
  sky.material.uniforms.uHor.value.lerpColors(DAY.hor, DUSK.hor, k);
  scene.fog.color.lerpColors(DAY.fog, DUSK.fog, k);
  groundMat.color.lerpColors(DAY.ground, DUSK.ground, k);
  walkMat.color.lerpColors(DAY.walk, DUSK.walk, k);
  hemi.color.lerpColors(DAY.hemiS, DUSK.hemiS, k);
  hemi.groundColor.lerpColors(DAY.hemiG, DUSK.hemiG, k);
  hemi.intensity = lerp(0.85, 0.55, k);
  sun.intensity = lerp(2.3, 0.35, k);
  sun.color.lerpColors(C(0xfff3e2), C(0xff9a5a), k);
  fill.intensity = lerp(0.55, 0.15, k);
  scene.environmentIntensity = lerp(0.55, 0.25, k);
  nightLights.forEach((l) => (l.intensity = k * 7));
  bloom.strength = Math.max(0, (k - 0.55) / 0.45) * 0.6;
  city.setNight(k);
}

// ---------- frame ----------
function frame(t) {
  crew.update(t);
  tumblers.forEach((u) => (u.g.rotation.z = t * u.speed));

  // C-01 rolls to the van
  const roll = ease(seg(t, BEAT.push, BEAT.doors - 0.1));
  const c01 = carts["C-01"];
  c01.position.set(lerp(5.55, 9.7, roll), roll > 0.62 ? -0.08 * seg(roll, 0.62, 0.7) : 0, lerp(-2.75, -2.4, seg(roll, 0, 0.4)));
  const pushing = t > BEAT.push - 0.2 && c01.position.x < 8.0;
  pusher.blend = pushing ? 1 : seg(t, BEAT.push - 0.4, BEAT.push) * (c01.position.x < 8.0 ? 1 : 0);
  pusher.root.position.set(Math.min(c01.position.x - 0.95, 7.0), 0, c01.position.z);
  van.userData.setDoors(1 - ease(seg(t, BEAT.doors, BEAT.drive)));
  const drive = seg(t, BEAT.drive, BEAT.drive + 2.2);
  van.position.x = 11.0 + drive * drive * 26;
  c01.visible = van.position.x < 16;
  if (van.position.x > 11.01) c01.position.x = 9.7 + (van.position.x - 11.0);

  // selection
  const selCart = t < BEAT.click ? "C-07" : "C-01";
  const sel = orderAt(selCart, t);
  const gSel = carts[selCart];
  const dayK = 1 - seg(t, BEAT.dusk, BEAT.dusk + 0.8);
  outline.selectedObjects = dayK > 0.05 && gSel.visible ? (selCart === "C-07" ? [gSel, dryerUnits["04"]] : [gSel]) : [];
  halo.position.set(gSel.position.x, 0, gSel.position.z);
  halo.rotation.y = gSel.rotation.y;
  const p = 0.5 + 0.5 * Math.sin(t * 3.2);
  const haloK = (selCart === "C-01" ? seg(t, BEAT.click, BEAT.click + 0.35) * (1 - seg(t, BEAT.push + 1.6, BEAT.push + 2.2)) : 1) * dayK;
  haloRing.material.opacity = (0.65 + 0.35 * p) * haloK;
  haloDisc.material.opacity = haloK;
  brMat.opacity = haloK;
  haloRing.scale.setScalar(1 + 0.03 * p);
  outline.edgeStrength = 5 + 3 * p;

  // HUD
  const done = t >= BEAT.done;
  const key = [selCart, sel.stage, clockAt(t), done].join("|");
  if (key !== hudKey) {
    hudKey = key;
    renderHud(hud, {
      selected: sel, clock: clockAt(t), inPlant: done ? 23 : 24,
      dryersOn, dryersAll: 20, washersOn, washersAll: 11,
      ontime: done ? "98.5%" : "98.4%", rows: baseRows,
    });
  }
  hud.style.opacity = dayK;
  chipsEl.style.opacity = dayK;
  const panel = hud.querySelector(".panel");
  const pk = selCart === "C-01" ? ease(seg(t, BEAT.click + 0.05, BEAT.click + 0.4)) : 1;
  panel.style.opacity = pk;
  panel.style.transform = `translateX(${(1 - pk) * 18}px)`;
  const toast = hud.querySelector("#toast");
  const tk = seg(t, BEAT.done, BEAT.done + 0.35);
  toast.style.opacity = tk;
  toast.style.transform = `translateX(-50%) scale(${0.92 + 0.08 * ease(tk)})`;
  toast.innerHTML = `<svg width="38" height="38" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#e9a91f"/><path d="m7 12.5 3.2 3.2L17 9" stroke="#1b2230" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><div><b>RETURN COMPLETE</b><small>OPUS LA · 2 bags · 19 lb · delivered 11:24 AM</small></div>`;

  chips.forEach((c) => {
    const o = orderAt(c.cart, t);
    const isSel = c.cart === selCart;
    const k2 = `${o.stage}|${isSel}`;
    if (k2 !== c.key) {
      c.key = k2;
      c.el.className = "chip" + (isSel ? " sel" : "");
      c.el.innerHTML = chipHtml(o, isSel);
    }
    c.obj.getWorldPosition(v);
    v.y += 1.62;
    const [x, y] = project(v);
    c.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    c.el.style.opacity = c.obj.visible ? 1 : 0;
  });

  // cursor
  const cA = [1180, 780];
  const target = chips.find((c) => c.cart === "C-01");
  carts["C-01"].getWorldPosition(v);
  v.y += 0.9;
  const cB = project(v);
  const mk = ease(seg(t, 1.9, BEAT.click - 0.05));
  const cx = lerp(cA[0], cB[0], mk),
    cy = lerp(cA[1], cB[1], mk) + Math.sin(mk * Math.PI) * -40;
  const cVis = seg(t, 1.7, 2.0) * (1 - seg(t, BEAT.click + 0.9, BEAT.click + 1.3));
  const press = t > BEAT.click - 0.05 && t < BEAT.click + 0.12 ? 0.88 : 1;
  cursor.style.opacity = cVis;
  cursor.style.transform = `translate(${cx}px, ${cy}px) scale(${press})`;
  const rk = seg(t, BEAT.click, BEAT.click + 0.6);
  cursor.querySelector("i").style.cssText = `opacity:${rk > 0 && rk < 1 ? 1 - rk : 0};transform:translate(-50%,-50%) scale(${0.3 + rk * 1.6})`;

  // dusk + city
  const dusk = ease(seg(t, BEAT.dusk, BEAT.dusk + 2.4));
  setDusk(dusk);
  const rp = seg(t, BEAT.route, BEAT.lit);
  city.setRoute(ease(rp), 1 - seg(t, BEAT.lit + 1.5, BEAT.lit + 3.5) * 0.5);
  const litK = ease(seg(t, BEAT.lit, BEAT.lit + 0.8));
  city.hero.lit = litK;
  city.setNight(dusk);
  city.hero.mat.emissiveIntensity = dusk * (0.35 + litK * 2.2);
  city.setRing(seg(t, BEAT.lit, BEAT.lit + 2.2));
  cityEl.style.opacity = seg(t, BEAT.dusk + 1.6, BEAT.dusk + 2.6);
  document.getElementById("lnum").textContent = t >= BEAT.lit + 0.3 ? "103" : "102";
  const lt = document.getElementById("ltag");
  const [hx, hy] = project(city.hero.side);
  const lk = ease(seg(t, BEAT.lit + 0.2, BEAT.lit + 0.7));
  lt.style.opacity = lk;
  lt.style.transform = `translate(${hx + 26 + (1 - lk) * 14}px, ${hy}px) translate(0, -50%) scale(${0.92 + lk * 0.08})`;
  city.lanterns.filter((l) => !l.hero).forEach((l, i) => {
    const el = document.getElementById(`ls${i}`);
    const [x, y, z] = project(l.top);
    el.style.transform = `translate(${x}px, ${y - 6}px) translate(-50%, -100%)`;
    el.style.opacity = z < 1 ? 1 : 0;
  });

  camAt(t);
  city.spark.scale.setScalar(Math.max(0.15, camera.position.distanceTo(city.spark.position) / 180));
  composer.render();
}

window.__frame = (t) => frame(t);
window.__ready = true;
if (!CAPTURE) {
  const t0 = Number(params.get("t") || 0);
  const clock = new THREE.Clock();
  const loop = params.has("loop");
  renderer.setAnimationLoop(() => {
    let t = t0 + clock.getElapsedTime();
    if (loop) t = t % 23;
    frame(t);
  });
} else {
  frame(Number(params.get("t") || 1.0));
}
