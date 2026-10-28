/**
 * The game board in the sky over Lantern City: a loop of frosted-glass tiles (built in Blender by
 * scripts/assets/lantern-city-sky-board/build_sky_track.py) floating above the clouds, a warm pulse of light running
 * around it, glowing rims and gold icons, crystals turning at the edge, and the adventurer standing on tonight's tile,
 * looking out over the city.
 *
 * The tiles can wait above the frame and drop in one at a time (the home's opening sequence). Decoration only: it
 * holds no business data and takes no clicks.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type SkyBoardOptions = {
  parent: THREE.Object3D;
  /** turn the loop so tonight's tile sits where the composition wants it (radians about the vertical) */
  yaw?: number;
  /** board-space centre of the loop and its long radius (the Blender loop's radius is 1) */
  centre: THREE.Vector3;
  radius: number;
  trackUrl: string;
  heroUrl: string;
  /** the render layer for everything here (the board's "skip the ink outline" layer) */
  layer: number;
  fog: Record<string, THREE.IUniform>;
};

const GLASS_V = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * w;
    vV = cameraPosition - w.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

const GLASS_F = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float uTime; uniform float uPhase; uniform vec3 uTint; uniform float uGold; uniform float uAlpha;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    vec3 n = normalize(vN); vec3 v = normalize(vV);
    float facing = abs(dot(n, v));
    float fres = pow(1. - facing, 2.2);
    float up = smoothstep(.55, .95, n.y);
    float side = 1. - up;
    // a pulse of warm light travelling around the loop
    float d = fract(uTime * .065 - uPhase);
    float pulse = exp(-d * d * 90.) + exp(-(1. - d) * (1. - d) * 600.);
    // saturated glass: deep blue-violet in the walls, a clearer lilac-blue on top; gold on tonight's tile
    vec3 wall = mix(vec3(.22, .26, .92), vec3(.95, .55, .14), uGold);
    vec3 top = mix(vec3(.5, .62, 1.05), vec3(1.15, .86, .42), uGold);
    vec3 col = mix(wall, top, up);
    // the bevels catch the light: an iridescent edge, pink to cyan with the angle, bright enough to bloom
    float edge = smoothstep(.3, .9, fres);
    vec3 irid = .5 + .5 * cos(6.2832 * (fres * .8 + vec3(.0, .33, .67)) + .8);
    vec3 edgeCol = mix(mix(vec3(1.), irid, .65), vec3(1.25, .95, .55), uGold);
    col += edgeCol * edge * 2.1;
    col += vec3(1., .85, .6) * pulse * (.6 + uGold * .4);
    float a = (.26 + side * .22 + edge * .55 + pulse * .15 + uGold * .22) * uAlpha;
    gl_FragColor = vec4(col, clamp(a, 0., 1.));
    #include <fog_fragment>
  }`;

const GLOW_F = /* glsl */ `
  #include <fog_pars_fragment>
  uniform float uTime; uniform float uPhase; uniform vec3 uColor; uniform float uAlpha;
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    float d = fract(uTime * .065 - uPhase);
    float pulse = exp(-d * d * 90.) + exp(-(1. - d) * (1. - d) * 600.);
    gl_FragColor = vec4(uColor * (1. + pulse * 1.6), uAlpha);
    #include <fog_fragment>
  }`;

type Tile = { group: THREE.Object3D; home: THREE.Vector3; delay: number; t: number; alphas: { value: number }[] };

export function createSkyBoard(opts: SkyBoardOptions) {
  const root = new THREE.Group();
  root.name = "sky-board";
  root.position.copy(opts.centre);
  root.scale.setScalar(opts.radius);
  root.rotation.y = opts.yaw ?? 0;
  opts.parent.add(root);
  // the adventurer is the only lit material here: warm golden-hour sun and sky light, scoped to this group's use
  const hemi = new THREE.HemisphereLight(0xffe6c8, 0x6f86c8, 1.3);
  const sun = new THREE.DirectionalLight(0xffd2a0, 2.0);
  sun.position.set(-0.78, 0.5, 0.38);
  root.add(hemi, sun);

  const time = { value: 0 };
  const materials: THREE.Material[] = [];
  const tiles: Tile[] = [];
  let mixer: THREE.AnimationMixer | null = null;
  const crystals: THREE.Object3D[] = [];
  let landing = false;
  let landed = false;
  let disposed = false;

  const glass = (phase: number, gold: boolean) => {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        ...opts.fog,
        uTime: time,
        uPhase: { value: phase },
        uTint: { value: gold ? new THREE.Color(1.0, 0.82, 0.5) : new THREE.Color(0.72, 0.84, 1.0) },
        uGold: { value: gold ? 1 : 0 },
        uAlpha: { value: 1 },
      },
      vertexShader: GLASS_V,
      fragmentShader: GLASS_F,
      transparent: true,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    });
    materials.push(m);
    return m;
  };
  const glow = (phase: number, color: THREE.Color, alpha = 1) => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...opts.fog, uTime: time, uPhase: { value: phase }, uColor: { value: color }, uAlpha: { value: alpha } },
      vertexShader: GLASS_V,
      fragmentShader: GLOW_F,
      transparent: true,
      fog: true,
      toneMapped: false,
    });
    materials.push(m);
    return m;
  };

  const loader = new GLTFLoader();
  const ready = (async () => {
    const gltf = await loader.loadAsync(opts.trackUrl);
    if (disposed) return;
    const groups = gltf.scene.children.filter(o => /^tile_\d+$/.test(o.name)).sort((a, b) => a.name.localeCompare(b.name));
    const count = groups.length || 1;
    groups.forEach((g, i) => {
      const phase = i / count;
      const gold = i === 0;
      const alphas: { value: number }[] = [];
      const fadeable = (m: THREE.Material) => { const u = (m as THREE.ShaderMaterial).uniforms?.uAlpha; if (u) alphas.push(u); return m; };
      g.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.layers.set(opts.layer);
        mesh.frustumCulled = false;
        if (mesh.name.startsWith("slab_")) {
          mesh.material = fadeable(glass(phase, gold));
          mesh.renderOrder = 1;
        } else if (mesh.name.startsWith("rim_")) {
          mesh.material = fadeable(glow(phase, gold ? new THREE.Color(1.45, 1.1, 0.55) : new THREE.Color(1.05, 1.2, 1.45)));
          mesh.renderOrder = 2;
        } else if (mesh.name.startsWith("icon_")) {
          mesh.material = fadeable(glow(phase, gold ? new THREE.Color(1.4, 1.15, 0.65) : new THREE.Color(1.25, 1.12, 0.85)));
          mesh.renderOrder = 2;
        } else if (mesh.name.startsWith("crystal_")) {
          mesh.material = fadeable(glow(phase, new THREE.Color(1.1, 1.25, 1.5), 0.9));
          crystals.push(mesh);
        }
      });
      root.add(g);
      tiles.push({ group: g, home: g.position.clone(), delay: i * 0.11, t: 1, alphas });
    });

    // the adventurer on tonight's tile, back to us, looking over the city
    try {
      const hero = await loader.loadAsync(opts.heroUrl);
      if (disposed) return;
      const model = hero.scene;
      model.traverse(o => {
        o.layers.set(opts.layer);
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.frustumCulled = false;
      });
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y || 1;
      // a little under half a tile tall: big enough to read, small enough to belong to the world
      model.scale.setScalar(0.12 / height);
      model.position.set(0, 0.05, 0);
      model.rotation.y = Math.PI;
      const front = groups[0];
      if (front) front.add(model);
      mixer = new THREE.AnimationMixer(model);
      const idle = hero.animations.find(a => /^Idle_A$/i.test(a.name)) ?? hero.animations.find(a => /idle/i.test(a.name));
      if (idle) mixer.clipAction(idle).play();
    } catch (e) {
      console.warn("[sky-board] adventurer skipped", e);
    }
  })();

  return {
    root,
    ready,
    /** hold every tile above the frame until land() */
    hold() {
      landed = false;
      landing = false;
      for (const t of tiles) {
        t.t = 0;
        t.group.position.set(t.home.x, t.home.y + 1.6, t.home.z);
        t.group.visible = false;
      }
    },
    /** drop the tiles in one at a time (or at once) */
    land(immediate = false) {
      landing = !immediate;
      landed = immediate;
      for (const t of tiles) {
        t.group.visible = true;
        if (immediate) { t.t = 1; t.group.position.copy(t.home); }
        else t.t = Math.min(t.t, 0);
      }
    },
    update(dt: number, cameraPos?: THREE.Vector3) {
      // fade the far side of the loop, so the glass reads as floating in front of the city rather than over it
      if (cameraPos && tiles.length) {
        const w = new THREE.Vector3();
        const ds = tiles.map(t => t.group.getWorldPosition(w).distanceTo(cameraPos));
        const near = Math.min(...ds), far = Math.max(...ds);
        tiles.forEach((t, i) => {
          const k = far > near ? (ds[i] - near) / (far - near) : 0;
          const a = 1 - 0.78 * k * k;
          for (const u of t.alphas) u.value = a;
        });
      }
      time.value += dt;
      mixer?.update(dt);
      for (const c of crystals) c.rotation.z += dt * 0.6;
      const now = time.value;
      for (const t of tiles) {
        // a gentle hover, out of step tile to tile
        const bob = Math.sin(now * 0.9 + t.delay * 9) * 0.006;
        if (landing && t.t < 1) {
          if (t.delay > 0) { t.delay -= dt; continue; }
          t.t = Math.min(1, t.t + dt / 1.4);
          // ease out with a small overshoot, then settle
          const c1 = 1.4, c3 = c1 + 1, x = t.t - 1;
          const e = 1 + c3 * x * x * x + c1 * x * x;
          t.group.position.set(t.home.x, t.home.y + (1 - e) * 1.6 + bob, t.home.z);
        } else if (t.t >= 1) {
          t.group.position.set(t.home.x, t.home.y + bob, t.home.z);
        }
      }
      if (landing && tiles.every(t => t.t >= 1)) { landing = false; landed = true; }
    },
    get landed() { return landed; },
    /** visual checks */
    stats() { return { tiles: tiles.length, visible: tiles.filter(t => t.group.visible).length, landed, hero: !!mixer, y: tiles[0]?.group.position.y ?? null }; },
    dispose() {
      disposed = true;
      root.removeFromParent();
      for (const m of materials) m.dispose();
      root.traverse(o => (o as THREE.Mesh).geometry?.dispose?.());
    },
  };
}

export type SkyBoard = ReturnType<typeof createSkyBoard>;
