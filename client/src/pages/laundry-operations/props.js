import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as T from "./textures.js";

const rbCache = new Map();
export function rbox(w, h, d, r = 0.02, seg = 3) {
  const k = [w, h, d, r, seg].join(",");
  if (!rbCache.has(k)) rbCache.set(k, new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)));
  return rbCache.get(k);
}

export const M = {};
export function initMaterials() {
  const perf = T.perforatedTexture();
  Object.assign(M, {
    steel: new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 0.62, roughness: 0.3, envMapIntensity: 1.6 }),
    steelSatin: new THREE.MeshStandardMaterial({ color: 0xcfd3d8, metalness: 0.55, roughness: 0.4, envMapIntensity: 1.4 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x6d737b, metalness: 0.7, roughness: 0.4 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xf2f4f6, metalness: 0.85, roughness: 0.16, envMapIntensity: 1.8 }),
    black: new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.2, roughness: 0.38 }),
    blackMatte: new THREE.MeshStandardMaterial({ color: 0x24272c, metalness: 0.05, roughness: 0.75 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.85 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x2b3a44, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.32,
      clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, depthWrite: false,
    }),
    drum: new THREE.MeshStandardMaterial({ color: 0xffffff, map: perf, metalness: 0.75, roughness: 0.35, side: THREE.BackSide }),
    drumBack: new THREE.MeshStandardMaterial({ color: 0x6f757c, metalness: 0.7, roughness: 0.45 }),
    wood: new THREE.MeshStandardMaterial({ map: T.woodTexture(), roughness: 0.5, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xdfe2e6, roughness: 0.9 }),
    wallTrim: new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.6 }),
    slab: new THREE.MeshStandardMaterial({ color: 0xc3c8ce, roughness: 0.9 }),
    weave: T.weaveTexture(),
    wrap: new THREE.MeshPhysicalMaterial({
      color: 0xffffff, transparent: true, opacity: 0.22, roughness: 0.08, clearcoat: 1, depthWrite: false,
    }),
    poly: new THREE.MeshPhysicalMaterial({
      color: 0xe8f1fa, transparent: true, opacity: 0.45, roughness: 0.12, clearcoat: 1, depthWrite: false,
    }),
  });
}

