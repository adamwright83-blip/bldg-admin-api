/**
 * Zombie night is watched from the concierge desk: the building becomes the security monitor wall.
 *
 * One fixed camera per room, mounted high on the cut side and looking down into the room, so the view is the one a
 * security camera would have and "right" on the stick is still right on the screen. The room she is in fills the
 * monitor; the three nearest other cameras run as small live feeds along the bottom. Every feed goes through the
 * same CRT: barrel distortion, scanlines, a rolling bar, phosphor green with a little colour left in, static, and a
 * glitch on every cut. A zombie is no longer a green resident; it is an incident on CAM 06.
 *
 * The game underneath does not change. The runtime renders through here instead of the dollhouse composer whenever
 * the vibe is zombie and the party has not started.
 */
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FLOORS, FLOOR_H, fy } from "./cpeLayout";

export type CctvRoom = { id: string; label: string; floor: number; x0: number; x1: number; cam: THREE.PerspectiveCamera };
/** where the thumbnails sit, as fractions of the viewport (x, y from the top-left, w, h); React draws the labels on these */
export const THUMB_RECTS: { x: number; y: number; w: number; h: number }[] = [
  { x: 0.35, y: 0.79, w: 0.19, h: 0.17 },
  { x: 0.56, y: 0.79, w: 0.19, h: 0.17 },
  { x: 0.77, y: 0.79, w: 0.19, h: 0.17 },
];
const THUMB_W = 224, THUMB_H = 140;

const vertex = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
/**
 * The tube every monitor shares: barrel, a cut's tearing and colour split, phosphor, scanlines, a rolling bar, static.
 * Needs `uRes`, `uDpr` and `vec4 feed(sampler2D, vec2)` (how a feed is read) declared first. `cutAge` is seconds since
 * the last cut; `t` drives the roll and the static (a constant holds the picture still). The story's monitor desk
 * renders its wall through the same tube.
 */
