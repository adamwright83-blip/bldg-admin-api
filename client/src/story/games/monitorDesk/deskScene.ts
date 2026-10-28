/**
 * The monitor desk's picture: Century Park East's set (cpeSet.ts, the same building the dollhouse game draws), six
 * security cameras that pan and zoom, and the wall that shows them: one main monitor and six live thumbnails, every
 * feed through the CPE tube (cpeCctv.ts). The thumbnails refresh two a frame from one shared atlas, like a
 * multiplexer.
 *
 * Who is where comes from deskMachine.ts as a function of time, so the picture holds no game state of its own. The
 * scene also reports what the main monitor holds (`framing`), projected from the main camera, so the machine can
 * judge a still.
 */
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { DEPTH, ELEV_X0, ELEV_X1, fy } from "@/pages/goldline/centuryParkEast3d/cpeLayout";
import { buildSet, materialFor } from "@/pages/goldline/centuryParkEast3d/cpeSet";
import { CRT_TUBE_GLSL } from "@/pages/goldline/centuryParkEast3d/cpeCctv";
import {
  CAMS,
  DOOR_X,
  LOBBY,
  doorsAt,
  figureAt,
  indicatorAt,
  liveAlerts,
  objectAt,
  residentAt,
  signalAt,
  type Alert,
  type FrameBox,
  type Framing,
  type Pose,
  type Timeline,
} from "./deskMachine";

export type Rect = { x: number; y: number; w: number; h: number };
/** where the main monitor and the six thumbnails sit on the canvas, in CSS pixels from its top-left */
export type WallLayout = { width: number; height: number; main: Rect; thumbs: Rect[] };

export const ZOOM_FOV = [56, 38, 26] as const;
const MOUNT_Z = 3.4;
const ATLAS_COLS = 3, ATLAS_ROWS = 2, CELL_W = 256, CELL_H = 160;

export type DeskScene = {
  setLayout(layout: WallLayout): void;
  selected(): number;
  select(cam: number): void;
  /** metres along the room, + is right */
  pan(metres: number): void;
  /** the metres one CSS pixel of drag covers on the main monitor right now */
  metresPerPixel(): number;
  zoom(step: number): void;
  zoomLevel(): number;
  /** what the main monitor holds at the current frame */
  framing(): Framing;
  /** hold the main picture still (a still being printed) for this long */
  hold(seconds: number): void;
  /** draw the wall at night-time `t` (real seconds since the shift started) */
  render(t: number, dt: number): void;
  dispose(): void;
};

