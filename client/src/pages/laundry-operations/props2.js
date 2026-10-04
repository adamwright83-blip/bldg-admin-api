import * as THREE from "three";
import { M, rbox, bagGeometry, fabric } from "./props.js";
import { FONT, rng } from "./textures.js";

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
function cv(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}
function ctex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  return t;
}

// ---------- shared textures ----------
let wireTex, leafTex;
function wireTexture() {
  if (wireTex) return wireTex;
  const [c, g] = cv(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = "#fff";
  g.lineWidth = 7;
  for (let i = 0; i <= 8; i++) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 32); g.lineTo(256, i * 32); g.stroke();
  }
  wireTex = ctex(c, false);
  wireTex.wrapS = wireTex.wrapT = THREE.RepeatWrapping;
  return wireTex;
}
function leafTexture() {
  if (leafTex) return leafTex;
  const [c, g] = cv(128, 256);
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, "#2f6e2a");
  grd.addColorStop(0.5, "#5aa040");
  grd.addColorStop(1, "#2f6e2a");
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(64, 4);
  g.bezierCurveTo(128, 70, 120, 190, 64, 252);
  g.bezierCurveTo(8, 190, 0, 70, 64, 4);
  g.fill();
  g.strokeStyle = "rgba(220,255,190,0.5)";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(64, 10); g.lineTo(64, 248); g.stroke();
  leafTex = ctex(c);
  return leafTex;
}

export function warmFloorTexture(rx, ry) {
  const [c, g] = cv(1024, 1024);
  const r = rng(5);
  const n = 4, s = 256;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const v = (r() - 0.5) * 10;
      g.fillStyle = `rgb(${178 + v},${152 + v},${120 + v})`;
      g.fillRect(i * s, j * s, s, s);
      for (let k = 0; k < 500; k++) {
        g.fillStyle = `rgba(${r() > 0.5 ? "255,240,220" : "90,70,50"},${r() * 0.06})`;
        g.fillRect(i * s + r() * s, j * s + r() * s, 2 + r() * 5, 2 + r() * 5);
      }
    }
  g.fillStyle = "rgb(112,92,70)";
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * s - 2, 0, 4, 1024);
    g.fillRect(0, i * s - 2, 1024, 4);
  }
  const t = ctex(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}
const RepeatWrapping = THREE.RepeatWrapping;

