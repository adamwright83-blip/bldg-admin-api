/**
 * CHANNEL 382: a miniature television studio in clay and cardboard, shot like stop-motion.
 *
 * The tabletop set in the middle is a diorama of a Laundry Farm ad (a clay van, laundry bags, folded towels, a little
 * washer, cardboard palms against a painted LA sky). Around it: Bertrand Fairweather III in his director's chair, his
 * staff of three, three practical lights, a cardboard camera, the ON AIR sign, and SUDSCO ONE glowing across the
 * street. The player's camera (the "lens") frames the set; capture() renders that frame at 1080×1350 with nothing
 * from the studio in it, and that picture becomes the ad.
 *
 * Puppets and props animate on twos (12 steps a second) with a little "boil" on each step, like hand-moved clay. The
 * camera moves smoothly, like a real operator. Nothing here knows about customers or the business beyond the brand.
 */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { BRAND, RIVAL_TICKER, type HookId, type LightId, type PropId } from "./channel382Copy";

export type View = "studio" | "lens";
export type Mood = "idle" | "talk" | "angry" | "cry" | "joy";
export type Lens = { az: number; height: number; dist: number };
export type FrameInfo = { van: boolean; subjects: number };

export type Channel382Handle = {
  setView(v: View): void;
  setLight(l: LightId): void;
  setProp(p: PropId, on: boolean): void;
  setLens(l: Lens): void;
  setHook(h: HookId): void;
  setChannel(label: string): void;
  bertrand(mood: Mood): void;
  action(h: HookId): Promise<void>;
  /** the framed shot at 1080×1350, studio hidden */
  capture(): HTMLCanvasElement;
  setOnAir(on: boolean): void;
  celebrate(): void;
  setPaused(p: boolean): void;
  dispose(): void;
};

const STEP = 1 / 12; // animate on twos
export const DEFAULT_LENS: Lens = { az: 0.04, height: 2.5, dist: 10.8 };