const fabricCache = new Map();
export function fabric(color, rough = 0.88) {
  const k = color + ":" + rough;
  if (!fabricCache.has(k))
    fabricCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, map: M.weave }));
  return fabricCache.get(k);
}

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// ---------- Laundry bag: displaced sphere with gathered neck ----------
const bagGeos = [];
export function bagGeometry(seed) {
  const idx = seed % 6;
  if (bagGeos[idx]) return bagGeos[idx];
  const g = new THREE.SphereGeometry(0.5, 48, 32);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  const s = idx * 1.7 + 0.3;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      Math.sin(v.x * 7 + s) * Math.sin(v.y * 6 + s * 2) * 0.09 +
      Math.sin(v.z * 11 + v.y * 5 + s) * 0.05 +
      Math.sin((v.x - v.z) * 17 + v.y * 9 + s) * 0.025 +
      Math.sin((v.x + v.z) * 29 + s) * 0.012;
    v.multiplyScalar(1 + n);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.35; // settled bottom
    if (v.y > 0.3) {
      const t = (v.y - 0.3) / 0.25;
      const pinch = 1 - Math.min(1, t) * 0.75;
      v.x *= pinch;
      v.z *= pinch;
      v.y += t * 0.08;
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  bagGeos[idx] = g;
  return g;
}

export function makeBag(color, seed, sx = 0.5, sy = 0.42, sz = 0.42) {
  const grp = new THREE.Group();
  const b = mesh(bagGeometry(seed), fabric(color));
  b.scale.set(sx, sy, sz);
  grp.add(b);
  const knot = mesh(new THREE.TorusGeometry(0.035, 0.014, 8, 16), fabric(0xf0eadf));
  knot.position.y = sy * 0.62;
  knot.rotation.x = Math.PI / 2;
  grp.add(knot);
  return grp;
}

// ---------- Folded garment stack ----------
export function makeStack(colors, r, w = 0.36, d = 0.28) {
  const g = new THREE.Group();
  let y = 0;
  colors.forEach((c) => {
    const h = 0.04 + r() * 0.015;
    const m = mesh(rbox(w, h, d, 0.018, 2), fabric(c, 0.92), (r() - 0.5) * 0.02, y + h / 2, (r() - 0.5) * 0.02);
    m.rotation.y = (r() - 0.5) * 0.06;
    g.add(m);
    y += h;
  });
  return g;
}

// ---------- Dryer stack (two units) ----------
function dryerUnit(num, running, cy, r, laundryColors) {
  const g = new THREE.Group();
  const front = 0.53;
  // black bezel ring + chrome inner ring
  const bez = mesh(new THREE.TorusGeometry(0.31, 0.045, 20, 80), M.black, 0, cy, front + 0.01);
  g.add(bez);
  const inner = mesh(new THREE.TorusGeometry(0.272, 0.012, 12, 80), M.chrome, 0, cy, front + 0.035);
  g.add(inner);
  const glass = mesh(new THREE.CircleGeometry(0.272, 64), M.glass, 0, cy, front + 0.03);
  g.add(glass);
  // drum
  const drum = mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.42, 48, 1, true), M.drum, 0, cy, front - 0.2);
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  const back = mesh(new THREE.CircleGeometry(0.29, 48), M.drumBack, 0, cy, front - 0.4);
  g.add(back);
  // handle
  g.add(mesh(rbox(0.035, 0.2, 0.05, 0.012), M.black, 0.36, cy, front + 0.02));
  // number plate
  const plate = mesh(new THREE.PlaneGeometry(0.13, 0.08), new THREE.MeshBasicMaterial({ map: T.plateTexture(num) }), -0.33, cy + 0.33, front + 0.006);
  g.add(plate);
  // tumbling laundry
  const tumble = new THREE.Group();
  tumble.position.set(0, cy, front - 0.2);
  if (running || laundryColors) {
    const cols = laundryColors || [0xf2f0ea, 0x9fb3c8, 0xd9cdb5, 0x2f3a4f];
    for (let i = 0; i < 7; i++) {
      const b = mesh(bagGeometry(i), fabric(cols[i % cols.length]));
      const s = 0.1 + r() * 0.06;
      b.scale.set(s * 1.4, s, s * 1.2);
      const a = -Math.PI / 2 + (r() - 0.5) * 2.0;
      const rad = 0.1 + r() * 0.12;
      b.position.set(Math.cos(a) * rad, Math.sin(a) * rad, (r() - 0.5) * 0.25);
      b.rotation.set(r() * 6, r() * 6, r() * 6);
      tumble.add(b);
    }
  }
  g.add(tumble);
  // warm drum light when running
  if (running) {
    const lamp = new THREE.PointLight(0xffc98a, 0.35, 0.9, 2);
    lamp.position.set(0, cy + 0.15, front - 0.1);
    g.add(lamp);
  }
  return { g, tumble };
}

