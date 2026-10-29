import * as THREE from "three";

/**
 * Rook in the courtyard: his canonical rig renders (client/public/assets/goldline/companions/rook/overworld and
 * /airmail, made by scripts/assets/blender/rook_rig.py from the approved model), played as a paper cutout facing the
 * camera like every Silver Lake neighbour. Every state is a real rendered pose. There is no mirrored copy and no
 * transform standing in for a missing animation: he faces left (his painted side) or toward you.
 */

type AtlasJson = {
  frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; spriteSourceSize: { x: number; y: number; w: number; h: number }; sourceSize: { w: number; h: number } }>;
  animations: Record<string, string[]>;
  meta: { image: string; size: { w: number; h: number } };
};

export type RookState =
  | "idle"
  | "talk"
  | "walk"
  | "wait"
  | "point"
  | "shrug"
  | "brace"
  | "letter"
  | "confide"
  | "dangle"
  | "fold"
  | "hide"
  | "toss"
  | "catch"
  | "lunge"
  | "flick"
  | "conduct"
  | "ears"
  | "bow";
export type RookFacing = "left" | "front" | "right";

const SHEETS: Record<RookState, { dir: "overworld" | "airmail"; loop: boolean; fps: number }> = {
  idle: { dir: "overworld", loop: true, fps: 8 },
  talk: { dir: "overworld", loop: true, fps: 10 },
  walk: { dir: "overworld", loop: true, fps: 12 },
  wait: { dir: "overworld", loop: false, fps: 10 },
  point: { dir: "overworld", loop: false, fps: 10 },
  shrug: { dir: "overworld", loop: false, fps: 10 },
  brace: { dir: "overworld", loop: false, fps: 12 },
  letter: { dir: "overworld", loop: false, fps: 10 },
  confide: { dir: "overworld", loop: true, fps: 8 },
  dangle: { dir: "overworld", loop: true, fps: 10 },
  fold: { dir: "airmail", loop: true, fps: 9 },
  hide: { dir: "airmail", loop: false, fps: 12 },
  toss: { dir: "airmail", loop: false, fps: 14 },
  catch: { dir: "airmail", loop: false, fps: 14 },
  lunge: { dir: "airmail", loop: false, fps: 12 },
  flick: { dir: "airmail", loop: false, fps: 16 },
  conduct: { dir: "airmail", loop: true, fps: 9 },
  ears: { dir: "airmail", loop: true, fps: 10 },
  bow: { dir: "airmail", loop: false, fps: 10 },
};

/** source frame is 288 px; the feet sit at this pixel row (rook.manifest.json anchor) */
const SOURCE = 288;
const ANCHOR = { x: 144, y: 261.5 };
/** Rook is 1.75 units tall inside a 2.35-unit render; in Silver Lake he stands about 1.3 m */
const HEIGHT = 1.42;
const PX = (2.35 * (HEIGHT / 1.75)) / SOURCE;

type Frame = { u0: number; v0: number; u1: number; v1: number; w: number; h: number; ox: number; oy: number };
type Anim = { tex: THREE.Texture; frames: Frame[] };