export const CRT_TUBE_GLSL = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

  vec2 barrel(vec2 uv, float k) {
    vec2 c = uv - 0.5;
    float r2 = dot(c, c);
    return 0.5 + c * (1.0 + k * r2);
  }

  /** one monitor: the feed through the tube */
  vec3 tube(sampler2D tex, vec2 uv, float pxScale, float small, float cutAge, float t) {
    vec2 b = barrel(uv, 0.09);
    if (b.x < 0.0 || b.x > 1.0 || b.y < 0.0 || b.y > 1.0) return vec3(0.0);
    // a cut: a few frames of tearing and colour split
    float cut = smoothstep(0.35, 0.0, cutAge);
    float tear = step(0.97, hash(vec2(floor(b.y * 60.0), floor(t * 24.0)))) * cut;
    b.x += tear * 0.04 * (hash(vec2(t, b.y)) - 0.5);
    float split = 0.004 * (0.3 + cut * 3.0);
    vec3 c;
    c.r = feed(tex, b + vec2(split, 0.0)).r;
    c.g = feed(tex, b).g;
    c.b = feed(tex, b - vec2(split, 0.0)).b;
    // tone, then phosphor: mostly green with a little of the original colour kept
    c = c * 1.35 / (1.0 + c);
    float l = pow(luma(c), 0.72);
    vec3 phosphor = mix(vec3(0.03, 0.09, 0.05), vec3(0.66, 1.0, 0.74), l);
    phosphor = mix(phosphor, c * vec3(0.7, 1.0, 0.8) * 1.5, 0.2);
    // scanlines, a rolling bar, static
    float line = 0.82 + 0.18 * sin(b.y * uRes.y * pxScale * 3.14159 / (1.4 * uDpr));
    float roll = 0.08 * smoothstep(0.0, 0.08, abs(fract(t * 0.11 + b.y * 0.5) - 0.5)) + 0.92;
    float noise = (hash(b * uRes * 0.5 + fract(t) * 100.0) - 0.5) * (0.06 + cut * 0.4 + small * 0.06);
    phosphor = phosphor * line * roll + noise;
    // the tube's vignette and corners
    vec2 d = b - 0.5;
    phosphor *= 1.0 - dot(d, d) * 1.1;
    return phosphor;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D tDiffuse, tThumb0, tThumb1, tThumb2;
  uniform vec4 uRect0, uRect1, uRect2;
  uniform vec2 uRes;
  uniform float uDpr, uTime, uCut, uBoot;
  varying vec2 vUv;
  vec4 feed(sampler2D tex, vec2 uv) { return texture2D(tex, uv); }
${CRT_TUBE_GLSL}
  void main() {
    vec2 uv = vUv;
    // boot: the picture opens from a horizontal line
    float open = smoothstep(0.0, 1.0, uBoot);
    float band = abs(uv.y - 0.5) < open * 0.5 ? 1.0 : 0.0;
    vec3 col = tube(tDiffuse, uv, 1.0, 0.0, uTime - uCut, uTime) * band;
    if (band < 0.5 && abs(uv.y - 0.5) < open * 0.5 + 0.004) col = vec3(0.7, 1.0, 0.8);
    // the thumbnails: a bezel, then the small tube
    vec4 rects[3]; rects[0] = uRect0; rects[1] = uRect1; rects[2] = uRect2;
    for (int i = 0; i < 3; i++) {
      vec4 r = rects[i];
      vec2 lo = vec2(r.x, 1.0 - r.y - r.w * 0.0 - r.w), hi = vec2(r.x + r.z, 1.0 - r.y);
      // rects are given from the top-left; uv.y runs from the bottom
      lo = vec2(r.x, 1.0 - (r.y + r.w)); hi = vec2(r.x + r.z, 1.0 - r.y);
      vec2 pad = vec2(6.0 / uRes.x, 6.0 / uRes.y);
      if (uv.x > lo.x - pad.x && uv.x < hi.x + pad.x && uv.y > lo.y - pad.y && uv.y < hi.y + pad.y) {
        col = vec3(0.05, 0.06, 0.07);
        if (uv.x > lo.x && uv.x < hi.x && uv.y > lo.y && uv.y < hi.y) {
          vec2 suv = (uv - lo) / (hi - lo);
          float age = uTime - uCut;
          vec3 t = i == 0 ? tube(tThumb0, suv, 0.25, 1.0, age, uTime) : i == 1 ? tube(tThumb1, suv, 0.25, 1.0, age, uTime) : tube(tThumb2, suv, 0.25, 1.0, age, uTime);
          col = t * band * 0.9;
        }
      }
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export type Cctv = {
  rooms: CctvRoom[];
  active: CctvRoom;
  thumbs: CctvRoom[];
  /** picks the camera for where she is; returns true when the picture cut to another camera */
  follow(floor: number, x: number): boolean;
  render(elapsed: number, dt: number): void;
  setSize(w: number, h: number): void;
  /** the monitor wall switches on (plays the boot line) */
  boot(): void;
  dispose(): void;
};

export function createCctv(renderer: THREE.WebGLRenderer, scene: THREE.Scene, dpr: number): Cctv {
  const rooms: CctvRoom[] = [];
  FLOORS.forEach((fl, f) => {
    let n = 1;
    for (const r of fl.rooms) {
      if (r.kind === "elevator") continue;
      // the pool deck is long: three cameras along it
      const span = r.x1 - r.x0;
      const parts = span > 14 ? 3 : 1;
      for (let p = 0; p < parts; p++) {
        const x0 = r.x0 + (span * p) / parts, x1 = r.x0 + (span * (p + 1)) / parts;
        const cam = new THREE.PerspectiveCamera(56, 1, 0.3, 120);
        rooms.push({ id: `${f + 1}${n}`, label: r.name.toUpperCase(), floor: f, x0, x1, cam });
        n++;
      }
    }
  });
  const place = (room: CctvRoom, heroX: number) => {
    const cx = THREE.MathUtils.clamp(heroX, room.x0 + 4.5, room.x1 - 4.5);
    const y = fy(room.floor);
    room.cam.position.set(cx + 1.4, y + 3.55, 3.4);
    room.cam.lookAt(cx, y + 1.0, -2.9);
    // a security camera is never quite level
    room.cam.rotateZ(-0.012);
  };
  let active = rooms[0];
  let thumbs: CctvRoom[] = rooms.slice(1, 4);
  const targets = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(THUMB_W, THUMB_H, { type: THREE.HalfFloatType }));
  const main = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, main);
  const renderPass = new RenderPass(scene, active.cam);
  composer.addPass(renderPass);
  composer.addPass(new OutputPass());
  const crt = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tThumb0: { value: targets[0].texture },
      tThumb1: { value: targets[1].texture },
      tThumb2: { value: targets[2].texture },
      uRect0: { value: new THREE.Vector4(THUMB_RECTS[0].x, THUMB_RECTS[0].y, THUMB_RECTS[0].w, THUMB_RECTS[0].h) },
      uRect1: { value: new THREE.Vector4(THUMB_RECTS[1].x, THUMB_RECTS[1].y, THUMB_RECTS[1].w, THUMB_RECTS[1].h) },
      uRect2: { value: new THREE.Vector4(THUMB_RECTS[2].x, THUMB_RECTS[2].y, THUMB_RECTS[2].w, THUMB_RECTS[2].h) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: dpr },
      uTime: { value: 0 },
      uCut: { value: -10 },
      uBoot: { value: 1 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  });
  composer.addPass(crt);
  // ShaderPass clones its uniforms and drops render-target textures in the process; hand them over afterwards
  crt.uniforms.tThumb0.value = targets[0].texture;
  crt.uniforms.tThumb1.value = targets[1].texture;
  crt.uniforms.tThumb2.value = targets[2].texture;
  let cutAt = -10;
  let bootAt = -10;
  let heroX = 0;
  let rr = 0;
  const api: Cctv = {
    rooms,
    get active() {
      return active;
    },
    get thumbs() {
      return thumbs;
    },
    follow(floor, x) {
      heroX = x;
      const here = rooms.find(r => r.floor === floor && x >= r.x0 && x < r.x1) ?? rooms.reduce((a, b) => (Math.abs(b.floor - floor) * 50 + Math.abs((b.x0 + b.x1) / 2 - x) < Math.abs(a.floor - floor) * 50 + Math.abs((a.x0 + a.x1) / 2 - x) ? b : a));
      const cut = here !== active;
      if (cut) {
        active = here;
        renderPass.camera = active.cam;
        cutAt = -1; // stamped on the next render
        thumbs = rooms
          .filter(r => r !== active)
          .sort((a, b) => Math.hypot((a.x0 + a.x1) / 2 - x, (a.floor - floor) * FLOOR_H) - Math.hypot((b.x0 + b.x1) / 2 - x, (b.floor - floor) * FLOOR_H))
          .slice(0, 3);
      }
      return cut;
    },
    render(elapsed, dt) {
      if (cutAt === -1) cutAt = elapsed;
      place(active, heroX);
      // one small feed a frame; the others hold their last picture, like a real multiplexer
      const t = thumbs[rr % thumbs.length];
      if (t) {
        place(t, (t.x0 + t.x1) / 2);
        t.cam.aspect = THUMB_W / THUMB_H;
        t.cam.updateProjectionMatrix();
        renderer.setRenderTarget(targets[rr % 3]);
        renderer.render(scene, t.cam);
        renderer.setRenderTarget(null);
      }
      rr++;
      crt.uniforms.uTime.value = elapsed;
      crt.uniforms.uCut.value = cutAt;
      crt.uniforms.uBoot.value = THREE.MathUtils.clamp((elapsed - bootAt) / 0.7, 0, 1);
      void dt;
      composer.render();
    },
    setSize(w, h) {
      composer.setSize(w, h);
      crt.uniforms.uRes.value.set(w, h);
      for (const r of rooms) {
        r.cam.aspect = w / h;
        r.cam.updateProjectionMatrix();
      }
    },
    boot() {
      bootAt = crt.uniforms.uTime.value as number;
      cutAt = bootAt;
    },
    dispose() {
      composer.dispose();
      main.dispose();
      for (const t of targets) t.dispose();
    },
  };
  return api;
}