export function makeDryerStack(topNum, botNum, opts, r) {
  const g = new THREE.Group();
  const body = mesh(rbox(0.88, 1.98, 1.04, 0.025, 3), M.steel, 0, 0.99, 0);
  g.add(body);
  // seam lines / top cap
  g.add(mesh(rbox(0.9, 0.04, 1.06, 0.01), M.steelDark, 0, 1.99, 0));
  // control band between units
  g.add(mesh(rbox(0.86, 0.22, 0.03, 0.01), M.black, 0, 1.0, 0.525));
  const lcdA = mesh(new THREE.PlaneGeometry(0.15, 0.065), new THREE.MeshBasicMaterial({ map: T.lcdTexture(opts.topLcd || "--", opts.topRun ? "#ff6a50" : "#59636e"), toneMapped: false }), -0.22, 1.04, 0.542);
  const lcdB = mesh(new THREE.PlaneGeometry(0.15, 0.065), new THREE.MeshBasicMaterial({ map: T.lcdTexture(opts.botLcd || "--", opts.botRun ? "#ff6a50" : "#59636e"), toneMapped: false }), 0.22, 1.04, 0.542);
  g.add(lcdA, lcdB);
  // coin/card readers
  [-0.03, 0.06].forEach((x) => g.add(mesh(rbox(0.06, 0.1, 0.02, 0.008), M.blackMatte, x, 0.98, 0.545)));
  // red sticker
  g.add(mesh(new THREE.PlaneGeometry(0.06, 0.04), new THREE.MeshBasicMaterial({ color: 0xd8342c }), 0.36, 1.05, 0.542));
  // kick plate
  g.add(mesh(rbox(0.86, 0.1, 0.02, 0.006), M.steelDark, 0, 0.06, 0.525));
  const top = dryerUnit(topNum, opts.topRun, 1.5, r, opts.topLaundry);
  const bot = dryerUnit(botNum, opts.botRun, 0.5, r, opts.botLaundry);
  g.add(top.g, bot.g);
  // vent duct to wall
  const duct = new THREE.Group();
  const ribProfile = [];
  for (let i = 0; i <= 26; i++) ribProfile.push(new THREE.Vector2(0.1 + (i % 2 ? 0.007 : 0), i * 0.035));
  const pipe = mesh(new THREE.LatheGeometry(ribProfile, 32), M.steelSatin, 0, 2.0, -0.22);
  duct.add(pipe);
  g.add(duct);
  return { g, tumblers: [top.tumble, bot.tumble], units: { top: top.g, bot: bot.g } };
}

// ---------- Front-load washer ----------
export function makeWasher(num, running, lcd, r, suds = 0x8fb8d8) {
  const g = new THREE.Group();
  g.add(mesh(rbox(0.96, 0.24, 1.0, 0.02), new THREE.MeshStandardMaterial({ color: 0x8e949b, roughness: 0.8 }), 0, 0.12, 0));
  g.add(mesh(rbox(0.86, 1.2, 0.92, 0.03, 3), M.steel, 0, 0.84, 0));
  // control console
  const con = mesh(rbox(0.86, 0.2, 0.2, 0.02), M.black, 0, 1.5, 0.3);
  con.rotation.x = -0.35;
  g.add(con);
  const l = mesh(new THREE.PlaneGeometry(0.17, 0.07), new THREE.MeshBasicMaterial({ map: T.lcdTexture(lcd, running ? "#5ad1ff" : "#59636e"), toneMapped: false }), -0.15, 1.53, 0.41);
  l.rotation.x = -0.35;
  g.add(l);
  const cy = 0.86,
    front = 0.465;
  g.add(mesh(new THREE.TorusGeometry(0.26, 0.04, 20, 80), M.chrome, 0, cy, front + 0.01));
  g.add(mesh(new THREE.TorusGeometry(0.3, 0.012, 12, 80), M.steelDark, 0, cy, front + 0.002));
  g.add(mesh(new THREE.CircleGeometry(0.245, 64), M.glass, 0, cy, front + 0.03));
  const drum = mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.4, 48, 1, true), M.drum, 0, cy, front - 0.2);
  drum.rotation.x = Math.PI / 2;
  g.add(drum);
  g.add(mesh(new THREE.CircleGeometry(0.25, 48), M.drumBack, 0, cy, front - 0.39));
  const tumble = new THREE.Group();
  tumble.position.set(0, cy, front - 0.18);
  if (running) {
    const water = mesh(new THREE.CircleGeometry(0.24, 48, Math.PI, Math.PI), new THREE.MeshStandardMaterial({ color: suds, roughness: 0.2, transparent: true, opacity: 0.7 }), 0, 0, 0.17);
    g.add(water);
    water.position.set(0, cy - 0.02, front + 0.0);
    const cols = [0xf2f0ea, 0x6f87a6, 0xd9cdb5, 0x2f3a4f, 0xc9a7a0];
    for (let i = 0; i < 6; i++) {
      const b = mesh(bagGeometry(i + 2), fabric(cols[i % cols.length]));
      const s = 0.09 + r() * 0.05;
      b.scale.set(s * 1.4, s, s * 1.2);
      const a = -Math.PI / 2 + (r() - 0.5) * 2.2;
      const rad = 0.08 + r() * 0.1;
      b.position.set(Math.cos(a) * rad, Math.sin(a) * rad, (r() - 0.5) * 0.2);
      b.rotation.set(r() * 6, r() * 6, r() * 6);
      tumble.add(b);
    }
  }
  g.add(tumble);
  g.add(mesh(new THREE.PlaneGeometry(0.13, 0.08), new THREE.MeshBasicMaterial({ map: T.plateTexture(num) }), 0.3, 1.32, 0.462));
  return { g, tumble };
}