// ---------- commercial front-load machine ----------
export function makeMachine({ kind = "dryer", num = "01", run = true, lcd = "18:00", load = [0xf5f3ee, 0xf5f3ee, 0xe9e4da, 0x2a3550] }, r) {
  const g = new THREE.Group();
  const W = 1.04, H = kind === "dryer" ? 1.95 : 1.7, D = 0.98;
  g.add(mesh(rbox(W + 0.04, 0.16, D + 0.04, 0.02), M.steelDark, 0, 0.08, 0));
  const body = mesh(rbox(W, H - 0.16, D, 0.03, 3), M.steel, 0, 0.16 + (H - 0.16) / 2, 0);
  g.add(body);
  // top console
  const cy = H - 0.2;
  g.add(mesh(rbox(W - 0.06, 0.3, 0.04, 0.015), M.black, 0, cy, D / 2 + 0.005));
  const screen = mesh(new THREE.PlaneGeometry(0.26, 0.1), new THREE.MeshBasicMaterial({ map: lcdTex(lcd, run ? (kind === "dryer" ? "#ff6a3a" : "#59d0ff") : "#59636e"), toneMapped: false }), -0.22, cy + 0.02, D / 2 + 0.03);
  g.add(screen);
  [0.06, 0.14, 0.22].forEach((x, i) => g.add(mesh(new THREE.CircleGeometry(0.025, 16), new THREE.MeshBasicMaterial({ color: i === 2 ? 0xe2332b : 0x3a3f46, toneMapped: false }), x, cy + 0.02, D / 2 + 0.03)));
  g.add(mesh(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshBasicMaterial({ map: plateTex(num), toneMapped: false }), 0.38, cy + 0.02, D / 2 + 0.03));
  // door
  const dy = kind === "dryer" ? 0.95 : 0.82, R0 = kind === "dryer" ? 0.38 : 0.34;
  const front = D / 2 + 0.005;
  const door = new THREE.Group();
  door.position.set(-R0 - 0.02, dy, front); // hinge on the left
  g.add(door);
  const dg = new THREE.Group();
  dg.position.set(R0 + 0.02, 0, 0);
  door.add(dg);
  dg.add(mesh(new THREE.TorusGeometry(R0, 0.055, 20, 80), M.chrome, 0, 0, 0.03));
  dg.add(mesh(new THREE.TorusGeometry(R0 - 0.06, 0.02, 12, 80), M.black, 0, 0, 0.045));
  const glassMat = M.glass.clone();
  glassMat.opacity = 0.12;
  if (kind === "dryer" && run) {
    glassMat.color.set(0xff8a30);
    glassMat.emissive = new THREE.Color(0xff6a18);
    glassMat.emissiveIntensity = 1.1;
    glassMat.opacity = 0.42;
    glassMat.clearcoat = 0.2;
    glassMat.envMapIntensity = 0.3;
  }
  const glass = mesh(new THREE.CircleGeometry(R0 - 0.05, 64), glassMat, 0, 0, 0.05);
  dg.add(glass);
  const glows = kind === "dryer" && run;
  glass.userData.bloom = glows;
  dg.add(mesh(rbox(0.05, 0.22, 0.06, 0.02), M.black, R0 + 0.04, 0, 0.05));
  // drum (stays on body)
  const drumMat = M.drum.clone();
  if (kind === "dryer" && run) {
    drumMat.emissive = new THREE.Color(0xff7a22);
    drumMat.emissiveIntensity = 2.6;
  }
  const drum = mesh(new THREE.CylinderGeometry(R0 - 0.04, R0 - 0.04, 0.5, 48, 1, true), drumMat, 0, dy, front - 0.25);
  drum.rotation.x = Math.PI / 2;
  drum.userData.bloom = glows;
  g.add(drum);
  const backMat = M.drumBack.clone();
  if (kind === "dryer" && run) {
    backMat.emissive = new THREE.Color(0xff9a3a);
    backMat.emissiveIntensity = 4.0;
  }
  const back = mesh(new THREE.CircleGeometry(R0 - 0.04, 48), backMat, 0, dy, front - 0.49);
  back.userData.bloom = glows;
  g.add(back);
  // laundry inside
  const tumble = new THREE.Group();
  const loadMats = [];
  tumble.position.set(0, dy, front - 0.22);
  for (let i = 0; i < 9; i++) {
    let fm = fabric(load[i % load.length]);
    if (kind === "dryer" && run) {
      fm = fm.clone();
      fm.emissive = new THREE.Color(0xff7a28);
      fm.emissiveIntensity = 1.0;
      loadMats.push(fm);
    }
    const b = mesh(bagGeometry(i), fm);
    b.userData.bloom = glows;
    const s = 0.11 + r() * 0.07;
    b.scale.set(s * 1.5, s, s * 1.3);
    const a = -Math.PI / 2 + (r() - 0.5) * 2.3;
    const rad = 0.06 + r() * 0.16;
    b.position.set(Math.cos(a) * rad, Math.sin(a) * rad, (r() - 0.5) * 0.3);
    b.rotation.set(r() * 6, r() * 6, r() * 6);
    tumble.add(b);
  }
  g.add(tumble);
  let lamp = null, inner = null;
  if (kind === "dryer" && run) {
    lamp = new THREE.PointLight(0xff8a30, 2.2, 3.4, 1.6);
    lamp.position.set(0, dy, front + 0.35);
    g.add(lamp);
    inner = new THREE.PointLight(0xff9a40, 1.4, 0.9, 1.2);
    inner.position.set(0, dy + 0.1, front - 0.1);
    g.add(inner);
  }
  return { g, body, tumble, door, drumMat, backMat, glassMat, loadMats, lamp, inner, screen, kind, doorY: dy, front };
}

const lcdCache = new Map();
export function lcdTex(text, color) {
  const k = text + color;
  if (lcdCache.has(k)) return lcdCache.get(k);
  const [c, g] = cv(256, 100);
  g.fillStyle = "#07090b";
  g.fillRect(0, 0, 256, 100);
  g.fillStyle = color;
  g.font = `700 60px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 128, 54);
  const t = ctex(c);
  lcdCache.set(k, t);
  return t;
}
function plateTex(num) {
  const [c, g] = cv(192, 128);
  g.fillStyle = "#f4f2ee";
  g.fillRect(0, 0, 192, 128);
  g.fillStyle = "#1b1f26";
  g.font = `800 84px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(num, 96, 68);
  return ctex(c);
}