const vertex = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function wallFragment(): string {
  const thumbs = Array.from({ length: CAMS.length }, (_, i) => i);
  return /* glsl */ `
  uniform sampler2D tMain, tAtlas;
  uniform vec2 uRes;
  uniform float uDpr, uTime, uCalm, uCut, uFlash, uExposure;
  uniform vec4 uMain;
  uniform vec4 uThumb[${CAMS.length}];
  uniform float uDrop[${CAMS.length + 1}];
  varying vec2 vUv;
  // which part of a texture a feed is: the main target whole, or one cell of the thumbnail atlas
  vec4 gCell;
  vec3 grade(vec3 c) {
    c *= uExposure;
    c = clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), 0.0, 1.0);
    return pow(c, vec3(1.0 / 2.2));
  }
  vec4 feed(sampler2D tex, vec2 uv) {
    vec2 q = gCell.xy + clamp(uv, 0.002, 0.998) * gCell.zw;
    return vec4(grade(texture2D(tex, q).rgb), 1.0);
  }
${CRT_TUBE_GLSL}
  /** a feed losing its signal: snow and a torn bar */
  vec3 snow(vec2 uv, float t) {
    float n = hash(floor(uv * uRes / (2.0 * uDpr)) + fract(t * 7.0) * 91.0);
    float bar = smoothstep(0.1, 0.0, abs(fract(uv.y * 0.6 - t * 1.7) - 0.5));
    return vec3(0.55, 0.75, 0.6) * (n * 0.8 + bar * 0.25);
  }
  bool inRect(vec2 p, vec4 r) { return p.x >= r.x && p.x <= r.x + r.z && p.y >= r.y && p.y <= r.y + r.w; }
  void main() {
    // rects arrive from the top-left in pixels; flip into the quad's uv
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uRes;
    float t = uCalm > 0.5 ? 0.0 : uTime;
    vec3 col = vec3(0.035, 0.04, 0.045);
    if (inRect(p, uMain)) {
      vec2 suv = (p - uMain.xy) / uMain.zw;
      suv.y = 1.0 - suv.y;
      gCell = vec4(0.0, 0.0, 1.0, 1.0);
      col = tube(tMain, suv, 1.0, 0.0, uCalm > 0.5 ? 9.0 : uCut, t);
      col = mix(col, snow(suv, uTime), uDrop[${CAMS.length}]);
      col = mix(col, vec3(0.92, 1.0, 0.94), uFlash);
    }
${thumbs
  .map(
    i => `    if (inRect(p, uThumb[${i}])) {
      vec2 suv = (p - uThumb[${i}].xy) / uThumb[${i}].zw;
      suv.y = 1.0 - suv.y;
      gCell = vec4(${(i % ATLAS_COLS).toFixed(1)} / ${ATLAS_COLS}.0, ${Math.floor(i / ATLAS_COLS).toFixed(1)} / ${ATLAS_ROWS}.0, 1.0 / ${ATLAS_COLS}.0, 1.0 / ${ATLAS_ROWS}.0);
      col = tube(tAtlas, suv, 0.25, 1.0, 9.0, t) * 0.92;
      col = mix(col, snow(suv, uTime), uDrop[${i}]);
    }`
  )
  .join("\n")}
    gl_FragColor = vec4(col, 1.0);
  }
`;
}

type Person = { root: THREE.Object3D; mixer: THREE.AnimationMixer; actions: Map<string, THREE.AnimationAction>; current: string; play(name: string): void };

const ANIM: Record<Pose["anim"], string> = { walk: "Walk_Loop", look: "Idle_No_Loop", idle: "Idle_Loop", interact: "Interact" };