export async function loadRookPuppet(base = "/assets/goldline/companions/rook/") {
  const loader = new THREE.TextureLoader();
  const anims = new Map<string, Anim>();
  const textures: THREE.Texture[] = [];
  const states = Object.keys(SHEETS) as RookState[];
  await Promise.all(
    states.map(async state => {
      const { dir } = SHEETS[state];
      const res = await fetch(`${base}${dir}/rook-${state}.json`);
      if (!res.ok) throw new Error(`Rook ${state} sheet missing`);
      const json = (await res.json()) as AtlasJson;
      const tex = await loader.loadAsync(`${base}${dir}/${json.meta.image}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      textures.push(tex);
      const W = json.meta.size.w;
      const H = json.meta.size.h;
      for (const [name, frameNames] of Object.entries(json.animations)) {
        anims.set(name, {
          tex,
          frames: frameNames.map(fn => {
            const f = json.frames[fn];
            return {
              u0: f.frame.x / W,
              u1: (f.frame.x + f.frame.w) / W,
              v0: 1 - (f.frame.y + f.frame.h) / H,
              v1: 1 - f.frame.y / H,
              w: f.frame.w * PX,
              h: f.frame.h * PX,
              ox: (f.spriteSourceSize.x + f.frame.w / 2 - ANCHOR.x) * PX,
              oy: (ANCHOR.y - (f.spriteSourceSize.y + f.frame.h / 2)) * PX,
            };
          }),
        });
      }
    })
  );

  const group = new THREE.Group();
  group.name = "rook";
  const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.06, side: THREE.DoubleSide, toneMapped: false, depthWrite: true });
  mat.userData.outlineParameters = { visible: false };
  const geo = new THREE.PlaneGeometry(1, 1);
  const card = new THREE.Mesh(geo, mat);
  card.renderOrder = 2;
  group.add(card);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x2b3b1c, transparent: true, opacity: 0.22, depthWrite: false });
  shadowMat.userData.outlineParameters = { visible: false };
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), shadowMat);
  shadow.position.y = 0.03;
  group.add(shadow);

  let state: RookState = "idle";
  let facing: RookFacing = "left";
  let t = 0;
  let hold = false;
  let onDone: (() => void) | null = null;
  let applied = "";
  let frozen = false;

  function animFor(s: RookState, f: RookFacing): Anim | undefined {
    return anims.get(`${s}-${f}`) ?? anims.get(`${s}-left`) ?? anims.get(`${s}-front`) ?? anims.get(`idle-${f}`);
  }

  function apply(frame: Frame, tex: THREE.Texture) {
    if (mat.map !== tex) {
      mat.map = tex;
      mat.needsUpdate = true;
    }
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
    uv.setXY(0, frame.u0, frame.v1);
    uv.setXY(1, frame.u1, frame.v1);
    uv.setXY(2, frame.u0, frame.v0);
    uv.setXY(3, frame.u1, frame.v0);
    uv.needsUpdate = true;
    card.scale.set(frame.w, frame.h, 1);
    card.position.set(frame.ox, frame.oy, 0);
  }

  return {
    group,
    get state() {
      return state;
    },
    get facing() {
      return facing;
    },
    /** play a state; one-shot states hold their last frame (or call `then`) */
    play(next: RookState, opts: { facing?: RookFacing; restart?: boolean; then?: () => void; hold?: boolean } = {}) {
      const f = opts.facing ?? facing;
      if (next === state && f === facing && !opts.restart && !frozen) return;
      frozen = false;
      state = next;
      facing = f;
      t = 0;
      hold = opts.hold ?? false;
      onDone = opts.then ?? null;
    },
    face(f: RookFacing) {
      facing = f;
    },
    /** hold a one-shot at a point along it (0..1): the brace follows the elastic's tension */
    scrub(next: RookState, k: number, f: RookFacing = facing) {
      const a = animFor(next, f);
      if (!a) return;
      state = next;
      facing = f;
      const { fps } = SHEETS[next];
      t = (Math.max(0, Math.min(0.999, k)) * a.frames.length) / fps;
      hold = true;
      onDone = null;
      frozen = true;
    },
    /** stop dead on the current frame (comic timing), until the next play() */
    freeze() {
      frozen = true;
    },
    frameIndex() {
      const a = animFor(state, facing);
      if (!a) return 0;
      const { fps, loop } = SHEETS[state];
      const n = a.frames.length;
      const i = Math.floor(t * fps);
      return loop ? i % n : Math.min(n - 1, i);
    },
    update(dt: number, camera: THREE.Camera) {
      if (!frozen) t += dt;
      const a = animFor(state, facing);
      if (a) {
        const { fps, loop } = SHEETS[state];
        const n = a.frames.length;
        let i = Math.floor(t * fps);
        if (!loop && i >= n) {
          i = n - 1;
          if (onDone) {
            const cb = onDone;
            onDone = null;
            cb();
          } else if (!hold && state !== "idle") {
            // one-shots settle back to standing
          }
        }
        const key = `${state}-${facing}-${loop ? i % n : i}`;
        if (key !== applied) {
          applied = key;
          apply(a.frames[loop ? i % n : i], a.tex);
        }
      }
      // paper cutout: always square to the camera, upright
      const cam = camera.position;
      group.rotation.y = Math.atan2(cam.x - group.position.x, cam.z - group.position.z);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      shadowMat.dispose();
      shadow.geometry.dispose();
      textures.forEach(tx => tx.dispose());
    },
  };
}

export type RookPuppet = Awaited<ReturnType<typeof loadRookPuppet>>;