// ---------- wire laundry cart ----------
export function makeWireCart({ load = "white", seed = 1, heap = 1 } = {}) {
  const r = rng(seed);
  const g = new THREE.Group();
  const L = 1.05, Wd = 0.72, b0 = 0.3, H = 0.62;
  const wireMat = new THREE.MeshStandardMaterial({ color: 0xd5d9de, metalness: 0.85, roughness: 0.3, alphaMap: wireTexture(), alphaTest: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.6 });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const box = mesh(new THREE.BoxGeometry(L, H, Wd), [wireMat, wireMat, hidden, wireMat, wireMat, wireMat], 0, b0 + H / 2, 0);
  // scale the wire grid to world size
  const uv = box.geometry.attributes.uv;
  for (let f = 0; f < 6; f++) {
    const fw = f < 2 ? Wd : L, fh = f === 2 || f === 3 ? Wd : H;
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * fw * 2.2, uv.getY(k) * fh * 2.2);
    }
  }
  g.add(box);
  const tube = (len, x, y, z, rx = 0, rz = 0, rad = 0.016) => {
    const m = mesh(new THREE.CylinderGeometry(rad, rad, len, 10), M.chrome, x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
  };
  const top = b0 + H;
  [-1, 1].forEach((sz) => { tube(L, 0, top, (sz * Wd) / 2, 0, Math.PI / 2, 0.02); tube(L, 0, b0, (sz * Wd) / 2, 0, Math.PI / 2); tube(L, 0, 0.12, (sz * Wd) / 2, 0, Math.PI / 2, 0.018); });
  [-1, 1].forEach((sx) => { tube(Wd, (sx * L) / 2, top, 0, Math.PI / 2, 0, 0.02); tube(Wd, (sx * L) / 2, b0, 0, Math.PI / 2); });
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => tube(top - 0.08, (sx * L) / 2, (top + 0.08) / 2, (sz * Wd) / 2, 0, 0, 0.02)));
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
    const w = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 20), M.rubber, (sx * (L - 0.06)) / 2, 0.055, (sz * (Wd - 0.06)) / 2);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  }));
  const contents = new THREE.Group();
  g.add(contents);
  const cols = load === "navy" ? [0x1c2a52, 0x22325e, 0x18244a, 0x2a3a6a] : [0xf6f4ef, 0xf1eee7, 0xfbfaf6, 0xe8e3d8];
  const n = Math.round(9 * heap);
  for (let i = 0; i < n; i++) {
    const b = mesh(bagGeometry(i + seed), fabric(cols[i % cols.length], 0.95));
    const s = 0.22 + r() * 0.12;
    b.scale.set(s * 1.5, s * 0.7, s * 1.2);
    b.position.set((r() - 0.5) * (L - 0.35), top - 0.06 + r() * 0.12 + (i > 5 ? 0.08 : 0), (r() - 0.5) * (Wd - 0.3));
    b.rotation.set((r() - 0.5) * 0.6, r() * 6, (r() - 0.5) * 0.6);
    contents.add(b);
  }
  g.userData.contents = contents;
  g.userData.top = top;
  return g;
}

// ---------- potted plant ----------
export function makePlant(r, size = 1, pot = 0x2b2d31) {
  const g = new THREE.Group();
  const ph = 0.42 * size;
  g.add(mesh(new THREE.CylinderGeometry(0.22 * size, 0.17 * size, ph, 24), new THREE.MeshStandardMaterial({ color: pot, roughness: 0.6 }), 0, ph / 2, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.2 * size, 0.2 * size, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 }), 0, ph - 0.03, 0));
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  const n = Math.round(22 * size);
  for (let i = 0; i < n; i++) {
    const L = (0.32 + r() * 0.3) * size;
    const leaf = mesh(new THREE.PlaneGeometry(L * 0.42, L), leafMat);
    leaf.geometry.translate(0, L / 2, 0);
    const piv = new THREE.Group();
    piv.position.set((r() - 0.5) * 0.12 * size, ph + r() * 0.15 * size, (r() - 0.5) * 0.12 * size);
    piv.rotation.y = r() * Math.PI * 2;
    leaf.rotation.x = -(0.2 + r() * 0.9);
    piv.add(leaf);
    g.add(piv);
  }
  return g;
}

// ---------- safety bollard ----------
export function makeBollard() {
  const g = new THREE.Group();
  const y = new THREE.MeshStandardMaterial({ color: 0xf2b51d, roughness: 0.35 });
  g.add(mesh(new THREE.CylinderGeometry(0.085, 0.085, 1.0, 20), y, 0, 0.5, 0));
  g.add(mesh(new THREE.SphereGeometry(0.085, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), y, 0, 1.0, 0));
  [0.62, 0.8].forEach((h) => g.add(mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.06, 20), M.black, 0, h, 0)));
  return g;
}