export async function createDeskScene(
  host: HTMLElement,
  opts: { tl: Timeline; castBase: string; calm: boolean; onProgress?: (f: number) => void }
): Promise<DeskScene> {
  const { tl, calm } = opts;
  const disposers: (() => void)[] = [];
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;

  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
  renderer.domElement.setAttribute("data-testid", "story-monitor-desk-canvas");
  renderer.domElement.style.touchAction = "none";
  host.appendChild(renderer.domElement);
  disposers.push(() => {
    renderer.dispose();
    renderer.domElement.remove();
  });
  const softwareGl = (() => {
    try {
      const gl = renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      return /swiftshader|llvmpipe|software|basic render/i.test(name);
    } catch {
      return false;
    }
  })();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, softwareGl ? 1 : coarse ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);

  // ---------------------------------------------------------------- the building at night
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#120f1c");
  scene.fog = new THREE.Fog(0x1a1626, 40, 160);
  scene.add(new THREE.HemisphereLight(0xd9e2ff, 0x2a2238, 0.55));
  const moon = new THREE.DirectionalLight(0xb8c8ff, 0.45);
  moon.position.set(30, 20, 26);
  scene.add(moon);
  const world = new THREE.Group();
  scene.add(world);
  // the lobby opens onto the lift alcove, so the lobby camera holds the desk and the doors in one frame
  const set = buildSet(world, scene, { softwareGl, shadows: false, openings: [{ floor: 0, x: ELEV_X0 }] });
  disposers.push(() => set.dispose());
  // a lamp in every watched room, the lift landing brighter
  for (const c of CAMS) {
    const l = new THREE.PointLight(0xffc98a, c.floor === 2 ? 4 : 6, 12, 1.6);
    l.position.set((c.x0 + c.x1) / 2, fy(c.floor) + 3.1, -2.2);
    scene.add(l);
  }
  const landing = new THREE.PointLight(0xffe3b8, 5, 7, 1.6);
  landing.position.set(DOOR_X, fy(0) + 2.6, -2.6);
  scene.add(landing);

  // ---------------------------------------------------------------- the lift: doors that open, the cab behind them
  const BACK = -DEPTH;
  const doorW = ELEV_X1 - ELEV_X0 - 0.6;
  const cabTex = (() => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 160;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 0, 160);
    grad.addColorStop(0, "#fff1d6");
    grad.addColorStop(0.75, "#d9b98c");
    grad.addColorStop(1, "#6b5640");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 160);
    g.fillStyle = "#a58a62";
    g.fillRect(0, 0, 10, 160);
    g.fillRect(118, 0, 10, 160);
    g.fillStyle = "#8c7454";
    g.fillRect(14, 70, 100, 4);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const cab = new THREE.Mesh(new THREE.PlaneGeometry(doorW, 2.7), new THREE.MeshBasicMaterial({ map: cabTex, color: new THREE.Color(1.4, 1.4, 1.4) }));
  cab.position.set(DOOR_X, fy(0) + 1.35, BACK + 0.345);
  cab.visible = false;
  world.add(cab);
  const brass = materialFor("brass");
  const leaf = (side: -1 | 1) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 2.7, 0.05), brass);
    m.position.set(DOOR_X + (side * doorW) / 4, fy(0) + 1.35, BACK + 0.375);
    m.scale.x = doorW / 2;
    m.visible = false;
    world.add(m);
    return m;
  };
  const leaves = [leaf(-1), leaf(1)];
  const setDoors = (open: number) => {
    cab.visible = open > 0.001;
    for (const [i, m] of leaves.entries()) {
      const side = i === 0 ? -1 : 1;
      const w = (doorW / 2) * (1 - open * 0.94);
      m.visible = cab.visible;
      m.scale.x = w;
      m.position.x = DOOR_X + side * (doorW / 2 - w / 2);
    }
  };

  // the indicator over the lobby doors, repainted when it changes
  const indCanvas = document.createElement("canvas");
  indCanvas.width = 256;
  indCanvas.height = 64;
  const indTex = new THREE.CanvasTexture(indCanvas);
  indTex.colorSpace = THREE.SRGBColorSpace;
  const indMat = new THREE.MeshBasicMaterial({ map: indTex });
  const indicator = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.34), indMat);
  indicator.position.set(DOOR_X, fy(0) + 3.1, BACK + 0.38);
  world.add(indicator);
  let indShown = "";
  const paintIndicator = (text: string, lit: boolean) => {
    const key = `${text}|${lit}`;
    if (key === indShown) return;
    indShown = key;
    const g = indCanvas.getContext("2d")!;
    g.shadowBlur = 0;
    g.fillStyle = lit ? "#3a2608" : "#15111d";
    g.fillRect(0, 0, 256, 64);
    g.font = "700 52px ui-monospace, Menlo, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    if (lit) {
      // lit: the numerals burn, and bloom a little into the panel around them
      g.shadowColor = "#ffd88a";
      g.shadowBlur = 22;
      g.fillStyle = "#ffffff";
      g.fillText(text, 128, 35);
    }
    g.fillStyle = lit ? "#ffffff" : "#d9a548";
    g.fillText(text, 128, 35);
    indTex.needsUpdate = true;
    indMat.color.setScalar(lit ? 5 : 1.2);
  };
  disposers.push(() => {
    cabTex.dispose();
    indTex.dispose();
  });

  // ---------------------------------------------------------------- things that move on the cameras
  const cardboard = new THREE.MeshStandardMaterial({ color: "#c49a6c", roughness: 0.9 });
  const parcels = new THREE.Group();
  const parcelBoxes = [
    { w: 0.8, h: 0.5, d: 0.6, from: [0, 0.25, 0, 0], to: [-0.7, 0.25, 0.5, 0.4] },
    { w: 0.7, h: 0.45, d: 0.5, from: [0.05, 0.72, 0, 0.1], to: [0.4, 0.22, 0.6, -0.5] },
    { w: 0.6, h: 0.4, d: 0.45, from: [-0.05, 1.15, 0.02, -0.1], to: [1.05, 0.2, 0.2, 1.2] },
    { w: 0.45, h: 0.35, d: 0.4, from: [0.02, 1.52, 0, 0.2], to: [-1.2, 0.17, 0.9, 2.1] },
  ].map(b => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), cardboard);
    parcels.add(m);
    return { m, ...b };
  });
  world.add(parcels);

  const cart = new THREE.Group();
  {
    const frame = new THREE.MeshStandardMaterial({ color: "#c7ccd2", roughness: 0.4, metalness: 0.6 });
    const canvas = new THREE.MeshStandardMaterial({ color: "#5d7fa8", roughness: 0.9 });
    const bag = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), canvas);
    bag.position.y = 0.62;
    cart.add(bag);
    const towels = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 0.55), new THREE.MeshStandardMaterial({ color: "#f3efe6", roughness: 1 }));
    towels.position.y = 0.98;
    cart.add(towels);
    for (const [x, z] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.4, 6), frame);
      post.position.set(x, 0.2, z);
      cart.add(post);
    }
  }
  world.add(cart);

  const float = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.17, 10, 24), new THREE.MeshStandardMaterial({ color: "#ff8fb3", roughness: 0.5 }));
  float.rotation.x = -Math.PI / 2;
  world.add(float);

  const vacuum = new THREE.Group();
  {
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 24), new THREE.MeshStandardMaterial({ color: "#2b2e33", roughness: 0.4, metalness: 0.3 }));
    shell.position.y = 0.06;
    vacuum.add(shell);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3.4, 3.2) }));
    eye.position.set(0, 0.12, 0.17);
    vacuum.add(eye);
  }
  world.add(vacuum);

  // ---------------------------------------------------------------- people: the figure and one resident
  const loader = new GLTFLoader();
  const progress = new Map<string, number>();
  const load = (file: string) =>
    loader.loadAsync(opts.castBase + file, e => {
      if (e.total) progress.set(file, e.loaded / e.total);
      opts.onProgress?.([...progress.values()].reduce((a, b) => a + b, 0) / 3);
    });
  let loaded: GLTF[];
  try {
    loaded = await Promise.all([load("barista.glb"), load("influencer_b.glb"), load("anims.glb")]);
  } catch (error) {
    for (const d of disposers.reverse()) d();
    throw error;
  }
  const [figureG, residentG, animsG] = loaded;
  const clips = animsG.animations;
  const person = (g: GLTF, tint: string | null, scale: number): Person => {
    const root = SkeletonUtils.clone(g.scene);
    root.scale.setScalar(scale);
    root.traverse(o => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.roughness = 0.85;
      if (tint && /CAST/.test(mat.name)) mat.color.set(tint);
      m.material = mat;
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const c of clips) actions.set(c.name, mixer.clipAction(c));
    const p: Person = {
      root,
      mixer,
      actions,
      current: "",
      play(name) {
        if (p.current === name) return;
        const next = actions.get(name);
        if (!next) return;
        next.reset().fadeIn(calm ? 0 : 0.2).play();
        actions.get(p.current)?.fadeOut(calm ? 0 : 0.2);
        p.current = name;
      },
    };
    root.visible = false;
    world.add(root);
    return p;
  };
  const figure = person(figureG, tl.settings.tint, 0.93);
  const resident = person(residentG, null, 1);
  const place = (p: Person, pose: Pose, floor: number, dt: number) => {
    p.root.visible = pose.visible;
    if (!pose.visible) return;
    p.root.position.set(pose.x, fy(floor), pose.z);
    // turn towards the heading rather than snapping, so a look reads as a look
    const cur = p.root.rotation.y;
    const diff = Math.atan2(Math.sin(pose.heading - cur), Math.cos(pose.heading - cur));
    p.root.rotation.y = calm ? pose.heading : cur + diff * Math.min(1, dt * 7);
    p.play(ANIM[pose.anim]);
    p.mixer.update(dt);
  };

  // ---------------------------------------------------------------- the cameras
  type Cam = { cam: THREE.PerspectiveCamera; aim: number; aimTo: number; zoom: number; fov: number; mount: THREE.Vector3 };
  const cams: Cam[] = CAMS.map(c => {
    const cam = new THREE.PerspectiveCamera(ZOOM_FOV[0], 1.6, 0.3, 140);
    const mount = new THREE.Vector3(c.mount, fy(c.floor) + 3.55, MOUNT_Z);
    cam.position.copy(mount);
    return { cam, aim: c.home, aimTo: c.home, zoom: 0, fov: ZOOM_FOV[0], mount };
  });
  const aimCam = (i: number, dt: number, aspect: number) => {
    const c = cams[i];
    const k = calm ? 1 : Math.min(1, dt * 9);
    c.aim += (c.aimTo - c.aim) * k;
    c.fov += (ZOOM_FOV[c.zoom] - c.fov) * k;
    c.cam.fov = c.fov;
    c.cam.aspect = aspect;
    c.cam.updateProjectionMatrix();
    c.cam.position.copy(c.mount);
    c.cam.lookAt(c.aim, fy(CAMS[i].floor) + 1.3, -2.9);
    // a security camera is never quite level
    c.cam.rotateZ(-0.012);
    c.cam.updateMatrixWorld();
  };
  let sel = LOBBY;

  // ---------------------------------------------------------------- targets and the wall
  const hdr = { type: THREE.HalfFloatType } as const;
  const mainRT = new THREE.WebGLRenderTarget(4, 4, hdr);
  const atlas = new THREE.WebGLRenderTarget(CELL_W * ATLAS_COLS, CELL_H * ATLAS_ROWS, hdr);
  disposers.push(() => {
    mainRT.dispose();
    atlas.dispose();
  });
  const wallMat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: wallFragment(),
    uniforms: {
      tMain: { value: mainRT.texture },
      tAtlas: { value: atlas.texture },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: pixelRatio },
      uTime: { value: 0 },
      uCalm: { value: calm ? 1 : 0 },
      uCut: { value: 9 },
      uFlash: { value: 0 },
      uExposure: { value: 1.25 },
      uMain: { value: new THREE.Vector4() },
      uThumb: { value: CAMS.map(() => new THREE.Vector4()) },
      uDrop: { value: new Array(CAMS.length + 1).fill(0) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const wallScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), wallMat);
  quad.frustumCulled = false;
  wallScene.add(quad);
  const wallCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  disposers.push(() => {
    wallMat.dispose();
    quad.geometry.dispose();
  });

  let layout: WallLayout = { width: 1, height: 1, main: { x: 0, y: 0, w: 1, h: 1 }, thumbs: CAMS.map(() => ({ x: 0, y: 0, w: 0, h: 0 })) };
  const setLayout = (next: WallLayout) => {
    layout = next;
    renderer.setSize(next.width, next.height, false);
    renderer.domElement.style.width = `${next.width}px`;
    renderer.domElement.style.height = `${next.height}px`;
    const s = pixelRatio;
    wallMat.uniforms.uRes.value.set(next.width * s, next.height * s);
    const v = (r: Rect, out: THREE.Vector4) => out.set(r.x * s, r.y * s, r.w * s, r.h * s);
    v(next.main, wallMat.uniforms.uMain.value);
    next.thumbs.forEach((r, i) => v(r, wallMat.uniforms.uThumb.value[i]));
    const mw = Math.max(4, Math.min(1600, Math.round(next.main.w * s)));
    const mh = Math.max(4, Math.min(1200, Math.round(next.main.h * s)));
    mainRT.setSize(mw, mh);
  };

  // ---------------------------------------------------------------- per frame: where everyone is
  let cutAt = -9;
  let holdUntil = -1;
  let flashAt = -9;
  let rr = 0;
  let lastT = 0;
  const pose = (t: number, dt: number) => {
    const alerts = liveAlerts(tl, t);
    const fig = figureAt(tl, t);
    place(figure, fig, 0, dt);
    const res = alerts.find(a => a.kind === "resident_lift" || a.kind === "resident_mail");
    place(resident, res ? residentAt(res, t) : { visible: false, x: 0, z: 0, heading: 0, anim: "idle" }, res ? CAMS[res.cam].floor : 0, dt);
    setDoors(doorsAt(tl, t));
    const ind = indicatorAt(tl, t);
    paintIndicator(ind.text, ind.lit);
    const show = (kind: Alert["kind"]) => alerts.find(a => a.kind === kind);
    const p = show("parcels");
    parcels.visible = !!p;
    if (p) {
      const o = objectAt(p, t);
      parcels.position.set(o.x, fy(CAMS[p.cam].floor), o.z);
      const f = calm ? (o.fallen > 0 ? 1 : 0) : o.fallen * o.fallen;
      for (const b of parcelBoxes) {
        b.m.position.set(b.from[0] + (b.to[0] - b.from[0]) * f, b.from[1] + (b.to[1] - b.from[1]) * f, b.from[2] + (b.to[2] - b.from[2]) * f);
        b.m.rotation.set(f * 0.3 * Math.sign(b.to[3]), b.from[3] + (b.to[3] - b.from[3]) * f, f * 0.2);
      }
    }
    const c = show("cart");
    cart.visible = !!c;
    if (c) {
      const o = objectAt(c, t);
      cart.position.set(o.x, fy(CAMS[c.cam].floor), o.z);
      cart.rotation.y = Math.sin(o.spin) * 0.08;
    }
    const fl = show("float");
    float.visible = !!fl;
    if (fl) {
      const o = objectAt(fl, t);
      float.position.set(o.x, fy(CAMS[fl.cam].floor) + 0.42 + o.y, o.z);
      float.rotation.z = o.spin;
    }
    const v = show("vacuum");
    vacuum.visible = !!v;
    if (v) {
      const o = objectAt(v, t);
      vacuum.position.set(o.x, fy(CAMS[v.cam].floor), o.z);
      vacuum.rotation.y = o.spin * 2 + Math.PI / 2;
    }
    // the lamps breathe a little; the lift landing warms while the doors are open
    for (const lamp of set.lamps) (lamp.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = lamp.base * 0.7;
    landing.intensity = 5 + doorsAt(tl, t) * 6;
  };

  // ---------------------------------------------------------------- what the main monitor holds
  const tmp = new THREE.Vector3();
  const boxOf = (points: THREE.Vector3[], camera: THREE.Camera): FrameBox | null => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of points) {
      tmp.copy(p).project(camera);
      if (tmp.z > 1 || tmp.z < -1) return null;
      const fx = (tmp.x + 1) / 2, fyy = (1 - tmp.y) / 2;
      x0 = Math.min(x0, fx);
      x1 = Math.max(x1, fx);
      y0 = Math.min(y0, fyy);
      y1 = Math.max(y1, fyy);
    }
    return { x0, y0, x1, y1 };
  };
  const personBox = (x: number, floor: number, z: number, h: number, r = 0.24) => [
    new THREE.Vector3(x - r, fy(floor), z),
    new THREE.Vector3(x + r, fy(floor), z),
    new THREE.Vector3(x - r, fy(floor) + h, z),
    new THREE.Vector3(x + r, fy(floor) + h, z),
  ];
  const objectBox = (o: THREE.Object3D) => {
    const b = new THREE.Box3().setFromObject(o);
    const pts: THREE.Vector3[] = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new THREE.Vector3(x, y, z));
    return pts;
  };
  const framing = (t: number): Framing => {
    const camera = cams[sel].cam;
    const boxes: Framing["boxes"] = {};
    const fig = figureAt(tl, t);
    if (sel === LOBBY && fig.visible) boxes.figure = boxOf(personBox(fig.x, 0, fig.z, 1.62), camera) ?? undefined;
    for (const a of liveAlerts(tl, t)) {
      if (a.cam !== sel) continue;
      const floor = CAMS[a.cam].floor;
      let pts: THREE.Vector3[] | null = null;
      if (a.kind === "resident_lift" || a.kind === "resident_mail") {
        const r = residentAt(a, t);
        if (r.visible) pts = personBox(r.x, floor, r.z, 1.7);
      } else {
        const obj = { parcels, cart, float, vacuum }[a.kind];
        if (obj.visible) pts = objectBox(obj);
      }
      const b = pts && boxOf(pts, camera);
      if (b) boxes[String(a.id)] = b;
    }
    let ind: FrameBox | null = null;
    if (sel === LOBBY) {
      const p = indicator.position;
      ind = boxOf([new THREE.Vector3(p.x - 0.65, p.y - 0.17, p.z), new THREE.Vector3(p.x + 0.65, p.y + 0.17, p.z)], camera);
    }
    return { cam: sel, boxes, indicator: ind };
  };

  // ---------------------------------------------------------------- draw
  const render = (t: number, dt: number) => {
    lastT = t;
    pose(t, dt);
    const mainAspect = layout.main.w / Math.max(1, layout.main.h);
    // the main monitor, unless a still is being printed
    if (t >= holdUntil) {
      aimCam(sel, dt, mainAspect);
      renderer.setRenderTarget(mainRT);
      renderer.render(scene, cams[sel].cam);
    }
    // two thumbnails a frame into the atlas (one under software GL)
    const per = softwareGl ? 1 : 2;
    for (let n = 0; n < per; n++) {
      const i = rr++ % CAMS.length;
      if (i !== sel) aimCam(i, dt * CAMS.length, CELL_W / CELL_H);
      else {
        // the main camera's own thumbnail shows the same aim at the thumbnail's shape
        cams[i].cam.aspect = CELL_W / CELL_H;
        cams[i].cam.updateProjectionMatrix();
      }
      const x = (i % ATLAS_COLS) * CELL_W, y = Math.floor(i / ATLAS_COLS) * CELL_H;
      atlas.viewport.set(x, y, CELL_W, CELL_H);
      atlas.scissor.set(x, y, CELL_W, CELL_H);
      atlas.scissorTest = true;
      renderer.setRenderTarget(atlas);
      renderer.render(scene, cams[i].cam);
      if (i === sel) {
        cams[i].cam.aspect = mainAspect;
        cams[i].cam.updateProjectionMatrix();
      }
    }
    renderer.setRenderTarget(null);
    const u = wallMat.uniforms;
    u.uTime.value = t;
    u.uCut.value = t - cutAt;
    u.uFlash.value = calm ? 0 : Math.max(0, 1 - (t - flashAt) / 0.35);
    const drops = u.uDrop.value as number[];
    CAMS.forEach((_, i) => (drops[i] = signalAt(tl, i, t) ? 0 : 0.85));
    drops[CAMS.length] = t >= holdUntil && !signalAt(tl, sel, t) ? 0.9 : 0;
    renderer.render(wallScene, wallCam);
  };

  return {
    setLayout,
    selected: () => sel,
    select(i) {
      if (i === sel || i < 0 || i >= CAMS.length) return;
      sel = i;
      cutAt = lastT;
      holdUntil = -1;
    },
    pan(metres) {
      const c = cams[sel];
      const r = CAMS[sel];
      c.aimTo = THREE.MathUtils.clamp(c.aimTo + metres, r.x0 + 1, r.x1 - 1);
    },
    metresPerPixel() {
      const c = cams[sel];
      const dist = Math.abs(c.mount.z + 2.9);
      const height = 2 * dist * Math.tan(THREE.MathUtils.degToRad(c.fov) / 2);
      return height / Math.max(1, layout.main.h);
    },
    zoom(step) {
      const c = cams[sel];
      c.zoom = THREE.MathUtils.clamp(c.zoom + step, 0, ZOOM_FOV.length - 1);
    },
    zoomLevel: () => cams[sel].zoom,
    framing: () => framing(lastT),
    hold(seconds) {
      holdUntil = lastT + seconds;
      flashAt = lastT;
    },
    render,
    dispose() {
      for (const d of disposers.reverse()) d();
    },
  };
}

/** The six thumbnails are drawn from a 3 × 2 atlas; this is the shape every thumbnail rect should have. */
export const THUMB_ASPECT = CELL_W / CELL_H;