// ---------- Canvas laundry cart ----------
export function makeCart({ canvas = 0xdcc9a0, bags = [], bundles = 0, seed = 1, tag = null }) {
  const r = T.rng(seed);
  const g = new THREE.Group();
  const L = 1.0,
    W = 0.64,
    H = 0.6,
    base = 0.17;
  // tube frame
  const tube = (len, x, y, z, rx = 0, rz = 0) => {
    const m = mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 10), M.chrome, x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
  };
  const top = base + H + 0.02;
  [-1, 1].forEach((sx) =>
    [-1, 1].forEach((sz) => tube(top - 0.06, (sx * L) / 2, (top + 0.06) / 2, (sz * W) / 2)),
  );
  [-1, 1].forEach((sz) => {
    tube(L, 0, top, (sz * W) / 2, 0, Math.PI / 2);
    tube(L, 0, base - 0.02, (sz * W) / 2, 0, Math.PI / 2);
  });
  [-1, 1].forEach((sx) => {
    tube(W, (sx * L) / 2, top, 0, Math.PI / 2);
    tube(W, (sx * L) / 2, base - 0.02, 0, Math.PI / 2);
  });
  // canvas bin (open top), slightly inset
  const mat = new THREE.MeshStandardMaterial({ color: canvas, map: M.weave, roughness: 0.92, side: THREE.DoubleSide });
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  const bin = mesh(new THREE.BoxGeometry(L - 0.03, H, W - 0.03), [mat, mat, hidden, mat, mat, mat], 0, base + H / 2, 0);
  g.add(bin);
  // rim hem
  [-1, 1].forEach((sz) => g.add(mesh(new THREE.BoxGeometry(L - 0.02, 0.05, 0.012), fabric(new THREE.Color(canvas).multiplyScalar(0.8).getHex()), 0, top - 0.03, (sz * (W - 0.02)) / 2)));
  // corner brackets
  [-1, 1].forEach((sx) =>
    [-1, 1].forEach((sz) => {
      g.add(mesh(rbox(0.07, 0.07, 0.07, 0.01), M.black, (sx * (L - 0.04)) / 2, top - 0.03, (sz * (W - 0.04)) / 2));
      g.add(mesh(rbox(0.07, 0.07, 0.07, 0.01), M.black, (sx * (L - 0.04)) / 2, base + 0.01, (sz * (W - 0.04)) / 2));
    }),
  );
  // casters
  [-1, 1].forEach((sx) =>
    [-1, 1].forEach((sz) => {
      const w = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 20), M.rubber, (sx * (L - 0.08)) / 2, 0.055, (sz * (W - 0.08)) / 2);
      w.rotation.x = Math.PI / 2;
      g.add(w);
      g.add(mesh(rbox(0.05, 0.07, 0.06, 0.01), M.chrome, (sx * (L - 0.08)) / 2, 0.12, (sz * (W - 0.08)) / 2));
    }),
  );
  // contents
  const fillY = top - 0.14;
  bags.forEach((c, i) => {
    const n = bags.length;
    const b = makeBag(c, seed + i, 0.48 + r() * 0.12, 0.4 + r() * 0.12, 0.42 + r() * 0.1);
    const col = i % 2,
      row = Math.floor(i / 2);
    b.position.set(-0.22 + col * 0.44 + (r() - 0.5) * 0.06, fillY + row * 0.16 + (n > 2 ? 0 : -0.04), (r() - 0.5) * 0.12 + (row % 2 ? 0.05 : -0.05));
    b.rotation.set((r() - 0.5) * 0.4, r() * 6, (r() - 0.5) * 0.4);
    g.add(b);
  });
  for (let i = 0; i < bundles; i++) {
    const b = new THREE.Group();
    const core = mesh(rbox(0.42, 0.24, 0.3, 0.05), fabric(i % 2 ? 0xf1eee7 : 0xdfe6ee), 0, 0, 0);
    const wrap = mesh(rbox(0.44, 0.26, 0.32, 0.06), M.wrap);
    b.add(core, wrap);
    b.position.set(-0.24 + (i % 2) * 0.48, top - 0.08 + Math.floor(i / 2) * 0.25, 0);
    b.rotation.y = (r() - 0.5) * 0.2;
    g.add(b);
  }
  // tag on post
  if (tag) {
    const postH = 0.62;
    const post = mesh(new THREE.CylinderGeometry(0.011, 0.011, postH, 8), M.chrome, -L / 2 + 0.02, top + postH / 2, W / 2 - 0.02);
    g.add(post);
    const card = new THREE.Group();
    card.position.set(-L / 2 + 0.02, top + postH - 0.03, W / 2 - 0.02);
    const tm = new THREE.MeshStandardMaterial({ map: tag, roughness: 0.5, side: THREE.DoubleSide });
    const plane = mesh(new THREE.PlaneGeometry(0.52, 0.2), tm, 0.27, 0, 0.01);
    card.add(plane);
    card.add(mesh(rbox(0.54, 0.22, 0.012, 0.02), M.black, 0.27, 0, 0));
    g.add(card);
    g.userData.card = card;
  }
  g.userData.top = top;
  return g;
}

