// Screenshot-grade laundry floor. Raw three.js, no assets: every object is procedural.
// Orders (building, status, bags, lb) decide where each cart stands; movement only happens when status changes.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

export type FloorStatus = "new" | "collected" | "processing" | "ready" | "delivered";
export type FloorOrder = { id: string; building: string; status: FloorStatus; bags: number; lb: number; service?: string };

const ZONES: Record<FloorStatus, { x: number; z: number; cols: number; dx: number; dz: number }> = {
  new: { x: -13.4, z: 3.4, cols: 2, dx: 3.1, dz: 2.8 },
  collected: { x: -13.4, z: -3.0, cols: 2, dx: 3.1, dz: 2.8 },
  processing: { x: -5.2, z: -5.0, cols: 3, dx: 3.3, dz: 2.9 },
  ready: { x: 5.4, z: 5.6, cols: 3, dx: 3.3, dz: 3.0 },
  delivered: { x: 16, z: 8, cols: 1, dx: 2, dz: 2 },
};

const BUILDING_TINTS: Record<string, number> = { "THE LOUISE": 0x6fcf6f, "OPUS LA": 0xb07cff, "LOS FELIZ TOWERS": 0xff8f4a, "CENTURY PARK EAST": 0x4aa8ff };
const tintFor = (b: string) => BUILDING_TINTS[b.toUpperCase()] ?? 0xffd36a;