// ------------------------------------------------------------------ textures
function noiseCanvas(size: number, seed: number, scale: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const img = g.createImageData(size, size);
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (r() - 0.5) * scale;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // thumbprints: soft concentric smudges, the giveaway of hand-pressed clay
  for (let k = 0; k < 18; k++) {
    const x = r() * size, y = r() * size, rad = 6 + r() * 16;
    for (let j = 0; j < 4; j++) {
      g.strokeStyle = `rgba(${110 + r() * 40},${110 + r() * 40},255,0.25)`;
      g.lineWidth = 1.2;
      g.beginPath();
      const rr = Math.max(1, rad - j * 3);
      g.ellipse(x, y, rr, rr * 0.7, r() * 3, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function cardboardTexture(base = "#c9a77a"): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 6) {
    g.fillStyle = `rgba(90,60,30,${0.05 + (x % 12 ? 0 : 0.05)})`;
    g.fillRect(x, 0, 3, 256);
  }
  let s = 3;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(80,50,20,${r() * 0.08})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** the painted LA sky on the backdrop: warm, hand-brushed, with a low sun and a few cardboard hills */
function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 512;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, "#f6d9b6");
  sky.addColorStop(0.55, "#f9e6cf");
  sky.addColorStop(1, "#faf1e3");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 512);
  // brush strokes
  let s = 11;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = `rgba(255,255,255,${r() * 0.12})`;
    g.lineWidth = 6 + r() * 14;
    const y = r() * 380;
    g.beginPath();
    g.moveTo(r() * 1024, y);
    g.lineTo(r() * 1024, y + (r() - 0.5) * 20);
    g.stroke();
  }
  // hills
  g.fillStyle = "#e8c79c";
  g.beginPath();
  g.moveTo(0, 420);
  for (let x = 0; x <= 1024; x += 64) g.lineTo(x, 380 + Math.sin(x * 0.012) * 26 + Math.sin(x * 0.031) * 12);
  g.lineTo(1024, 512);
  g.lineTo(0, 512);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textTexture(text: string, opts: { w?: number; h?: number; bg: string; fg: string; font: string }): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = opts.w ?? 512;
  c.height = opts.h ?? 128;
  const g = c.getContext("2d")!;
  g.fillStyle = opts.bg;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = opts.fg;
  g.font = opts.font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createChannel382(container: HTMLElement, cb: { onFrame?: (f: FrameInfo) => void } = {}): Channel382Handle {
  const disposers: (() => void)[] = [];
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("data-testid", "channel-382-canvas");
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);
  const softwareGl = (() => {
    try {
      const gl = renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return /swiftshader|llvmpipe|software/i.test(String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
    } catch {
      return false;
    }
  })();
  if (softwareGl) renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#3a2e28");
  scene.fog = new THREE.Fog("#3a2e28", 24, 50);
  const studioCam = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  const lensCam = new THREE.PerspectiveCamera(34, 0.8, 0.1, 100);

  const fingerprint = noiseCanvas(256, 7, 26);
  const clay = (color: string, rough = 0.88) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, normalMap: fingerprint, normalScale: new THREE.Vector2(0.35, 0.35) });
  const card = (base = "#c9a77a") => new THREE.MeshStandardMaterial({ map: cardboardTexture(base), roughness: 0.95 });
  const add = <T extends THREE.Object3D>(parent: THREE.Object3D, o: T, x?: number, y?: number, z?: number) => {
    // a position given here wins; otherwise the object keeps the one it was given before
    if (x !== undefined) o.position.set(x, y ?? 0, z ?? 0);
    o.traverse(c => {
      const m = c as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    parent.add(o);
    return o;
  };
  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => new THREE.Mesh(geo, mat);
  const rbox = (w: number, h: number, d: number, r = 0.08) => new RoundedBoxGeometry(w, h, d, 4, r);

  // studio-only things are hidden in the captured ad
  const studioOnly: THREE.Object3D[] = [];

  // ---------------------------------------------------------------- the studio room
  const room = new THREE.Group();
  scene.add(room);
  const floorMat = new THREE.MeshStandardMaterial({ color: "#5a4a40", roughness: 0.9 });
  add(room, mesh(new THREE.PlaneGeometry(60, 60), floorMat)).rotation.x = -Math.PI / 2;
  const wallMat = new THREE.MeshStandardMaterial({ color: "#6e5446", roughness: 1 });
  // back wall with a window onto the street
  const backZ = -9;
  add(room, mesh(new THREE.BoxGeometry(14, 9, 0.3), wallMat), -11, 4.5, backZ);
  add(room, mesh(new THREE.BoxGeometry(14, 9, 0.3), wallMat), 11, 4.5, backZ);
  add(room, mesh(new THREE.BoxGeometry(8, 2.6, 0.3), wallMat), 0, 1.3, backZ);
  add(room, mesh(new THREE.BoxGeometry(8, 2.2, 0.3), wallMat), 0, 7.9, backZ);
  // window frame
  const frameMat = clay("#2a211d");
  add(room, mesh(new THREE.BoxGeometry(8.2, 0.18, 0.4), frameMat), 0, 2.65, backZ + 0.05);
  add(room, mesh(new THREE.BoxGeometry(8.2, 0.18, 0.4), frameMat), 0, 6.75, backZ + 0.05);
  add(room, mesh(new THREE.BoxGeometry(0.18, 4.2, 0.4), frameMat), 0, 4.7, backZ + 0.05);
  // side walls
  add(room, mesh(new THREE.BoxGeometry(0.3, 9, 30), wallMat), -16, 4.5, 4);
  add(room, mesh(new THREE.BoxGeometry(0.3, 9, 30), wallMat), 16, 4.5, 4);

  // the street outside: dusk, and SUDSCO ONE glowing smugly
  const street = new THREE.Group();
  room.add(street);
  const duskMat = new THREE.MeshBasicMaterial({ color: "#3d3a5c" });
  add(street, mesh(new THREE.PlaneGeometry(40, 20), duskMat), 0, 8, -26);
  const sudsco = new THREE.Group();
  add(sudsco, mesh(rbox(9, 9, 3, 0.2), clay("#d9d5cc", 0.7)), 0, 4.5, 0);
  const sudscoSign = mesh(new THREE.PlaneGeometry(7, 1.2), new THREE.MeshBasicMaterial({ map: textTexture("SUDSCO ONE", { bg: "#1f3d8a", fg: "#ffffff", font: "700 64px 'Barlow Condensed', Arial, sans-serif" }) }));
  sudscoSign.position.set(0, 8.2, 1.55);
  sudsco.add(sudscoSign);
  const tickerCanvas = document.createElement("canvas");
  tickerCanvas.width = 512;
  tickerCanvas.height = 256;
  const tickerTex = new THREE.CanvasTexture(tickerCanvas);
  tickerTex.colorSpace = THREE.SRGBColorSpace;
  const sudscoScreen = mesh(new THREE.PlaneGeometry(6.4, 3.2), new THREE.MeshBasicMaterial({ map: tickerTex }));
  sudscoScreen.position.set(0, 4.6, 1.55);
  sudsco.add(sudscoScreen);
  sudsco.position.set(2.5, 0, -19);
  street.add(sudsco);
  for (const [x, h] of [[-9, 7], [-5, 11], [11, 9], [15, 13]] as const) add(street, mesh(rbox(3.5, h, 3, 0.15), clay("#575270", 0.9)), x, h / 2, -21);
  let tickerIdx = 0;
  function paintTicker(i: number) {
    const g = tickerCanvas.getContext("2d")!;
    g.fillStyle = "#e8eef8";
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = "#1f3d8a";
    g.font = "700 46px 'Barlow Condensed', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(RIVAL_TICKER[i % RIVAL_TICKER.length], 256, 128);
    g.fillStyle = "#9aa6c0";
    g.fillRect(40, 200, 432, 10);
    tickerTex.needsUpdate = true;
  }
  paintTicker(0);

  // ON AIR sign above the set
  const onAirOff = textTexture("ON AIR", { w: 512, h: 160, bg: "#3a1414", fg: "#6a2a2a", font: "800 110px 'Barlow Condensed', Arial, sans-serif" });
  const onAirOn = textTexture("ON AIR", { w: 512, h: 160, bg: "#ff2a2a", fg: "#fff4e8", font: "800 110px 'Barlow Condensed', Arial, sans-serif" });
  const onAirMat = new THREE.MeshBasicMaterial({ map: onAirOff });
  const onAir = new THREE.Group();
  add(onAir, mesh(rbox(3.4, 1.2, 0.3, 0.12), clay("#1d1716")), 0, 0, 0);
  const onAirFace = mesh(new THREE.PlaneGeometry(3.1, 0.97), onAirMat);
  onAirFace.position.z = 0.16;
  onAir.add(onAirFace);
  onAir.position.set(-6.5, 7.2, backZ + 0.3);
  room.add(onAir);
  const onAirLight = new THREE.PointLight("#ff3a2a", 0, 8, 2);
  onAirLight.position.set(-6.5, 7, backZ + 1.4);
  room.add(onAirLight);

  // CHANNEL sign: the station's name, with the player's real follower count in it
  const channelCanvas = document.createElement("canvas");
  channelCanvas.width = 1024;
  channelCanvas.height = 256;
  const channelTex = new THREE.CanvasTexture(channelCanvas);
  channelTex.colorSpace = THREE.SRGBColorSpace;
  function paintChannel(label: string) {
    const g = channelCanvas.getContext("2d")!;
    g.fillStyle = "#e9d9b8";
    g.fillRect(0, 0, 1024, 256);
    g.fillStyle = "#2a211d";
    g.font = "800 130px 'Barlow Condensed', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(`CHANNEL ${label}`, 512, 110);
    g.font = "600 40px 'Barlow Condensed', Arial, sans-serif";
    g.fillText("BROADCASTING TO PRACTICALLY NOBODY SINCE THIS MORNING", 512, 205);
    channelTex.needsUpdate = true;
  }
  paintChannel("382");
  const channelSign = mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshStandardMaterial({ map: channelTex, roughness: 0.9 }));
  channelSign.position.set(8.5, 7.4, backZ + 0.2);
  channelSign.rotation.z = -0.03;
  room.add(channelSign);

  // ---------------------------------------------------------------- the set (the ad)
  const set = new THREE.Group();
  scene.add(set);
  // table and its skirt
  add(set, mesh(rbox(8.4, 0.9, 5.4, 0.1), card("#a98457")), 0, -0.45, 0);
  // sidewalk the props stand on
  const walkMat = clay("#efe2cc", 0.92);
  add(set, mesh(rbox(7.6, 0.12, 4.4, 0.05), walkMat), 0, 0.06, 0.1);
  const curbMat = clay("#d8c7a9");
  add(set, mesh(rbox(7.6, 0.16, 0.3, 0.05), curbMat), 0, 0.1, 2.2);
  // the backdrop: a curved sweep of painted sky on cardboard, hinged at the bottom so it can fall
  const backdropHinge = new THREE.Group();
  backdropHinge.position.set(0, 0.1, -1.95);
  set.add(backdropHinge);
  const sweep = mesh(new THREE.CylinderGeometry(6, 6, 3.6, 40, 1, true, -0.62, 1.24), new THREE.MeshStandardMaterial({ map: skyTexture(), roughness: 0.95, side: THREE.DoubleSide }));
  sweep.rotation.y = Math.PI;
  sweep.position.set(0, 1.8, 5.6);
  sweep.castShadow = false;
  sweep.receiveShadow = true;
  backdropHinge.add(sweep);
  // the low cardboard sun, which rises for "relief"
  const sun = mesh(new THREE.CircleGeometry(0.55, 32), new THREE.MeshStandardMaterial({ color: "#f2b25c", emissive: "#f2a64a", emissiveIntensity: 0.25, roughness: 0.9 }));
  sun.position.set(1.6, 1.2, 0.22);
  backdropHinge.add(sun);

  // cardboard palms
  const palms = new THREE.Group();
  set.add(palms);
  function palm(x: number, h: number, lean: number) {
    const p = new THREE.Group();
    const trunk = mesh(new THREE.BoxGeometry(0.16, h, 0.04), card("#9b7448"));
    trunk.position.y = h / 2;
    p.add(trunk);
    // fronds: long cardboard leaves fanning up and drooping out, like a kid's cut-out palm
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (0.08 + (i / 6) * 0.84);
      const frond = new THREE.Group();
      const leaf = mesh(new THREE.BoxGeometry(0.95, 0.2, 0.03), card(i % 2 ? "#86a35f" : "#6f8e4e"));
      leaf.position.x = 0.48;
      frond.add(leaf);
      frond.position.set(0, h, 0.02);
      // spread wider than a semicircle so the outer fronds droop below the crown
      frond.rotation.z = Math.PI / 2 + (a - Math.PI / 2) * 1.3;
      p.add(frond);
    }
    p.position.set(x, 0.12, -1.55);
    p.rotation.z = lean;
    add(palms, p);
  }
  palm(-3.35, 2.3, 0.07);
  palm(3.4, 1.95, -0.08);

  // the van: hand-moulded clay, Laundry Farm green, its name on the side
  const van = new THREE.Group();
  const vanGreen = clay(BRAND.forest, 0.8);
  add(van, mesh(rbox(2.2, 1.05, 1.1, 0.22), vanGreen), 0, 0.72, 0);
  add(van, mesh(rbox(0.95, 0.75, 1.05, 0.2), vanGreen), 1.35, 0.55, 0);
  const glass = new THREE.MeshStandardMaterial({ color: "#bcd6d8", roughness: 0.25, metalness: 0.1 });
  add(van, mesh(rbox(0.5, 0.36, 0.9, 0.08), glass), 1.6, 0.78, 0);
  const sideText = textTexture(BRAND.name, { w: 512, h: 128, bg: BRAND.forest, fg: BRAND.cream, font: "700 64px 'DM Sans', Arial, sans-serif" });
  for (const side of [-1, 1]) {
    const plate = mesh(new THREE.PlaneGeometry(1.7, 0.42), new THREE.MeshStandardMaterial({ map: sideText, roughness: 0.85 }));
    plate.position.set(-0.05, 0.78, side * 0.565);
    if (side < 0) plate.rotation.y = Math.PI;
    van.add(plate);
    const stripe = mesh(new THREE.BoxGeometry(2.25, 0.07, 0.02), clay(BRAND.gold, 0.6));
    stripe.position.set(0.2, 0.44, side * 0.56);
    van.add(stripe);
  }
  for (const [x, z] of [[-0.65, 0.5], [0.95, 0.5], [-0.65, -0.5], [0.95, -0.5]] as const) {
    const wheel = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.18, 18), clay("#2a2523"));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.24, z);
    van.add(wheel);
    const hub = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2, 12), clay(BRAND.cream));
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.24, z);
    van.add(hub);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: "#fff3cf", emissive: "#ffd98a", emissiveIntensity: 0.6 });
  add(van, mesh(new THREE.SphereGeometry(0.08, 10, 8), lampMat), 1.83, 0.5, 0.35);
  add(van, mesh(new THREE.SphereGeometry(0.08, 10, 8), lampMat), 1.83, 0.5, -0.35);
  van.position.set(-0.55, 0.12, 0.35);
  van.rotation.y = -0.32;
  add(set, van);

  // laundry bags: plump canvas, tied with forest cord, the LF stamp
  const bags = new THREE.Group();
  const canvasMat = clay("#f3ead8", 0.95);
  const cordMat = clay(BRAND.forest);
  const stampTex = textTexture("LF", { w: 128, h: 128, bg: "#f3ead8", fg: BRAND.forest, font: "800 70px 'Playfair Display', Georgia, serif" });
  for (const [x, z, s] of [[0, 0, 1], [0.7, 0.25, 0.85]] as const) {
    const b = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(0.42, 22, 16), canvasMat);
    body.scale.set(1, 1.15, 0.9);
    body.position.y = 0.45;
    const neck = mesh(new THREE.CylinderGeometry(0.1, 0.18, 0.22, 12), canvasMat);
    neck.position.y = 0.98;
    const tie = mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16), cordMat);
    tie.rotation.x = Math.PI / 2;
    tie.position.y = 0.92;
    const stamp = mesh(new THREE.CircleGeometry(0.14, 20), new THREE.MeshStandardMaterial({ map: stampTex, roughness: 0.9 }));
    stamp.position.set(0, 0.5, 0.39);
    b.add(body, neck, tie, stamp);
    b.scale.setScalar(s);
    b.position.set(x, 0, z);
    bags.add(b);
  }
  bags.position.set(1.05, 0.12, 1.1);
  add(set, bags);

  // a stack of folded towels
  const towels = new THREE.Group();
  ["#efe5d2", "#c8a96e", "#9fb79a", "#efe5d2", "#e9cfc1"].forEach((c, i) => {
    const t = mesh(rbox(0.9, 0.16, 0.62, 0.07), clay(c, 0.95));
    t.position.set((i % 2 ? 0.03 : -0.02), 0.08 + i * 0.165, 0);
    t.rotation.y = (i % 2 ? 0.05 : -0.04);
    towels.add(t);
  });
  towels.position.set(1.0, 0.12, -0.75);
  add(set, towels);

  // the little washer (something lives in the washer)
  const washer = new THREE.Group();
  add(washer, mesh(rbox(1.0, 1.15, 0.95, 0.12), clay("#f4f1ea", 0.6)), 0, 0.58, 0);
  const door = mesh(new THREE.TorusGeometry(0.28, 0.06, 10, 24), clay("#b9c4c8", 0.4));
  door.position.set(0, 0.55, 0.49);
  washer.add(door);
  const portal = mesh(new THREE.CircleGeometry(0.25, 24), new THREE.MeshStandardMaterial({ color: "#6e8f9e", roughness: 0.2, metalness: 0.1 }));
  portal.position.set(0, 0.55, 0.485);
  washer.add(portal);
  const eyes = new THREE.Group();
  for (const sx of [-0.06, 0.06]) {
    const e = mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: "#fff6d0" }));
    e.position.set(sx, 0.57, 0.5);
    eyes.add(e);
  }
  washer.add(eyes);
  washer.position.set(-2.15, 0.12, -0.85);
  washer.rotation.y = 0.25;
  add(set, washer);

  const propObjects: Record<PropId, THREE.Object3D> = { van, bags, towels, washer, palms };

  // the conveyor belt for "speed", parked offstage left
  const conveyor = new THREE.Group();
  add(conveyor, mesh(rbox(3.4, 0.22, 0.7, 0.06), clay("#3c3634")), 0, 0.3, 0);
  for (let i = 0; i < 6; i++) add(conveyor, mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.72, 10), clay("#8d8a86")), -1.5 + i * 0.6, 0.3, 0).rotation.x = Math.PI / 2;
  const zoomTowels: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const t = mesh(rbox(0.5, 0.12, 0.4, 0.05), clay(["#efe5d2", "#c8a96e", "#9fb79a", "#e9cfc1"][i]));
    t.position.set(-1.4 + i * 0.9, 0.5, 0);
    conveyor.add(t);
    zoomTowels.push(t);
  }
  conveyor.position.set(-9, 0.12, 1.3);
  conveyor.visible = false; // parked offstage until "speed"
  set.add(conveyor);

  // ---------------------------------------------------------------- Bertrand and the staff of three
  type Puppet = { root: THREE.Group; head: THREE.Group; armL: THREE.Group; armR: THREE.Group; base: THREE.Vector3 };
  function puppet(o: { body: string; head: string; scale: number }): Puppet {
    const root = new THREE.Group();
    const body = mesh(new THREE.SphereGeometry(0.5, 22, 16), clay(o.body));
    body.scale.set(1, 1.25, 0.85);
    body.position.y = 0.62;
    root.add(body);
    const head = new THREE.Group();
    head.position.y = 1.45;
    const skull = mesh(new THREE.SphereGeometry(0.36, 22, 16), clay(o.head));
    head.add(skull);
    for (const sx of [-0.12, 0.12]) {
      const eye = mesh(new THREE.SphereGeometry(0.055, 10, 8), clay("#fbf6ee", 0.4));
      eye.position.set(sx, 0.05, 0.31);
      const pupil = mesh(new THREE.SphereGeometry(0.028, 8, 6), clay("#1c1714", 0.3));
      pupil.position.set(sx, 0.05, 0.36);
      head.add(eye, pupil);
    }
    root.add(head);
    const arm = (side: number) => {
      const g = new THREE.Group();
      const a = mesh(new THREE.CapsuleGeometry(0.1, 0.5, 6, 10), clay(o.body));
      a.position.y = -0.3;
      g.add(a);
      const hand = mesh(new THREE.SphereGeometry(0.11, 10, 8), clay(o.head));
      hand.position.y = -0.62;
      g.add(hand);
      g.position.set(side * 0.5, 1.0, 0);
      g.rotation.z = side * 0.25;
      root.add(g);
      return g;
    };
    const armL = arm(-1), armR = arm(1);
    root.scale.setScalar(o.scale);
    return { root, head, armL, armR, base: new THREE.Vector3() };
  }

  // Bertrand: navy suit, red tie, enormous moustache, tiny round glasses, slicked hair, a megaphone
  const bert = puppet({ body: "#2d3a5e", head: "#e8b48f", scale: 1.25 });
  const tie = mesh(new THREE.ConeGeometry(0.09, 0.42, 8), clay("#c0392b"));
  tie.rotation.x = Math.PI;
  tie.position.set(0, 1.0, 0.42);
  bert.root.add(tie);
  const stache = new THREE.Group();
  for (const sx of [-1, 1]) {
    const half = mesh(new THREE.TorusGeometry(0.14, 0.045, 8, 16, Math.PI * 0.9), clay("#3b2a20"));
    half.position.set(sx * 0.12, -0.1, 0.33);
    half.rotation.z = sx > 0 ? Math.PI * 1.05 : -Math.PI * 0.05;
    stache.add(half);
  }
  bert.head.add(stache);
  const nose = mesh(new THREE.SphereGeometry(0.1, 12, 10), clay("#dc9c78"));
  nose.position.set(0, -0.02, 0.37);
  bert.head.add(nose);
  for (const sx of [-0.12, 0.12]) {
    const lens = mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 16), clay("#1c1714", 0.3));
    lens.position.set(sx, 0.05, 0.36);
    bert.head.add(lens);
  }
  const hair = mesh(new THREE.SphereGeometry(0.37, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2.3), clay("#2a1d16", 0.5));
  hair.position.y = 0.04;
  bert.head.add(hair);
  const browL = mesh(new THREE.BoxGeometry(0.13, 0.03, 0.03), clay("#2a1d16"));
  const browR = browL.clone();
  browL.position.set(-0.12, 0.17, 0.33);
  browR.position.set(0.12, 0.17, 0.33);
  bert.head.add(browL, browR);
  const megaphone = mesh(new THREE.ConeGeometry(0.2, 0.55, 14, 1, true), clay("#f2c94c", 0.6));
  megaphone.rotation.x = Math.PI / 2;
  megaphone.position.set(0, -0.7, 0.18);
  bert.armR.add(megaphone);
  const hanky = mesh(new THREE.PlaneGeometry(0.3, 0.3), new THREE.MeshStandardMaterial({ color: "#fdfaf2", side: THREE.DoubleSide, roughness: 1 }));
  hanky.position.set(0, -0.72, 0.1);
  hanky.visible = false;
  bert.armL.add(hanky);
  // his director's chair
  const chair = new THREE.Group();
  add(chair, mesh(new THREE.BoxGeometry(1.2, 0.08, 1.0), card("#5d4630")), 0, 1.0, 0);
  add(chair, mesh(new THREE.BoxGeometry(1.2, 0.9, 0.06), new THREE.MeshStandardMaterial({ map: textTexture("BERTRAND", { w: 512, h: 160, bg: "#1d1716", fg: "#e9d9b8", font: "800 90px 'Barlow Condensed', Arial, sans-serif" }), roughness: 0.9 })), 0, 1.6, -0.5);
  for (const [x, z] of [[-0.55, 0.45], [0.55, 0.45], [-0.55, -0.45], [0.55, -0.45]] as const) add(chair, mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), card("#5d4630")), x, 0.5, z);
  chair.position.set(4.7, 0, 2.6);
  chair.rotation.y = -0.95;
  scene.add(chair);
  studioOnly.push(chair);
  bert.root.position.set(4.7, 0.55, 2.6);
  bert.root.rotation.y = -0.95;
  bert.base.copy(bert.root.position);
  scene.add(bert.root);
  studioOnly.push(bert.root);
  bert.root.traverse(o => ((o as THREE.Mesh).isMesh ? ((o as THREE.Mesh).castShadow = true) : null));

  // the staff of three: boom operator, camera operator, gaffer
  const crewColors = [["#7d5a78", "#c98f6a"], ["#4f7b86", "#e2b896"], ["#b0623a", "#8c5a3c"]] as const;
  const crew = crewColors.map(([b, h]) => puppet({ body: b, head: h, scale: 0.9 }));
  const crewSpots: [number, number, number][] = [[-5.4, 0, 2.2], [0.8, 0, 7.6], [5.2, 0, -2.6]];
  crew.forEach((c, i) => {
    const [x, y, z] = crewSpots[i];
    c.root.position.set(x, y, z);
    c.root.rotation.y = Math.atan2(-x, -z);
    c.base.copy(c.root.position);
    const beanie = mesh(new THREE.SphereGeometry(0.37, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), clay(["#e2c46a", "#c0392b", "#2d3a5e"][i]));
    beanie.position.y = 0.05;
    c.head.add(beanie);
    scene.add(c.root);
    studioOnly.push(c.root);
  });
  // the boom pole
  const boom = mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 6), clay("#2a2523"));
  boom.rotation.z = Math.PI / 2.6;
  boom.position.set(0.4, 1.6, 0);
  const mic = mesh(new THREE.CapsuleGeometry(0.12, 0.35, 6, 10), clay("#6d6a66"));
  mic.rotation.z = Math.PI / 2;
  mic.position.set(2.3, 2.4, 0);
  crew[0].root.add(boom, mic);

  // practical lights on stands; which one is lit is the player's choice
  function lightStand(x: number, z: number, color: string) {
    const g = new THREE.Group();
    add(g, mesh(new THREE.CylinderGeometry(0.04, 0.04, 3.4, 8), clay("#2a2523")), 0, 1.7, 0);
    const can = mesh(new THREE.CylinderGeometry(0.32, 0.45, 0.6, 16, 1, true), clay("#1f1b19", 0.5));
    can.position.y = 3.5;
    can.rotation.x = Math.PI / 2.5;
    g.add(can);
    const lensGlow = mesh(new THREE.CircleGeometry(0.4, 18), new THREE.MeshBasicMaterial({ color }));
    lensGlow.position.set(0, 3.38, 0.28);
    lensGlow.rotation.x = Math.PI / 2.5 - Math.PI / 2;
    g.add(lensGlow);
    g.position.set(x, 0, z);
    g.lookAt(0, 0, 0);
    g.rotation.x = 0;
    scene.add(g);
    studioOnly.push(g);
    return { g, lensGlow };
  }
  const stands = { morning: lightStand(-5.6, 3.6, "#ffcf8a"), clean: lightStand(5.6, 4.6, "#dff0ff"), spotlight: lightStand(0.4, -4.8, "#fff3cf") };

  // the player's cardboard camera on its tripod (where the lens is)
  const camProp = new THREE.Group();
  add(camProp, mesh(rbox(0.9, 0.7, 1.1, 0.08), card("#8a6a45")), 0, 2.0, 0);
  add(camProp, mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.5, 16), clay("#1f1b19")), 0, 2.0, -0.75).rotation.x = Math.PI / 2;
  for (const a of [0, 2.1, 4.2]) add(camProp, mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 6), clay("#2a2523")), Math.cos(a) * 0.35, 0.85, Math.sin(a) * 0.35).rotation.set(Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2);
  scene.add(camProp);
  studioOnly.push(camProp);

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight("#ffe9cf", "#4a382e", 0.65);
  scene.add(hemi);
  const studioFill = new THREE.PointLight("#ffd9a8", 46, 36, 1.4);
  studioFill.position.set(3, 8, 9);
  // the bare bulbs over the studio: warm pools on the floor, not on the set
  for (const [x, z] of [[-7, 4], [8, 6], [7, -4]] as const) {
    const b = new THREE.PointLight("#ffc98a", 14, 12, 1.6);
    b.position.set(x, 6.5, z);
    scene.add(b);
    const bulb = mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffe3b0" }));
    bulb.position.copy(b.position);
    scene.add(bulb);
    studioOnly.push(bulb);
  }
  scene.add(studioFill);
  const key = new THREE.DirectionalLight("#ffd9a8", 2.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const spot = new THREE.SpotLight("#fff3cf", 0, 18, 0.42, 0.55, 1.2);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.position.set(0.4, 7, 2.5);
  spot.target = van;
  scene.add(spot);
  const rimLight = new THREE.DirectionalLight("#bcd8ff", 0.0);
  rimLight.position.set(4, 4, -6);
  scene.add(rimLight);

  let light: LightId = "morning";
  function applyLight(l: LightId) {
    light = l;
    for (const [id, s] of Object.entries(stands)) (s.lensGlow.material as THREE.MeshBasicMaterial).color.set(id === l ? (id === "clean" ? "#dff0ff" : "#ffe6b0") : "#3a3330");
    if (l === "morning") {
      key.color.set("#ffcf96");
      key.intensity = 2.6;
      key.position.set(-6, 5.5, 4);
      hemi.intensity = 0.7;
      hemi.color.set("#ffe2c0");
      spot.intensity = 0;
      rimLight.intensity = 0.25;
      renderer.toneMappingExposure = 1.05;
    } else if (l === "clean") {
      key.color.set("#f4f8ff");
      key.intensity = 2.2;
      key.position.set(5, 7, 5);
      hemi.intensity = 1.25;
      hemi.color.set("#eef6ff");
      spot.intensity = 0;
      rimLight.intensity = 0.5;
      renderer.toneMappingExposure = 1.15;
    } else {
      key.intensity = 0.15;
      hemi.intensity = 0.18;
      spot.intensity = 260;
      rimLight.intensity = 0.8;
      renderer.toneMappingExposure = 1.0;
    }
    key.target.position.set(0, 0, 0);
  }
  applyLight("morning");

  // ---------------------------------------------------------------- particles: tears, dust, confetti
  const parts: { m: THREE.Mesh; v: THREE.Vector3; life: number; spin: number }[] = [];
  const confettiColors = ["#ff5a4e", "#f2c94c", "#4fb3a9", BRAND.gold, "#9b6ad6", "#fbf6ee"];
  function burst(kind: "tear" | "dust" | "confetti", at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const geo = kind === "confetti" ? new THREE.PlaneGeometry(0.12, 0.07) : new THREE.SphereGeometry(kind === "tear" ? 0.05 : 0.12, 6, 5);
      const mat =
        kind === "tear"
          ? new THREE.MeshStandardMaterial({ color: "#8ec9ff", roughness: 0.1, transparent: true, opacity: 0.9 })
          : kind === "dust"
            ? new THREE.MeshStandardMaterial({ color: "#d8c4a4", roughness: 1, transparent: true, opacity: 0.7 })
            : new THREE.MeshStandardMaterial({ color: confettiColors[i % confettiColors.length], side: THREE.DoubleSide, roughness: 0.8 });
      const m = mesh(geo, mat);
      m.position.copy(at);
      scene.add(m);
      const v =
        kind === "tear"
          ? new THREE.Vector3((Math.random() - 0.5) * 2.5, 1.5 + Math.random(), (Math.random() - 0.5) * 1.5)
          : kind === "dust"
            ? new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.2) * 3)
            : new THREE.Vector3((Math.random() - 0.5) * 6, 5 + Math.random() * 4, (Math.random() - 0.5) * 6);
      parts.push({ m, v, life: kind === "confetti" ? 4.5 : 1.6, spin: Math.random() * 8 });
    }
  }

  // ---------------------------------------------------------------- state
  let view: View = "studio";
  const lens: Lens = { ...DEFAULT_LENS };
  let mood: Mood = "idle";
  let paused = false;
  let action: { hook: HookId; t: number; resolve: () => void } | null = null;
  let celebrateT = 0;
  let onAirOn_ = false;
  const propsOn: Record<PropId, boolean> = { van: true, bags: true, towels: true, washer: true, palms: true };

  function placeLens(cam: THREE.PerspectiveCamera) {
    // aimed low on purpose: the props sit in the upper part of the ad, the sidewalk runs under the words
    const target = new THREE.Vector3(-0.05, -0.15, 0.35);
    cam.position.set(Math.sin(lens.az) * lens.dist, lens.height, Math.cos(lens.az) * lens.dist + 0.1);
    cam.lookAt(target);
  }
  const studioGoal = { pos: new THREE.Vector3(5.6, 4.6, 11.2), look: new THREE.Vector3(1.4, 1.25, -0.6) };

  function frameInfo(): FrameInfo {
    const cam = lensCam.clone();
    cam.aspect = 0.8;
    placeLens(cam);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    const inFrame = (o: THREE.Object3D) => {
      const p = new THREE.Vector3();
      o.getWorldPosition(p);
      p.y += 0.5;
      p.project(cam);
      return o.visible && Math.abs(p.x) < 0.92 && Math.abs(p.y) < 0.92 && p.z < 1;
    };
    const subjects = (["van", "bags", "towels", "washer"] as PropId[]).filter(id => propsOn[id] && inFrame(propObjects[id])).length;
    return { van: propsOn.van && inFrame(van), subjects };
  }
  let lastFrameKey = "";
  function reportFrame() {
    const f = frameInfo();
    const k = `${f.van}|${f.subjects}`;
    if (k !== lastFrameKey) {
      lastFrameKey = k;
      cb.onFrame?.(f);
    }
  }

  // ---------------------------------------------------------------- resize
  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (softwareGl) renderer.setPixelRatio(Math.min(1, Math.sqrt(400_000 / Math.max(1, w * h))));
    renderer.setSize(w, h, false);
    studioCam.aspect = w / h;
    studioCam.fov = w < h ? 58 : 38;
    studioCam.updateProjectionMatrix();
    lensCam.aspect = w / h;
    lensCam.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  disposers.push(() => ro.disconnect());

  // ---------------------------------------------------------------- the loop
  const clock = new THREE.Clock();
  let elapsed = 0;
  let stepT = 0;
  let stepIdx = 0;
  let tickerT = 0;
  const camPos = new THREE.Vector3().copy(studioGoal.pos);
  const camLook = new THREE.Vector3().copy(studioGoal.look);
  const boil = (p: Puppet, k: number) => {
    // each new frame is a new pose by hand: a hair off where it was
    p.root.position.set(p.base.x + (Math.random() - 0.5) * 0.012 * k, p.base.y + (Math.random() - 0.5) * 0.008 * k, p.base.z + (Math.random() - 0.5) * 0.012 * k);
  };

  function animateStep(t: number) {
    stepIdx++;
    // Bertrand
    const talk = mood === "talk" || mood === "angry" || mood === "joy";
    boil(bert, 1);
    bert.head.rotation.z = mood === "angry" ? Math.sin(t * 9) * 0.12 : talk ? Math.sin(t * 5) * 0.06 : Math.sin(t * 0.8) * 0.03;
    bert.head.rotation.x = mood === "cry" ? 0.35 : 0;
    bert.armR.rotation.x = talk ? -1.0 + Math.sin(t * 6) * 0.35 : -0.2;
    bert.armR.rotation.z = 0.25;
    bert.armL.rotation.x = mood === "cry" ? -2.3 : mood === "joy" ? -2.6 + Math.sin(t * 10) * 0.4 : mood === "angry" ? -1.6 + Math.sin(t * 12) * 0.5 : -0.1;
    hanky.visible = mood === "cry";
    browL.rotation.z = mood === "angry" ? -0.45 : mood === "cry" ? 0.4 : 0.1;
    browR.rotation.z = mood === "angry" ? 0.45 : mood === "cry" ? -0.4 : -0.1;
    if (mood === "joy") bert.root.position.y = bert.base.y + Math.abs(Math.sin(t * 8)) * 0.25;
    stache.rotation.z = talk ? Math.sin(t * 7) * 0.08 : 0;
    // the staff
    crew.forEach((c, i) => {
      boil(c, 1);
      c.head.rotation.y = Math.sin(t * 0.9 + i * 2) * 0.25;
      if (celebrateT > 0) {
        c.root.position.y = c.base.y + Math.abs(Math.sin(t * 9 + i)) * 0.3;
        c.armL.rotation.x = c.armR.rotation.x = -2.6;
      } else c.armL.rotation.x = c.armR.rotation.x = 0;
    });
    // the washer blinks
    eyes.visible = Math.sin(t * 0.7) > -0.92;
    // a tiny breeze in the palms
    palms.children.forEach((p, i) => (p.rotation.z = (i === 0 ? 0.06 : -0.06) + Math.sin(t * 1.3 + i) * 0.015));
  }

  function runAction(dt: number) {
    if (!action) return;
    action.t += dt;
    const t = action.t;
    if (action.hook === "speed") {
      conveyor.visible = t < 2.9;
      conveyor.position.x = THREE.MathUtils.lerp(-9, -0.6, Math.min(1, t / 0.6));
      zoomTowels.forEach((tw, i) => (tw.position.x = -1.4 + i * 0.9 + ((t * 7) % 3.6)));
      if (t > 1.6 && t < 1.7) burst("dust", new THREE.Vector3(1.2, 0.8, 1.2), 10);
      if (t > 2.4) conveyor.position.x = THREE.MathUtils.lerp(-0.6, -9, Math.min(1, (t - 2.4) / 0.5));
      if (t > 3.2) finishAction();
    } else if (action.hook === "relief") {
      sun.position.y = THREE.MathUtils.lerp(1.2, 2.5, Math.min(1, t / 2.2));
      (sun.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + Math.min(1, t / 2.2) * 0.9;
      if (t > 1.2 && Math.floor(t * 12) % 3 === 0) burst("tear", bert.root.position.clone().add(new THREE.Vector3(0, 2.1, 0)), 1);
      if (t > 3.2) finishAction();
    } else {
      const fall = t < 1.0 ? 0 : t < 1.5 ? (t - 1.0) / 0.5 : t < 2.6 ? 1 : Math.max(0.04, 1 - (t - 2.6) / 0.6);
      backdropHinge.rotation.x = fall * 1.25;
      if (t > 1.45 && t < 1.55) burst("dust", new THREE.Vector3(0, 0.4, 1.0), 26);
      if (t > 3.3) {
        backdropHinge.rotation.x = 0.04; // propped back up, a little crooked: crooked is honest
        backdropHinge.rotation.z = 0.025;
        finishAction();
      }
    }
  }
  function finishAction() {
    if (!action) return;
    const r = action.resolve;
    action = null;
    r();
  }

  /** the lens box on screen: 4:5, centred, as large as fits in 92% of the view (the page draws its guide the same way) */
  function lensRect() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    let gh = h * 0.92;
    let gw = gh * 0.8;
    if (gw > w * 0.92) {
      gw = w * 0.92;
      gh = gw / 0.8;
    }
    return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh };
  }
  function renderLens() {
    const r = lensRect();
    const size = new THREE.Vector2();
    renderer.getSize(size);
    lensCam.aspect = 0.8;
    lensCam.updateProjectionMatrix();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.clear();
    // WebGL's viewport origin is bottom-left
    renderer.setViewport(r.x, size.y - r.y - r.h, r.w, r.h);
    renderer.setScissor(r.x, size.y - r.y - r.h, r.w, r.h);
    renderer.setScissorTest(true);
    renderer.render(scene, lensCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
  }
  function frame() {
    const dt = Math.min(0.05, clock.getDelta());
    if (paused) {
      if (view === "lens") renderLens();
      else renderer.render(scene, studioCam);
      return;
    }
    elapsed += dt;
    stepT += dt;
    if (stepT >= STEP) {
      // the stop-motion: puppets and props move on twos
      animateStep(elapsed);
      runAction(stepT);
      stepT = 0;
    }
    tickerT += dt;
    if (tickerT > 1.6) {
      tickerT = 0;
      paintTicker(++tickerIdx);
    }
    // particles (also on twos)
    if (stepIdx % 1 === 0)
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        p.v.y -= 6 * dt;
        p.m.position.addScaledVector(p.v, dt);
        p.m.rotation.x += p.spin * dt;
        p.m.rotation.y += p.spin * 0.7 * dt;
        if (p.m.position.y < 0.15) {
          p.m.position.y = 0.15;
          p.v.set(p.v.x * 0.3, 0, p.v.z * 0.3);
        }
        if (p.life <= 0) {
          scene.remove(p.m);
          p.m.geometry.dispose();
          (p.m.material as THREE.Material).dispose();
          parts.splice(i, 1);
        }
      }
    if (celebrateT > 0) {
      celebrateT -= dt;
      if (Math.random() < 0.5) burst("confetti", new THREE.Vector3((Math.random() - 0.5) * 10, 9, (Math.random() - 0.5) * 6), 2);
    }
    onAirLight.intensity = onAirOn_ ? 6 + Math.sin(elapsed * 4) * 1.5 : 0;

    // cameras
    placeLens(lensCam);
    camProp.position.set(lensCam.position.x * 1.05, 0, lensCam.position.z * 1.05);
    camProp.lookAt(0, 0, 0);
    camPos.lerp(studioGoal.pos, Math.min(1, dt * 2));
    camLook.lerp(studioGoal.look, Math.min(1, dt * 2));
    studioCam.position.copy(camPos);
    studioCam.lookAt(camLook);
    // through the lens you see exactly what the ad will be: no studio, and the very 4:5 frame capture() takes
    for (const o of studioOnly) o.visible = view === "studio";
    if (view === "lens") renderLens();
    else renderer.render(scene, studioCam);
    reportFrame();
  }
  renderer.setAnimationLoop(frame);
  disposers.push(() => {
    renderer.setAnimationLoop(null);
    renderer.dispose();
    renderer.domElement.remove();
  });

  // ---------------------------------------------------------------- test hook
  const hook = {
    ready: true,
    state: () => ({ view, light, lens: { ...lens }, mood, onAir: onAirOn_, props: { ...propsOn }, frame: frameInfo(), acting: Boolean(action) }),
  };
  (window as unknown as { __channel382?: typeof hook }).__channel382 = hook;
  disposers.push(() => {
    const w = window as unknown as { __channel382?: unknown };
    if (w.__channel382 === hook) delete w.__channel382;
  });

  return {
    setView(v) {
      view = v;
    },
    setLight: applyLight,
    setProp(p, on) {
      propsOn[p] = on;
      propObjects[p].visible = on;
    },
    setLens(l) {
      lens.az = THREE.MathUtils.clamp(l.az, -0.55, 0.55);
      lens.height = THREE.MathUtils.clamp(l.height, 0.6, 3.8);
      lens.dist = THREE.MathUtils.clamp(l.dist, 5.2, 12);
    },
    setHook() {
      // the clapperboard in Bertrand's head; nothing on set changes until ACTION
    },
    setChannel(label) {
      paintChannel(label);
    },
    bertrand(m) {
      mood = m;
    },
    action(h) {
      return new Promise<void>(resolve => {
        if (action) action.resolve();
        backdropHinge.rotation.set(0, 0, 0);
        sun.position.y = 1.2;
        action = { hook: h, t: 0, resolve };
      });
    },
    capture() {
      // render the lens at 1080×1350 with the studio hidden, copy it out, then put everything back
      const prevView = view;
      // the dust has settled (the gag's leftovers never reach the ad)
      for (const p of parts.splice(0)) {
        scene.remove(p.m);
        p.m.geometry.dispose();
        (p.m.material as THREE.Material).dispose();
      }
      const hidden = studioOnly.map(o => [o, o.visible] as const);
      for (const o of studioOnly) o.visible = false;
      const prevPR = renderer.getPixelRatio();
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setPixelRatio(1);
      renderer.setSize(1080, 1350, false);
      const cam = lensCam.clone();
      cam.aspect = 1080 / 1350;
      placeLens(cam);
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
      const out = document.createElement("canvas");
      out.width = 1080;
      out.height = 1350;
      out.getContext("2d")!.drawImage(renderer.domElement, 0, 0, 1080, 1350);
      renderer.setPixelRatio(prevPR);
      renderer.setSize(w, h, false);
      for (const [o, v] of hidden) o.visible = v;
      view = prevView;
      return out;
    },
    setOnAir(on) {
      onAirOn_ = on;
      onAirMat.map = on ? onAirOn : onAirOff;
      onAirMat.needsUpdate = true;
    },
    celebrate() {
      celebrateT = 5;
      mood = "joy";
      burst("confetti", new THREE.Vector3(0, 6, 1), 120);
    },
    setPaused(p) {
      paused = p;
    },
    dispose() {
      for (const d of disposers.splice(0)) d();
    },
  };
}