// ---------- Folding table ----------
export function makeTable(len, width, r, stacks = []) {
  const g = new THREE.Group();
  const h = 0.92;
  g.add(mesh(rbox(len, 0.06, width, 0.012), M.wood, 0, h - 0.03, 0));
  // black steel frame
  const leg = (x, z) => g.add(mesh(rbox(0.05, h - 0.06, 0.05, 0.006), M.black, x, (h - 0.06) / 2, z));
  [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => leg((sx * (len - 0.1)) / 2, (sz * (width - 0.1)) / 2)));
  [-1, 1].forEach((sz) => g.add(mesh(rbox(len - 0.1, 0.05, 0.04, 0.006), M.black, 0, 0.12, (sz * (width - 0.1)) / 2)));
  [-1, 1].forEach((sx) => g.add(mesh(rbox(0.04, 0.05, width - 0.1, 0.006), M.black, (sx * (len - 0.1)) / 2, 0.12, 0)));
  [-1, 1].forEach((sz) => g.add(mesh(rbox(len - 0.1, 0.05, 0.04, 0.006), M.black, 0, h - 0.09, (sz * (width - 0.1)) / 2)));
  stacks.forEach(([x, z, cols, rot = 0]) => {
    const s = makeStack(cols, r);
    s.position.set(x, h, z);
    s.rotation.y = rot;
    g.add(s);
  });
  return g;
}

// ---------- Steel shelving with wrapped bundles ----------
export function makeShelf(len, r, tagColors) {
  const g = new THREE.Group();
  const d = 0.6,
    H = 2.1;
  [-1, 1].forEach((sx) =>
    [-1, 1].forEach((sz) => g.add(mesh(rbox(0.04, H, 0.04, 0.005), M.chrome, (sx * len) / 2, H / 2, (sz * d) / 2))),
  );
  const levels = [0.18, 0.72, 1.26, 1.8];
  levels.forEach((y) => g.add(mesh(rbox(len, 0.025, d, 0.006), M.steelSatin, 0, y, 0)));
  let k = 0;
  levels.forEach((y, li) => {
    let x = -len / 2 + 0.3;
    while (x < len / 2 - 0.25) {
      const w = 0.42 + r() * 0.12,
        hh = 0.24 + r() * 0.14;
      if (r() > 0.12 || li === 1) {
        const b = new THREE.Group();
        b.add(mesh(rbox(w, hh, 0.42, 0.05), fabric([0xf1eee7, 0xe3e8ee, 0xd9cdb5, 0xf4f1ea][k % 4])));
        b.add(mesh(rbox(w + 0.02, hh + 0.02, 0.44, 0.06), M.wrap));
        const tc = tagColors[k % tagColors.length];
        b.add(mesh(new THREE.PlaneGeometry(0.12, 0.06), new THREE.MeshBasicMaterial({ color: tc }), 0, 0, 0.226));
        b.position.set(x + w / 2, y + 0.012 + hh / 2, 0.02);
        b.rotation.y = (r() - 0.5) * 0.08;
        g.add(b);
        k++;
      }
      x += w + 0.06;
    }
  });
  return g;
}