function label(text: string, w = 512, h = 128, fg = "#2a2a2a", bg: string | null = null, font = "800 64px 'Arial Narrow', Arial, sans-serif") {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d")!;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  const m = /(\d+)px/.exec(font); if (m) { let px = +m[1]; while (px > 12 && (g.font = font.replace(/\d+px/, px + "px"), g.measureText(text).width > w * 0.9)) px -= 2; }
  g.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function createLaundryScene(container: HTMLElement, opts: { capture?: boolean } = {}) {
  const W = () => container.clientWidth || 1920, H = () => container.clientHeight || 1080;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: !!opts.capture });
  renderer.setPixelRatio(opts.capture ? 1 : Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement); renderer.domElement.style.display = "block";
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1b1a1f); scene.fog = new THREE.Fog(0x1b1a1f, 38, 70);
  const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.5, 200);
  camera.position.set(21.0, 17.6, 26.5); camera.lookAt(1.6, 0.0, 0.6);

  // ---------- light: warm daylight through the windows + cool fill + warm practicals
  scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x4a3a2a, 0.55));
  const sun = new THREE.DirectionalLight(0xffe3b0, 1.7); sun.position.set(-14, 22, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096); const sc = sun.shadow.camera; sc.left = -24; sc.right = 24; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 80; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8fb4ff, 0.55); fill.position.set(18, 10, 14); scene.add(fill);
  for (const x of [-9, -3, 3, 9]) { const p = new THREE.PointLight(0xffd9a0, 28, 16, 1.6); p.position.set(x, 7.2, -2); scene.add(p); }

  const M = (c: number, r = 0.6, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const mat = { steel: M(0xb9bfc7, 0.32, 0.9), steelDark: M(0x6d737b, 0.4, 0.85), white: M(0xf2f1ee, 0.7), concrete: M(0x8a8b8e, 0.55), wall: M(0xc9c3b8, 0.9), brick: M(0x9b6a50, 0.9), wood: M(0xb98a5a, 0.65), black: M(0x1b1c20, 0.7), cloth: M(0xe2ded3, 0.95), denim: M(0x4a5f7c, 0.95), navy: M(0x23324f, 0.95), cart: M(0xa0a6ad, 0.35, 0.85), wheel: M(0x15161a, 0.8), skin: M(0xd9a47a, 0.8), tee: M(0x14151a, 0.9), yellow: M(0xe8c14a, 0.5), glass: new THREE.MeshPhysicalMaterial({ color: 0xbfe6ff, roughness: 0.05, transmission: 0.0, transparent: true, opacity: 0.35, metalness: 0 }) };
  const add = (m: THREE.Object3D, p: THREE.Object3D = scene) => { p.add(m); return m; };
  const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, p: THREE.Object3D = scene, cast = true) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; p.add(o); return o; };
  const cyl = (r: number, h: number, m: THREE.Material, x = 0, y = 0, z = 0, p: THREE.Object3D = scene, seg = 24) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };

  // ---------- shell
  const floorTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d")!; g.fillStyle = "#7d7e82"; g.fillRect(0, 0, 512, 512); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},${Math.random() < .5 ? 255 : 0},0.03)`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); } g.strokeStyle = "rgba(20,20,24,.35)"; g.lineWidth = 2; g.strokeRect(0, 0, 512, 512); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(28, 20); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; })();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(56, 40), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0.15 })); floor.rotation.x = -Math.PI / 2; floor.position.set(4, 0, 6); floor.receiveShadow = true; scene.add(floor);
  // safety lane markings
  for (const [x, z, w, d] of [[-6.8, 0.4, 0.14, 14], [4.6, 0.4, 0.14, 14], [-0.8, -6.3, 24, 0.14]] as number[][]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0xe8c14a })); s.rotation.x = -Math.PI / 2; s.position.set(x, 0.012, z); scene.add(s); }
  const zonePaint = (txt: string, x: number, z: number, w: number, d: number, col: string) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: label(txt, 512, 128, col, null, "800 78px 'Arial Narrow', Arial"), transparent: true, opacity: 0.85, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.02, z); scene.add(m); };
  zonePaint("IN CLEANING", -1.6, -2.7, 7, 1.5, "#f2d28a"); zonePaint("READY FOR RETURN", 8.2, 9.2, 8.6, 1.7, "#9fe6a8"); zonePaint("RECEIVED", -11.6, -6.6, 4.8, 1.1, "#cfd6e4");
  // back wall with big windows (bright, blown out = daylight)
  box(36, 9, 0.5, mat.wall, 0, 4.5, -10.6);
  box(0.5, 9, 22, mat.wall, -17.8, 4.5, 0);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0 });
  for (let i = 0; i < 7; i++) { const x = -13.5 + i * 4.5; box(3.0, 4.2, 0.1, winMat, x, 5.4, -10.3, scene, false); for (const gx of [-1, 0, 1]) box(0.08, 4.2, 0.14, mat.steelDark, x + gx, 5.4, -10.28, scene, false); box(3.1, 0.08, 0.14, mat.steelDark, x, 5.4, -10.28, scene, false); box(3.2, 0.12, 0.2, mat.steelDark, x, 3.3, -10.25, scene, false); }
  for (const px of [-12, -4, 4, 12]) for (const pz of [-6.5]) { const L = new THREE.Group(); L.position.set(px, 0, pz); scene.add(L); const cone = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.4, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x2a2c33, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide })); cone.position.y = 8.0; L.add(cone); const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0xfff0c8, toneMapped: false })); bulb.rotation.x = Math.PI / 2; bulb.position.y = 7.82; L.add(bulb); const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 3, 6), mat.black); cord.position.y = 9.5; L.add(cord); }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 1.1), new THREE.MeshBasicMaterial({ map: label("RECEIVING", 512, 90, "#ffd36a", "#1b1c20", "800 52px Arial"), toneMapped: false })); sign.position.set(-10.5, 5.4, 5.2); sign.rotation.y = Math.PI / 2; scene.add(sign);

  // ---------- washer + dryer bank (scenery that explains "in cleaning")
  const drums: THREE.Mesh[] = [], glows: THREE.Mesh[] = [];
  function machine(x: number, z: number, kind: "washer" | "dryer", n: number) {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    const big = kind === "washer" ? 1 : 1.0;
    box(2.2, 2.9, 2.1, mat.steel, 0, 1.45, 0, g); box(2.3, 0.18, 2.2, mat.steelDark, 0, 2.95, 0, g);
    box(2.0, 0.55, 0.12, M(0x23252b, .5), 0, 2.55, 1.07, g);                     // control strip
    const dispColor = kind === "washer" ? 0x4fd5ff : 0xffa94d;
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), new THREE.MeshBasicMaterial({ map: label(String(n).padStart(2, "0"), 128, 64, "#" + dispColor.toString(16), "#050608", "800 44px monospace"), toneMapped: false })); disp.position.set(-0.6, 2.55, 1.14); g.add(disp);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.1, 16, 40), mat.steelDark); ring.position.set(0, 1.35, 1.08); ring.castShadow = true; g.add(ring);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.64, 40), new THREE.MeshBasicMaterial({ color: kind === "washer" ? 0x8fe6ff : 0xffc27a, toneMapped: false })); glow.position.set(0, 1.35, 1.1); g.add(glow); glows.push(glow);
    const drum = new THREE.Mesh(new THREE.CircleGeometry(0.5, 7), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, toneMapped: false })); drum.position.set(0, 1.35, 1.115); g.add(drum); drums.push(drum);
    for (const fx of [-0.95, 0.95]) cyl(0.07, 0.12, mat.steelDark, fx, 0.06, 0.9, g, 12);
    return g;
  }
  for (let i = 0; i < 6; i++) machine(-9.4 + i * 2.5, -8.5, i < 3 ? "washer" : "dryer", i + 1);
  for (let i = 0; i < 4; i++) machine(5.9 + i * 2.5, -8.5, "dryer", 7 + i);

  // ---------- folding tables with finished stacks
  function table(x: number, z: number, len = 6.4, stacks = 6) {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    box(len, 0.14, 1.8, mat.steel, 0, 1.55, 0, g);
    for (const sx of [-len / 2 + 0.3, len / 2 - 0.3]) for (const sz of [-0.75, 0.75]) box(0.12, 1.5, 0.12, mat.steelDark, sx, 0.75, sz, g);
    box(len - 0.5, 0.08, 1.4, mat.steelDark, 0, 0.55, 0, g);
    for (let i = 0; i < stacks; i++) { const sx = -len / 2 + 0.7 + i * ((len - 1.4) / Math.max(stacks - 1, 1)); const h = 3 + (i * 7) % 5; for (let k = 0; k < h; k++) { const col = k % 4 === 0 ? 0xdfe6f2 : k % 3 === 0 ? 0xf1ece0 : 0xffffff; box(0.9, 0.09, 0.7, M(col, 0.95), sx + (k % 2) * 0.02, 1.67 + k * 0.095, -0.2 + (i % 2) * 0.35, g); } }
    return g;
  }
  table(-3.4, 0.9); table(-3.4, 4.2, 6.4, 5);

  // ---------- shelving + garment racks (READY zone)
  function shelf(x: number, z: number, rotY = 0) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
    for (const sx of [-1.6, 1.6]) for (const sz of [-0.5, 0.5]) box(0.08, 3.4, 0.08, mat.steelDark, sx, 1.7, sz, g);
    for (let k = 0; k < 4; k++) { box(3.3, 0.06, 1.2, mat.steel, 0, 0.45 + k * 0.9, 0, g); for (let j = 0; j < 5; j++) { const col = [0xf4f1ea, 0x9fb1c9, 0xe9dfcf, 0x4a5f7c, 0xffffff][(j + k) % 5]; box(0.55, 0.28 + (j % 2) * 0.1, 0.8, M(col, 0.95), -1.2 + j * 0.6, 0.64 + k * 0.9, 0, g); } }
    return g;
  }
  shelf(14.6, -3.2, -Math.PI / 2); shelf(14.6, 1.6, -Math.PI / 2); shelf(-15.2, -7.6, Math.PI / 2); shelf(-15.2, -3.6, Math.PI / 2);
  // hanging rails with plastic-wrapped orders at READY
  for (let r = 0; r < 2; r++) { const rz = -1.8 + r * 5.2; box(0.08, 3.6, 0.08, mat.steelDark, 6.6, 1.8, rz); box(0.08, 3.6, 0.08, mat.steelDark, 11.0, 1.8, rz); box(4.5, 0.08, 0.08, mat.steel, 8.8, 3.5, rz); for (let k = 0; k < 14; k++) { const col = [0xf4f1ea, 0xc7d6ee, 0x2e3a52, 0xe9dfcf, 0x7a8ca6][k % 5]; box(0.28, 1.5 + (k % 3) * 0.15, 0.4, M(col, 0.9), 6.9 + k * 0.3, 2.65, rz); } }

  // ---------- carts
  type Cart = { id: string; g: THREE.Group; tgt: THREE.Vector3; order: FloorOrder; ring: THREE.Group; tag: THREE.Mesh; wobble: number };
  const carts = new Map<string, Cart>();
  const lumps = (g: THREE.Group, bags: number, tint: number) => {
    const n = Math.min(4, Math.max(2, bags + 1));
    for (let i = 0; i < n; i++) {
      const col = [0xf3efe6, 0xe7e2d6, 0xdfe6f1, 0xf7f4ec][i % 4];
      const sack = new THREE.Group(); sack.position.set(-0.75 + (i % 2) * 0.95 + (i > 1 ? 0.3 : 0), 1.25 + (i > 1 ? 0.55 : 0.1), -0.25 + (i % 2) * 0.35 - (i > 1 ? 0.1 : 0)); sack.rotation.y = i * 0.9; g.add(sack);
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), M(col, 0.92)); body.scale.set(1, 1.05, 0.95); body.castShadow = true; sack.add(body);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 0.38, 12), M(col, 0.92)); neck.position.y = 0.68; sack.add(neck);
      const rib = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 18), M(tint, 0.45)); rib.rotation.x = Math.PI / 2; rib.position.y = 0.58; sack.add(rib);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.34, 10), M(col, 0.92)); top.position.set(0.05, 0.98, 0); top.rotation.z = 0.35; sack.add(top);
    }
    for (let i = 0; i < 4; i++) { const sh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), M([0x4a5f7c, 0xa9bad4, 0xf0e6cf, 0x23324f][i], 0.95)); sh.position.set(-0.9 + i * 0.6, 1.76 + (i % 2) * 0.03, 0.45 - (i % 3) * 0.3); sh.rotation.set(0.15, i * 0.7, 0.1); g.add(sh); }
  };
  function makeCart(o: FloorOrder): Cart {
    const g = new THREE.Group(); const tint = tintFor(o.building);
    box(2.5, 0.12, 1.7, mat.cart, 0, 0.55, 0, g);
    for (const sx of [-1.2, 1.2]) for (const sz of [-0.8, 0.8]) { box(0.06, 1.35, 0.06, mat.cart, sx, 1.2, sz, g); const w = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 16), mat.wheel); w.rotation.x = Math.PI / 2; w.position.set(sx, 0.22, sz); w.castShadow = true; g.add(w); }
    // wire basket walls
    const wall = new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.3, metalness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    for (const [w, d, x, z] of [[2.5, 0.04, 0, 0.82], [2.5, 0.04, 0, -0.82], [0.04, 1.7, 1.24, 0], [0.04, 1.7, -1.24, 0]] as number[][]) box(w, 1.2, d, wall, x, 1.2, z, g, false);
    box(2.5, 0.05, 0.05, mat.cart, 0, 1.82, 0.82, g); box(2.5, 0.05, 0.05, mat.cart, 0, 1.82, -0.82, g);
    box(0.05, 0.05, 1.7, mat.cart, 1.24, 1.82, 0, g); box(0.05, 0.05, 1.7, mat.cart, -1.24, 1.82, 0, g);
    box(2.3, 0.6, 1.5, M(0xd8d3c8, 0.95), 0, 0.95, 0, g);
    lumps(g, o.bags, tint);
    const canvas = label(o.building.toUpperCase(), 640, 220, "#1c1c1e", "#f7f5ef", "900 92px 'Arial Narrow', Arial");
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 0.8), new THREE.MeshBasicMaterial({ map: canvas, toneMapped: false })); tag.position.set(0, 0.98, 0.86); g.add(tag);
    const tag2 = tag.clone(); tag2.position.set(1.28, 1.0, 0); tag2.rotation.y = Math.PI / 2; g.add(tag2);
    const sw = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.05), new THREE.MeshBasicMaterial({ color: tint, toneMapped: false })); sw.position.set(-0.55, 1.45, 0.86); g.add(sw);
    const ring = new THREE.Group(); ring.visible = false; ring.position.y = 0.55; g.add(ring);
    const gold = new THREE.MeshBasicMaterial({ color: 0x59b6ff, toneMapped: false });
    for (const [bw, bh, bd, bx, by, bz] of [[3.0, 0.07, 0.07, 0, 0, 1.12], [3.0, 0.07, 0.07, 0, 0, -1.12], [3.0, 0.07, 0.07, 0, 1.85, 1.12], [3.0, 0.07, 0.07, 0, 1.85, -1.12], [0.07, 0.07, 2.3, 1.5, 0, 0], [0.07, 0.07, 2.3, -1.5, 0, 0], [0.07, 0.07, 2.3, 1.5, 1.85, 0], [0.07, 0.07, 2.3, -1.5, 1.85, 0], [0.07, 1.85, 0.07, 1.5, 0.92, 1.12], [0.07, 1.85, 0.07, -1.5, 0.92, 1.12], [0.07, 1.85, 0.07, 1.5, 0.92, -1.12], [0.07, 1.85, 0.07, -1.5, 0.92, -1.12]] as number[][]) { const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), gold); m.position.set(bx, by, bz); ring.add(m); }
    const glowDisc = new THREE.Mesh(new THREE.CircleGeometry(2.4, 40), new THREE.MeshBasicMaterial({ color: 0x59b6ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); glowDisc.rotation.x = -Math.PI / 2; glowDisc.position.y = -0.52; ring.add(glowDisc);
    g.traverse(n => { if ((n as THREE.Mesh).isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    scene.add(g); return { id: o.id, g, tgt: new THREE.Vector3(), order: o, ring, tag, wobble: Math.random() * 6 };
  }

  // ---------- workers (stylised, black tee, cap)
  type Worker = { g: THREE.Group; path: THREE.Vector3[]; i: number; speed: number; carry: boolean };
  const workers: Worker[] = [];
  function worker(path: number[][], speed = 1.1, carry = false) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.75, 6, 12), mat.tee); body.position.y = 1.25; body.castShadow = true; g.add(body);
    for (const lx of [-0.14, 0.14]) { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.7, 4, 8), M(0x2a2c33, .9)); l.position.set(lx, 0.45, 0); l.castShadow = true; g.add(l); }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mat.skin); head.position.y = 2.02; head.castShadow = true; g.add(head);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.tee); cap.position.y = 2.06; g.add(cap);
    for (const ax of [-0.42, 0.42]) { const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.6, 4, 8), mat.skin); a.position.set(ax, 1.3, carry ? 0.25 : 0); a.rotation.x = carry ? -1.1 : 0; a.castShadow = true; g.add(a); }
    const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.12), new THREE.MeshBasicMaterial({ map: label("SUNSET", 128, 48, "#ffd36a", null, "800 34px Arial"), transparent: true })); chest.position.set(0, 1.42, 0.33); g.add(chest);
    const pts = path.map(p => new THREE.Vector3(p[0], 0, p[1])); g.position.copy(pts[0]); scene.add(g); workers.push({ g, path: pts, i: 1, speed, carry });
  }
  worker([[-1.8, 2.7], [-1.0, 2.7], [-1.0, 2.7]], 0, false);
  worker([[-5, -0.6], [-5, 5.6]], 0.9, false);
  worker([[3.4, -5.0], [3.4, 0.8], [-0.6, 0.8], [3.4, -5.0]], 0.8, true);
  worker([[7.4, 3.6], [11.6, 3.6], [11.6, -0.2], [7.4, -0.2]], 0.7, false);
  worker([[-7.5, -5.2], [-12.5, -5.2]], 0.8, false);
  // folders at the tables
  worker([[-4.2, 1.0]], 0, false); worker([[0.6, 4.3]], 0, false);

  // ---------- fx
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.9, 7, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); beam.visible = false; scene.add(beam);
  const dust: THREE.Points = (() => { const n = 260, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() - 0.5) * 30; a[i * 3 + 1] = Math.random() * 8; a[i * 3 + 2] = (Math.random() - 0.5) * 18; } const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(a, 3)); const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff1d0, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false })); scene.add(p); return p; })();

  // ---------- post
  const composer = new EffectComposer(renderer); composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W(), H()), 0.38, 0.55, 1.7); composer.addPass(bloom);
  const grade = new ShaderPass({ uniforms: { tDiffuse: { value: null }, vig: { value: 0.32 }, tilt: { value: 0.0 } }, vertexShader: "varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}", fragmentShader: "uniform sampler2D tDiffuse;uniform float vig;varying vec2 v;void main(){vec4 c=texture2D(tDiffuse,v);float d=distance(v,vec2(.5,.52));c.rgb*=1.-vig*smoothstep(.35,.95,d);c.rgb=mix(vec3(dot(c.rgb,vec3(.299,.587,.114))),c.rgb,1.12);c.rgb=pow(c.rgb,vec3(.96));gl_FragColor=c;}" });
  composer.addPass(grade); composer.addPass(new OutputPass());
  const resize = () => { const w = W(), h = H(); renderer.setSize(w, h); composer.setSize(w, h); bloom.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  resize(); window.addEventListener("resize", resize);

  // ---------- data -> carts
  let selectedId: string | null = null; let t = 0;
  function slot(o: FloorOrder, idx: number) { const z = ZONES[o.status]; return new THREE.Vector3(z.x + (idx % z.cols) * z.dx, 0, z.z + Math.floor(idx / z.cols) * z.dz); }
  function setOrders(orders: FloorOrder[]) {
    const counts: Record<string, number> = {};
    const seen = new Set<string>();
    for (const o of orders) {
      seen.add(o.id); const idx = counts[o.status] = (counts[o.status] ?? -1) + 1;
      let c = carts.get(o.id);
      if (!c) { c = makeCart(o); carts.set(o.id, c); c.g.position.copy(slot(o, idx)); }
      c.order = o; c.tgt.copy(slot(o, idx));
      c.g.visible = o.status !== "delivered";
    }
    for (const [id, c] of carts) if (!seen.has(id)) { scene.remove(c.g); carts.delete(id); }
    select(selectedId);
  }
  function select(id: string | null) {
    selectedId = id; for (const c of carts.values()) { c.ring.visible = c.id === id; }
    const c = id ? carts.get(id) : null; beam.visible = !!c;
  }
  function pick(ev: PointerEvent) { const r = renderer.domElement.getBoundingClientRect(); const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -(((ev.clientY - r.top) / r.height) * 2 - 1)); const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera); const meshes: THREE.Object3D[] = []; carts.forEach(c => c.g.traverse(n => { if ((n as THREE.Mesh).isMesh) { n.userData.cartId = c.id; meshes.push(n); } })); const hit = rc.intersectObjects(meshes, false)[0]; if (hit) { select(hit.object.userData.cartId); onSelect?.(hit.object.userData.cartId); } }
  let onSelect: ((id: string) => void) | null = null;
  renderer.domElement.addEventListener("pointerdown", pick);

  function projectCart(id: string) { const c = carts.get(id); if (!c) return null; const v = c.g.position.clone(); v.y = 2.6; v.project(camera); return { x: (v.x * 0.5 + 0.5) * W(), y: (-v.y * 0.5 + 0.5) * H() }; }

  function step(dt: number) {
    t += dt;
    for (const c of carts.values()) {
      const d = c.tgt.clone().sub(c.g.position); const L = d.length();
      if (L > 0.02) { const v = Math.min(L, dt * 5.2); c.g.position.addScaledVector(d.normalize(), v); c.g.rotation.y += ((Math.atan2(d.x, d.z) - c.g.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 4) * 0; }
      c.g.position.y = L > 0.1 ? Math.sin(t * 24 + c.wobble) * 0.012 : 0;
      if (c.ring.visible) { const k = 1 + Math.sin(t * 4) * 0.015; c.ring.scale.set(k, 1, k); }
    }
    drums.forEach((d, i) => { d.rotation.z = t * (i < 3 ? 6 : 3) * (i % 2 ? 1 : -1); });
    glows.forEach((g, i) => { (g.material as THREE.MeshBasicMaterial).color.multiplyScalar(1); g.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.015); });
    for (const w of workers) {
      if (w.path.length < 2 || w.speed === 0) { w.g.rotation.y = Math.PI * 0.15; w.g.position.y = Math.abs(Math.sin(t * 1.4 + w.g.position.x)) * 0.03; continue; }
      const tgt = w.path[w.i]; const d = tgt.clone().sub(w.g.position); const L = d.length();
      if (L < 0.08) w.i = (w.i + 1) % w.path.length; else { w.g.position.addScaledVector(d.normalize(), Math.min(L, dt * w.speed)); w.g.rotation.y = Math.atan2(d.x, d.z); w.g.position.y = Math.abs(Math.sin(t * 7)) * 0.05; }
    }
    const sel = selectedId ? carts.get(selectedId) : null;
    if (sel) { beam.position.set(sel.g.position.x, 4.7, sel.g.position.z); (beam.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(t * 3) * 0.03; beam.visible = true; }
    dust.rotation.y = t * 0.01; dust.position.y = Math.sin(t * 0.3) * 0.1;
  }
  function renderFrame(dt = 0) { step(dt); composer.render(); }
  let raf = 0; let last = performance.now();
  if (!opts.capture) { const loop = (n: number) => { const dt = Math.min(0.05, (n - last) / 1000); last = n; renderFrame(dt); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); }

  return {
    setOrders, select, renderFrame, projectCart, resize, camera, scene, renderer,
    onSelect: (fn: (id: string) => void) => { onSelect = fn; },
    dispose() { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); renderer.domElement.removeEventListener("pointerdown", pick); composer.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
export type LaundryScene = ReturnType<typeof createLaundryScene>;
