import * as THREE from "three";
import type { CourseDef, WorldState } from "./deliveryPhysics";
import { tailSegment } from "./deliveryPhysics";
import { toWorld } from "./deliveryScene";

/**
 * Cleo and Bella for Rook's airmail course, as the same painted paper cutouts as every Silver Lake neighbour.
 *
 * Cleo is her own card (scripts/assets/silver-lake/build_cleo_puppet.py lifts her painted tail and eyes off it). Her
 * eyes open and close on the card; her tail is drawn live from the simulation, because her tail is a real collider:
 * where it is on screen is where it is in the physics. She is mirrored so her tail points at the station.
 */

type CleoMeta = {
  size: [number, number];
  eyes: { x: number; y: number; w: number; h: number }[];
  tailRoot: [number, number];
  outline: [number, number, number];
};

export type CleoEyes = "closed" | "one" | "open" | "wide";
export type BellaPose = "idle" | "wave" | "selected" | "happy";

const CARDS = "/assets/goldline/silver-lake-3d/cards/";
const CLEO_HEIGHT = 1.08;

function img(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error(`missing ${src}`));
    i.src = src;
  });
}

export async function loadCleo(course: CourseDef, reduceMotion: boolean) {
  const [meta, body, eye0, eye1] = await Promise.all([
    fetch(`${CARDS}cleo.json`).then(r => r.json() as Promise<CleoMeta>),
    img(`${CARDS}cleo-body.png`),
    img(`${CARDS}cleo-eye-0.png`),
    img(`${CARDS}cleo-eye-1.png`),
  ]);
  const [W, H] = meta.size;
  const canvas = document.createElement("canvas");
  canvas.width = W * 2;
  canvas.height = H * 2;
  const g = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ink = `rgb(${meta.outline.join(",")})`;
  let drawn = "";
  function draw(eyes: CleoEyes) {
    if (drawn === eyes) return;
    drawn = eyes;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, W, H);
    g.drawImage(body, 0, 0);
    const shut = (e: CleoMeta["eyes"][number]) => {
      g.strokeStyle = ink;
      g.lineWidth = 2.6;
      g.lineCap = "round";
      g.beginPath();
      const cy = e.y + e.h * 0.55;
      g.moveTo(e.x + 1.5, cy);
      g.quadraticCurveTo(e.x + e.w / 2, cy + e.h * 0.32, e.x + e.w - 1.5, cy);
      g.stroke();
    };
    const open = (i: number, scale = 1) => {
      const e = meta.eyes[i];
      const im = i === 0 ? eye0 : eye1;
      const w = e.w * scale;
      const h = e.h * scale;
      g.drawImage(im, e.x + e.w / 2 - w / 2, e.y + e.h / 2 - h / 2, w, h);
    };
    if (eyes === "closed") meta.eyes.forEach(shut);
    else if (eyes === "one") {
      // the near eye cracks open; the far one keeps sleeping
      shut(meta.eyes[0]);
      open(1, 0.85);
    } else if (eyes === "wide") {
      open(0, 1.22);
      open(1, 1.22);
    } else {
      open(0);
      open(1);
    }
    tex.needsUpdate = true;
  }
  draw("closed");

  const group = new THREE.Group();
  group.name = "cleo";
  const pivot = new THREE.Group();
  group.add(pivot);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  const cardW = (W / H) * CLEO_HEIGHT;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(cardW, CLEO_HEIGHT), mat);
  card.position.y = CLEO_HEIGHT / 2;
  // mirrored, so her rear and tail face Rook's station
  card.scale.x = -1;
  pivot.add(card);
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x2b3b1c, transparent: true, opacity: 0.24, depthWrite: false });
  shadowMat.userData.outlineParameters = { visible: false };
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2), shadowMat);
  shadow.scale.set(1.2, 1, 0.7);
  shadow.position.y = 0.025;
  group.add(shadow);
  group.position.copy(toWorld(course.cat.x, 0));

  // the live tail: a tapered calico ribbon with an ink edge, in world space, a hair behind her body
  const N = 14;
  const tailGeo = new THREE.BufferGeometry();
  const tailPos = new Float32Array((N + 1) * 2 * 3);
  const tailUv = new Float32Array((N + 1) * 2 * 2);
  const idx: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  for (let i = 0; i <= N; i++) {
    tailUv.set([i / N, 0, i / N, 1], i * 4);
  }
  tailGeo.setAttribute("position", new THREE.BufferAttribute(tailPos, 3));
  tailGeo.setAttribute("uv", new THREE.BufferAttribute(tailUv, 2));
  tailGeo.setIndex(idx);
  const inkGeo = tailGeo.clone();
  const tailCanvas = document.createElement("canvas");
  tailCanvas.width = 256;
  tailCanvas.height = 32;
  const tg = tailCanvas.getContext("2d")!;
  tg.fillStyle = "#f7f1ec";
  tg.fillRect(0, 0, 256, 32);
  // her coat: brown and orange bands toward the tip, a dark tip
  const bands: [number, number, string][] = [
    [40, 34, "#7a6256"],
    [96, 30, "#e99244"],
    [150, 34, "#7a6256"],
    [205, 51, "#5d4a40"],
  ];
  for (const [x, w, c] of bands) {
    tg.fillStyle = c;
    tg.beginPath();
    tg.ellipse(x + w / 2, 16, w / 2, 20, 0, 0, Math.PI * 2);
    tg.fill();
  }
  const tailTex = new THREE.CanvasTexture(tailCanvas);
  tailTex.colorSpace = THREE.SRGBColorSpace;
  const tailMat = new THREE.MeshBasicMaterial({ map: tailTex, side: THREE.DoubleSide, toneMapped: false });
  tailMat.userData.outlineParameters = { visible: false };
  const inkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(`rgb(${meta.outline.join(",")})`), side: THREE.DoubleSide, toneMapped: false });
  inkMat.userData.outlineParameters = { visible: false };
  const tail = new THREE.Mesh(tailGeo, tailMat);
  const tailInk = new THREE.Mesh(inkGeo, inkMat);
  tail.frustumCulled = false;
  tailInk.frustumCulled = false;

  // a sleepy "z" now and then
  const zCanvas = document.createElement("canvas");
  zCanvas.width = zCanvas.height = 64;
  const zg = zCanvas.getContext("2d")!;
  zg.font = "900 52px 'Trebuchet MS', system-ui, sans-serif";
  zg.textAlign = "center";
  zg.textBaseline = "middle";
  zg.lineWidth = 6;
  zg.strokeStyle = "#ffffff";
  zg.strokeText("z", 32, 34);
  zg.fillStyle = "#4a6fa5";
  zg.fillText("z", 32, 34);
  const zTex = new THREE.CanvasTexture(zCanvas);
  const zMat = new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false });
  const zs = [0, 1].map(() => {
    const s = new THREE.Sprite(zMat.clone());
    s.scale.setScalar(0.22);
    group.add(s);
    return s;
  });

  // and a startled "!" when something wakes her with a jump
  const bangCanvas = document.createElement("canvas");
  bangCanvas.width = bangCanvas.height = 64;
  const bg = bangCanvas.getContext("2d")!;
  bg.font = "900 56px 'Trebuchet MS', system-ui, sans-serif";
  bg.textAlign = "center";
  bg.textBaseline = "middle";
  bg.lineWidth = 8;
  bg.strokeStyle = "#ffffff";
  bg.strokeText("!", 32, 34);
  bg.fillStyle = "#d9534f";
  bg.fillText("!", 32, 34);
  const bangTex = new THREE.CanvasTexture(bangCanvas);
  const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: bangTex, transparent: true, depthWrite: false }));
  bang.visible = false;
  group.add(bang);
  // and the cross little vein of a cat who has been hit by the post, while she is grumpy about it
  const veinCanvas = document.createElement("canvas");
  veinCanvas.width = veinCanvas.height = 64;
  const vg = veinCanvas.getContext("2d")!;
  vg.lineCap = "round";
  for (const [w, c] of [[13, "#ffffff"], [6.5, "#d9534f"]] as const) {
    vg.lineWidth = w;
    vg.strokeStyle = c;
    for (const [cx, cy, a] of [[20, 20, 0], [44, 20, Math.PI / 2], [44, 44, Math.PI], [20, 44, -Math.PI / 2]] as const) {
      vg.beginPath();
      vg.arc(cx, cy, 12, a, a + Math.PI / 2);
      vg.stroke();
    }
  }
  const veinTex = new THREE.CanvasTexture(veinCanvas);
  const vein = new THREE.Sprite(new THREE.SpriteMaterial({ map: veinTex, transparent: true, depthWrite: false }));
  vein.visible = false;
  group.add(vein);

  let eyes: CleoEyes = "closed";
  let eyesUntil = 0;
  let upright = 0; // 0..1, sat bolt upright and offended
  let uprightUntil = 0;
  let jump = 0; // 1 -> 0 over a startled leap
  let startledAt = -1e9;
  // her own clock (ms), from update(); reactions are given as durations, so callers never mix units
  let clock = 0;
  let twitch = 0;
  let meowAt = -9;

  function setTail(world: WorldState, depth: number, widen: number, geo: THREE.BufferGeometry) {
    const seg = tailSegment(course, world.cat.tail);
    const root = toWorld(seg.a.x, seg.a.y, depth);
    const angle = world.cat.tail;
    const p = geo.attributes.position as THREE.BufferAttribute;
    const L = course.cat.tailLen;
    // the tail curls a little more toward its tip, and lifts its tip off the paving while she sleeps
    const curl = world.cat.phase === "asleep" ? 0.55 : world.cat.phase === "grumpy" ? 0.9 + Math.sin(world.t * 6) * 0.3 : 0.25;
    let x = 0;
    let y = 0;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const a = angle - curl * s * s * (Math.cos(angle) < 0 ? 1 : -1);
      if (i > 0) {
        x += Math.cos(a) * (L / N);
        y += Math.sin(a) * (L / N);
      }
      const w = (0.05 * (1 - s) + 0.032 * s) * (s > 0.92 ? Math.sqrt(Math.max(0, (1 - s) / 0.08)) : 1) + widen;
      // across the tail, in the plane: perpendicular to its direction
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const c = toWorld(seg.a.x + x, seg.a.y + y, depth);
      const off = toWorld(seg.a.x + x + nx * w, seg.a.y + y + ny * w, depth).sub(c);
      p.setXYZ(i * 2, c.x + off.x, c.y + off.y, c.z + off.z);
      p.setXYZ(i * 2 + 1, c.x - off.x, c.y - off.y, c.z - off.z);
    }
    p.needsUpdate = true;
    geo.computeBoundingSphere();
    void root;
  }

  return {
    group,
    tail,
    tailInk,
    /** a quick look: open one eye, both, or glare, for `ms` */
    look(e: CleoEyes, ms: number) {
      eyes = e;
      eyesUntil = clock + ms;
    },
    twitch() {
      twitch = 1;
    },
    sitUp(ms: number) {
      upright = 1;
      uprightUntil = clock + ms;
      startledAt = clock;
      eyes = "wide";
      eyesUntil = clock + ms;
      jump = reduceMotion ? 0 : 1;
    },
    meow() {
      meowAt = clock;
    },
    update(world: WorldState, dt: number, elapsed: number, now: number, camera: THREE.Camera) {
      clock = now;
      const cs = world.cat;
      // eyes follow the cat's own state unless something just made her look
      let want: CleoEyes = cs.phase === "asleep" ? "closed" : cs.phase === "grumpy" ? "open" : "wide";
      if (now < eyesUntil) want = eyes;
      draw(want);
      // paper cutout: square to the camera
      group.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
      // breathing while asleep; a roll when the tail lashes; bolt upright when offended
      const breathe = cs.phase === "asleep" && !reduceMotion ? Math.sin(elapsed * 1.6) * 0.025 : 0;
      if (now > uprightUntil) upright = Math.max(0, upright - dt * 2.5);
      twitch = Math.max(0, twitch - dt * 5);
      const slump = cs.phase === "asleep" ? 0.92 : 1;
      const sy = slump + breathe + upright * 0.14 + (now - meowAt < 300 ? 0.08 : 0);
      card.scale.set(-(1 + upright * 0.04 + (cs.phase === "swat" ? 0.06 : 0)), sy, 1);
      card.position.y = (CLEO_HEIGHT * sy) / 2;
      // she rolls away from the hit, onto her side, and back
      const roll = reduceMotion ? cs.roll * 0.4 : cs.roll;
      pivot.rotation.z = roll * 0.9 + Math.sin(elapsed * 55) * twitch * 0.05;
      jump = Math.max(0, jump - dt / 0.5);
      pivot.position.y = roll * 0.08 + (jump > 0 ? Math.sin((1 - jump) * Math.PI) * 0.34 : 0);
      // grumpy after a hit: the vein throbs by her ear
      const grumpy = cs.phase === "grumpy";
      vein.visible = grumpy;
      if (grumpy) {
        vein.position.set(0.24, 0.98 + pivot.position.y, 0.2);
        vein.scale.setScalar(0.24 * (1 + (reduceMotion ? 0 : Math.max(0, Math.sin(elapsed * 9)) * 0.18)));
      }
      // the "!" while she is offended
      const startled = now < uprightUntil && upright > 0.5;
      bang.visible = startled;
      if (startled) {
        const pop = Math.min(1, (now - startledAt) / 140);
        bang.position.set(0.05, 1.32 + pivot.position.y, 0.2);
        bang.scale.setScalar(0.34 * (0.4 + 0.6 * pop) * (1 + Math.sin(pop * Math.PI) * 0.25));
      }
      setTail(world, 0.03, 0, tailGeo);
      setTail(world, 0.04, 0.018, inkGeo);
      // z's drift up while she sleeps
      zs.forEach((z, i) => {
        const k = ((elapsed * 0.35 + i * 0.5) % 1 + 1) % 1;
        const show = cs.phase === "asleep" && now > eyesUntil && !reduceMotion;
        z.visible = show;
        z.position.set(0, 0.95 + k * 0.6, 0.18 + Math.sin(k * 6 + i) * 0.08);
        (z.material as THREE.SpriteMaterial).opacity = show ? Math.sin(k * Math.PI) * 0.9 : 0;
        z.scale.setScalar(0.12 + k * 0.14);
      });
    },
    dispose() {
      tex.dispose();
      mat.dispose();
      card.geometry.dispose();
      shadow.geometry.dispose();
      shadowMat.dispose();
      tailGeo.dispose();
      inkGeo.dispose();
      tailTex.dispose();
      tailMat.dispose();
      inkMat.dispose();
      zTex.dispose();
      zs.forEach(z => (z.material as THREE.SpriteMaterial).dispose());
      zMat.dispose();
      bangTex.dispose();
      bang.material.dispose();
      veinTex.dispose();
      vein.material.dispose();
    },
  };
}