// ---------- Garment rack with bagged hanging garments ----------
export function makeGarmentRack(len, r, colors) {
  const g = new THREE.Group();
  const H = 1.75;
  [-1, 1].forEach((sx) => {
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, H, 10), M.chrome, (sx * len) / 2, H / 2, 0));
    g.add(mesh(rbox(0.06, 0.03, 0.55, 0.01), M.chrome, (sx * len) / 2, 0.08, 0));
    [-1, 1].forEach((sz) => {
      const w = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 14), M.rubber, (sx * len) / 2, 0.035, (sz * 0.25));
      w.rotation.x = Math.PI / 2;
      g.add(w);
    });
  });
  const rod = mesh(new THREE.CylinderGeometry(0.016, 0.016, len, 10), M.chrome, 0, H, 0);
  rod.rotation.z = Math.PI / 2;
  g.add(rod);
  const n = Math.floor(len / 0.11);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.1 + i * ((len - 0.2) / (n - 1));
    const gh = 0.95 + r() * 0.25;
    const item = new THREE.Group();
    const hook = mesh(new THREE.TorusGeometry(0.03, 0.005, 6, 12, Math.PI * 1.4), M.chrome, 0, H - 0.01, 0);
    hook.rotation.y = Math.PI / 2;
    item.add(hook);
    const hanger = mesh(rbox(0.012, 0.04, 0.42, 0.005), M.black, 0, H - 0.07, 0);
    item.add(hanger);
    const garment = mesh(rbox(0.05, gh - 0.06, 0.44, 0.02), fabric(colors[i % colors.length], 0.8), 0, H - 0.07 - gh / 2, 0);
    item.add(garment);
    const bag = mesh(rbox(0.075, gh, 0.5, 0.03), M.poly, 0, H - 0.05 - gh / 2, 0);
    item.add(bag);
    item.position.x = x;
    item.rotation.y = (r() - 0.5) * 0.12;
    g.add(item);
  }
  return g;
}

// ---------- Platform scale ----------
export function makeScale(readout) {
  const g = new THREE.Group();
  g.add(mesh(rbox(1.0, 0.08, 0.9, 0.02), M.steelSatin, 0, 0.04, 0));
  g.add(mesh(rbox(0.94, 0.012, 0.84, 0.004), M.blackMatte, 0, 0.085, 0));
  const post = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 10), M.steelDark, -0.44, 0.6, -0.4);
  g.add(post);
  const head = mesh(rbox(0.36, 0.2, 0.08, 0.02), M.black, -0.44, 1.2, -0.38);
  g.add(head);
  const lcd = mesh(new THREE.PlaneGeometry(0.28, 0.12), new THREE.MeshBasicMaterial({ map: T.lcdTexture(readout, "#7dffb5"), toneMapped: false }), -0.44, 1.2, -0.335);
  g.add(lcd);
  return g;
}

// ---------- Tree (exterior) ----------
export function makeTree(r, s = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.06 * s, 0.09 * s, 1.2 * s, 8), new THREE.MeshStandardMaterial({ color: 0x7a5b43, roughness: 0.9 }), 0, 0.6 * s, 0));
  const leaf = new THREE.MeshStandardMaterial({ color: 0x93b981, roughness: 0.85 });
  for (let i = 0; i < 4; i++) {
    const c = mesh(bagGeometry(i), leaf, (r() - 0.5) * 0.5 * s, (1.5 + r() * 0.6) * s, (r() - 0.5) * 0.5 * s);
    const k = (0.9 + r() * 0.5) * s;
    c.scale.set(k * 1.3, k * 1.2, k * 1.3);
    c.rotation.y = r() * 6;
    g.add(c);
  }
  return g;
}