// ---------- floor lane decal (canvas right = +x, canvas up = -z) ----------
export function laneDecal(sx, sz, draw, ppm = 160) {
  const [c, g] = cv(Math.round(sx * ppm), Math.round(sz * ppm));
  draw(g, c.width, c.height, ppm);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(sx, sz),
    new THREE.MeshStandardMaterial({ map: ctex(c), transparent: true, roughness: 0.32, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  return m;
}

const ICONS = {
  truck: (g, s) => {
    g.beginPath();
    g.roundRect(-0.5 * s, -0.25 * s, 0.6 * s, 0.4 * s, 0.05 * s);
    g.moveTo(0.12 * s, -0.12 * s); g.lineTo(0.36 * s, -0.12 * s); g.lineTo(0.5 * s, 0.02 * s); g.lineTo(0.5 * s, 0.15 * s); g.lineTo(0.12 * s, 0.15 * s); g.closePath();
    g.fill();
    g.beginPath(); g.arc(-0.3 * s, 0.2 * s, 0.09 * s, 0, 7); g.arc(0.32 * s, 0.2 * s, 0.09 * s, 0, 7); g.fill();
  },
  shirt: (g, s) => {
    g.beginPath();
    g.moveTo(-0.18 * s, -0.42 * s); g.lineTo(-0.48 * s, -0.25 * s); g.lineTo(-0.36 * s, 0.0); g.lineTo(-0.24 * s, -0.08 * s);
    g.lineTo(-0.24 * s, 0.42 * s); g.lineTo(0.24 * s, 0.42 * s); g.lineTo(0.24 * s, -0.08 * s); g.lineTo(0.36 * s, 0.0);
    g.lineTo(0.48 * s, -0.25 * s); g.lineTo(0.18 * s, -0.42 * s); g.quadraticCurveTo(0, -0.28 * s, -0.18 * s, -0.42 * s);
    g.fill();
  },
  arrow: (g, s) => {
    g.beginPath();
    g.moveTo(0, -0.5 * s); g.lineTo(0.42 * s, 0); g.lineTo(0.16 * s, 0); g.lineTo(0.16 * s, 0.5 * s); g.lineTo(-0.16 * s, 0.5 * s); g.lineTo(-0.16 * s, 0); g.lineTo(-0.42 * s, 0); g.closePath();
    g.fill();
  },
};

// draws a painted lane: fill, white edge lines, rotated text reading "up" (-z), icon + arrows
export function paintLane({ color, label, icon, textAngle = -Math.PI / 2, arrows = [], hatch = false, textSize = 0.55, iconOffset = -1.6, textOffset = 0 }) {
  return (g, W, H, ppm) => {
    g.fillStyle = color;
    g.fillRect(0, 0, W, H);
    // worn paint
    const r = rng(label.length * 7);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${r() * 0.06})`;
      g.fillRect(r() * W, r() * H, 3 + r() * 20, 2 + r() * 6);
    }
    if (hatch) {
      g.save();
      g.strokeStyle = "rgba(255,255,255,0.18)";
      g.lineWidth = 0.18 * ppm;
      for (let x = -H; x < W + H; x += 0.6 * ppm) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke(); }
      g.restore();
    }
    g.strokeStyle = "rgba(255,255,255,0.92)";
    g.lineWidth = 0.09 * ppm;
    g.strokeRect(0.12 * ppm, 0.12 * ppm, W - 0.24 * ppm, H - 0.24 * ppm);
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(textAngle);
    g.fillStyle = "rgba(255,255,255,0.95)";
    g.font = `900 ${textSize * ppm}px ${FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, textOffset * ppm, 0.05 * ppm);
    if (icon) {
      g.save();
      const tw = g.measureText(label).width;
      g.translate(iconOffset < 0 ? -tw / 2 + iconOffset * ppm * 0.5 : tw / 2 + iconOffset * ppm * 0.5, 0);
      ICONS[icon](g, 0.9 * ppm);
      g.restore();
    }
    g.restore();
    arrows.forEach(([x, y, ang, s = 0.7]) => {
      g.save();
      g.translate(x * W, y * H);
      g.rotate(ang);
      g.fillStyle = "rgba(255,255,255,0.95)";
      ICONS.arrow(g, s * ppm);
      g.restore();
    });
  };
}

// ---------- window band with outdoor glow ----------
export function outdoorTexture() {
  const [c, g] = cv(1024, 256);
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#fff4d6");
  grd.addColorStop(0.55, "#ffe2a0");
  grd.addColorStop(1, "#c9b46a");
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 256);
  const r = rng(77);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(${90 + r() * 60},${130 + r() * 60},${60 + r() * 30},${0.25 + r() * 0.35})`;
    g.beginPath();
    g.arc(r() * 1024, 140 + r() * 130, 20 + r() * 60, 0, 7);
    g.fill();
  }
  const t = ctex(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