export type CleoPuppet = Awaited<ReturnType<typeof loadCleo>>;

export async function loadBella(course: CourseDef) {
  const loader = new THREE.TextureLoader();
  const poses: BellaPose[] = ["idle", "wave", "selected", "happy"];
  const meta = (await fetch(`${CARDS}bella.json`).then(r => r.json())) as { poses: Record<BellaPose, [number, number]> };
  const textures = await Promise.all(poses.map(p => loader.loadAsync(`${CARDS}bella-${p}.png`)));
  textures.forEach(t => (t.colorSpace = THREE.SRGBColorSpace));
  const byPose = new Map(poses.map((p, i) => [p, textures[i]]));
  const group = new THREE.Group();
  group.name = "bella";
  // the card and anything she holds move together (her hop and sway); the card alone is scaled to the pose
  const rig = new THREE.Group();
  group.add(rig);
  const mat = new THREE.MeshBasicMaterial({ map: textures[0], transparent: true, alphaTest: 0.08, side: THREE.DoubleSide, toneMapped: false });
  mat.userData.outlineParameters = { visible: false };
  const card = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  rig.add(card);
  const H = 1.05;
  let pose: BellaPose = "idle";
  let hop = 0;

  // the bell that came on the glider, held up in her waving paw: a handle in the paw, the bell hanging under it
  const brass = new THREE.MeshToonMaterial({ color: 0xe0b34a });
  const wood = new THREE.MeshToonMaterial({ color: 0x8a5a34 });
  const bell = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.11, 8), wood);
  handle.position.y = -0.05;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), brass);
  dome.position.y = -0.24;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.128, 0.016, 6, 20), brass);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = -0.24;
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), wood);
  clapper.position.y = -0.27;
  bell.add(handle, dome, lip, clapper);
  bell.visible = false;
  rig.add(bell);
  // the paw in the waving card, as a fraction of the card (measured on bella-wave.png)
  const PAW = { u: 105 / 114, v: 85 / 190 };
  let ringT = -1;
  let ringBig = false;
  // a ring of sound for the big one, so the bell reads with the sound off
  const waveMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  waveMat.userData.outlineParameters = { visible: false };
  const waves = [0, 1].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.235, 40), waveMat.clone());
    m.userData.outlineParameters = { visible: false };
    m.visible = false;
    rig.add(m);
    return m;
  });

  function setPose(p: BellaPose) {
    pose = p;
    mat.map = byPose.get(p) ?? textures[0];
    mat.needsUpdate = true;
    const [w, h] = meta.poses[p];
    card.scale.set((w / h) * H, H, 1);
    card.position.y = H / 2;
    const wave = meta.poses.wave;
    bell.position.set((PAW.u - 0.5) * (wave[0] / wave[1]) * H, (1 - PAW.v) * H, 0.04);
    if (p !== "wave") bell.visible = false;
  }
  setPose("idle");
  group.position.copy(toWorld(course.bella.x, course.balcony.floor, -0.3));
  return {
    group,
    get pose() {
      return pose;
    },
    setPose,
    hop() {
      hop = 1;
    },
    /** she holds the bell up (the waving pose), or puts it away */
    holdBell(on: boolean) {
      if (on) setPose("wave");
      bell.visible = on;
    },
    ringBell(big: boolean) {
      if (pose !== "wave") setPose("wave");
      bell.visible = true;
      ringT = 0;
      ringBig = big;
    },
    update(dt: number, elapsed: number, camera: THREE.Camera) {
      group.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
      hop = Math.max(0, hop - dt * 4);
      rig.position.y = Math.sin((1 - hop) * Math.PI) * hop * 0.18 + Math.abs(Math.sin(elapsed * 2)) * 0.015;
      rig.rotation.z = Math.sin(elapsed * 1.2) * 0.03;
      if (ringT >= 0) {
        ringT += dt;
        // the bell swings hard and settles; the rings of sound go out and fade
        const amp = (ringBig ? 0.75 : 0.45) * Math.exp(-ringT * 2.6);
        bell.rotation.z = Math.sin(ringT * 26) * amp;
        waves.forEach((w, i) => {
          const t = ringT - i * 0.14;
          const life = ringBig ? 0.85 : 0.55;
          const on = t > 0 && t < life && (ringBig || i === 0);
          w.visible = on;
          if (!on) return;
          const k = t / life;
          w.position.set(bell.position.x, bell.position.y - 0.24, 0.06);
          w.scale.setScalar(1 + k * (ringBig ? 9 : 5));
          (w.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.85;
        });
        if (ringT > 2.2) {
          ringT = -1;
          bell.rotation.z = 0;
          waves.forEach(w => (w.visible = false));
        }
      }
    },
    dispose() {
      textures.forEach(t => t.dispose());
      mat.dispose();
      card.geometry.dispose();
      [handle, dome, lip, clapper].forEach(m => m.geometry.dispose());
      brass.dispose();
      wood.dispose();
      waveMat.dispose();
      waves.forEach(w => {
        w.geometry.dispose();
        (w.material as THREE.Material).dispose();
      });
    },
  };
}

export type BellaPuppet = Awaited<ReturnType<typeof loadBella>>;