// ---------- Delivery van (rear faces -x) ----------
export function makeVan(logoTex) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f7f8, roughness: 0.32, metalness: 0.1 });
  const dark = new THREE.MeshPhysicalMaterial({ color: 0x1b222b, roughness: 0.05, clearcoat: 1, metalness: 0.2 });
  const L = 5.6, Wd = 2.1, Hb = 2.35;
  const box = mesh(rbox(L - 1.1, Hb, Wd, 0.12, 4), white, -0.55, 0.45 + Hb / 2, 0);
  g.add(box);
  const cab = mesh(rbox(1.3, 1.55, Wd - 0.04, 0.18, 4), white, L / 2 - 0.62, 0.45 + 0.78, 0);
  g.add(cab);
  const ws = mesh(rbox(0.06, 0.7, Wd - 0.3, 0.03), dark, L / 2 + 0.02, 1.55, 0);
  ws.rotation.z = -0.35;
  g.add(ws);
  [-1, 1].forEach((sz) => g.add(mesh(rbox(0.6, 0.55, 0.03, 0.03), dark, L / 2 - 0.5, 1.5, sz * (Wd / 2 - 0.0))));
  // gold stripe + logo panels
  const stripe = new THREE.MeshStandardMaterial({ color: 0xe9a91f, roughness: 0.4 });
  [-1, 1].forEach((sz) => {
    g.add(mesh(new THREE.BoxGeometry(L - 1.2, 0.12, 0.01), stripe, -0.55, 0.85, sz * (Wd / 2 + 0.005)));
    const logo = mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.4 }), -0.6, 1.75, sz * (Wd / 2 + 0.01));
    if (sz < 0) logo.rotation.y = Math.PI;
    g.add(logo);
  });
  // wheels
  [[-1.9, 1], [-1.9, -1], [1.75, 1], [1.75, -1]].forEach(([x, sz]) => {
    const w = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 28), M.rubber, x, 0.42, sz * (Wd / 2 - 0.1));
    w.rotation.x = Math.PI / 2;
    g.add(w);
    const hub = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.31, 20), M.steelSatin, x, 0.42, sz * (Wd / 2 - 0.1));
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
  });
  // lights
  g.add(mesh(rbox(0.05, 0.16, 0.3, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false }), L / 2 + 0.1, 0.95, 0.72));
  g.add(mesh(rbox(0.05, 0.16, 0.3, 0.02), new THREE.MeshBasicMaterial({ color: 0xfff6dc, toneMapped: false }), L / 2 + 0.1, 0.95, -0.72));
  // interior (visible with doors open)
  const inner = mesh(new THREE.BoxGeometry(L - 1.3, Hb - 0.12, Wd - 0.12), new THREE.MeshStandardMaterial({ color: 0x5c636c, roughness: 0.8, side: THREE.BackSide }), -0.5, 0.45 + Hb / 2, 0);
  g.add(inner);
  // rear doors hinged at the sides, rear plane at x = -(L/2+0.55)+... 
  const rearX = -0.55 - (L - 1.1) / 2 - 0.01;
  const doors = [];
  [-1, 1].forEach((sz) => {
    const hinge = new THREE.Group();
    hinge.position.set(rearX, 0.45 + Hb / 2, sz * (Wd / 2 - 0.02));
    const leaf = mesh(rbox(0.05, Hb - 0.1, Wd / 2 - 0.03, 0.03), white, 0, 0, -sz * (Wd / 4 - 0.01));
    hinge.add(leaf);
    g.add(hinge);
    doors.push({ hinge, sz });
  });
  // hide the closed back face so the interior shows when doors open
  box.material = [white, new THREE.MeshBasicMaterial({ visible: false }), white, white, white, white];
  box.geometry = new THREE.BoxGeometry(L - 1.1, Hb, Wd);
  g.userData.setDoors = (k) => doors.forEach(({ hinge, sz }) => (hinge.rotation.y = sz * -k * 1.9));
  return g;
}
