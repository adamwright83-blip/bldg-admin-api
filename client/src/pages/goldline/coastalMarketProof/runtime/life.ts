import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { MeshBVH } from "three-mesh-bvh";
import { withSunFog, fogUniformsRef } from "./env";
import type { LevelData } from "./level";

/**
 * World life that keeps going while she stands still: plants and sails on the
 * shared wind, boats bobbing and drifting, the gorge waterfall, lantern glow.
 * Everything here is cheap by construction: plants are instanced per mesh,
 * glows are one point cloud, the waterfall is one ribbon plus a few mist sprites.
 */
type WindUniforms = { uTime: { value: number }; uWind: { value: THREE.Vector3 } };

const DIR_LIGHT_LINE = "getDirectionalLightInfo( directionalLight, directLight );";

/** Local-space sway by height above the base, for instanced plants (no _wind attribute). */
function patchPlant(mat: THREE.Material, wind: WindUniforms) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform vec3 uWind;\nattribute float instanceSun;\nvarying float vInstSun;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec4 ip = instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
          float h = max( transformed.y, 0.0 );
          float gust = 0.6 + 0.4 * sin( uTime * 0.7 + ip.x * 0.05 ) * sin( uTime * 0.23 + ip.z * 0.04 );
          float flutter = sin( uTime * 3.1 + ip.x * 1.3 + transformed.x * 4.0 ) * 0.5 + sin( uTime * 5.7 + transformed.z * 5.0 ) * 0.25;
          transformed.xz += uWind.xz * h * h * ( gust + flutter * 0.35 ) * 1.6;
          vInstSun = instanceSun;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vInstSun;")
      .replace(
        "#include <lights_fragment_begin>",
        THREE.ShaderChunk.lights_fragment_begin.replace(DIR_LIGHT_LINE, `${DIR_LIGHT_LINE}\n\t\tdirectLight.color *= vInstSun;`)
      );
  };
  mat.customProgramCacheKey = () => "plant-wind";
}

/** Boat sails carry `_wind` like the level cloth. */
function patchSail(mat: THREE.Material, wind: WindUniforms) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform vec3 uWind;\nattribute float _wind;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.y += _wind * ( sin( uTime * 2.3 + transformed.x * 0.9 ) * 0.14 + sin( uTime * 4.1 + transformed.z * 1.7 ) * 0.05 );`
      );
  };
  mat.customProgramCacheKey = () => "sail-wind";
}

function toLambert(src: THREE.Material): THREE.MeshLambertMaterial {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshLambertMaterial({
    color: s.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: s.map ?? null,
    alphaTest: s.alphaTest || (s.transparent ? 0.5 : 0),
    side: THREE.DoubleSide,
    vertexColors: s.vertexColors,
  });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  return withSunFog(m);
}

function propMeshes(gltf: GLTF, name: string): THREE.Mesh[] {
  const root = gltf.scene.getObjectByName(`PROP_${name}`);
  const out: THREE.Mesh[] = [];
  root?.updateWorldMatrix(true, true);
  root?.traverse(o => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

// ---------------------------------------------------------------------------

export function createLife(opts: {
  scene: THREE.Scene;
  data: LevelData;
  props: GLTF;
  wind: WindUniforms;
  sunDir: THREE.Vector3;
  camCollider: MeshBVH;
  waterNormal: THREE.Texture;
}) {
  const { scene, data, props, wind, sunDir, camCollider } = opts;
  const disposables: { dispose(): void }[] = [];
  const group = new THREE.Group();
  group.name = "life";
  scene.add(group);

  // ---------- plants: one InstancedMesh per plant sub-mesh
  const ray = new THREE.Ray();
  const byType = new Map<string, { p: THREE.Vector3; s: number; r: number; sun: number }[]>();
  for (const pl of data.plants ?? []) {
    const p = new THREE.Vector3(...pl.p);
    ray.origin.copy(p).add(new THREE.Vector3(0, 0.4, 0));
    ray.direction.copy(sunDir);
    const sun = camCollider.raycastFirst(ray, THREE.DoubleSide, 0.2, 250) ? 0 : 1;
    const list = byType.get(pl.t) ?? [];
    list.push({ p, s: pl.s, r: pl.r, sun });
    byType.set(pl.t, list);
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const [type, list] of byType) {
    for (const src of propMeshes(props, type)) {
      const mat = toLambert(src.material as THREE.Material);
      patchPlant(mat, wind);
      const geo = src.geometry.clone();
      geo.applyMatrix4(src.matrixWorld);
      const inst = new THREE.InstancedMesh(geo, mat, list.length);
      const sunAttr = new Float32Array(list.length);
      list.forEach((it, i) => {
        q.setFromAxisAngle(up, it.r);
        m4.compose(it.p, q, new THREE.Vector3(it.s, it.s, it.s));
        inst.setMatrixAt(i, m4);
        sunAttr[i] = it.sun;
      });
      geo.setAttribute("instanceSun", new THREE.InstancedBufferAttribute(sunAttr, 1));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.receiveShadow = true;
      group.add(inst);
      disposables.push(geo, mat);
    }
  }

  // ---------- boats
  type Boat = {
    obj: THREE.Object3D;
    phase: number;
    kind: string;
    base: THREE.Vector3;
    yaw: number;
    circle?: { c: THREE.Vector2; r: number; speed: number; a: number };
    line?: { a: THREE.Vector2; b: THREE.Vector2; speed: number; t: number };
  };
  const templates = new Map<string, THREE.Object3D>();
  for (const kind of ["skiff", "sailboat", "ship"]) {
    const holder = new THREE.Group();
    for (const src of propMeshes(props, kind)) {
      const isSail = src.geometry.getAttribute("_wind") !== undefined;
      const mat = toLambert(src.material as THREE.Material);
      if (isSail) patchSail(mat, wind);
      const geo = src.geometry.clone();
      geo.applyMatrix4(src.matrixWorld);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      holder.add(mesh);
      disposables.push(geo, mat);
    }
    templates.set(kind, holder);
  }
  const boats: Boat[] = [];
  for (const [i, b] of (data.boats ?? []).entries()) {
    const tpl = templates.get(b.type);
    if (!tpl) continue;
    const obj = tpl.clone();
    group.add(obj);
    const boat: Boat = { obj, phase: i * 1.7, kind: b.type, base: new THREE.Vector3(), yaw: b.yaw ?? 0 };
    if (b.p) boat.base.set(b.p[0], 0, b.p[1]);
    if (b.circle) boat.circle = { c: new THREE.Vector2(...b.circle.c), r: b.circle.r, speed: b.circle.speed, a: i * 2.1 };
    if (b.line) boat.line = { a: new THREE.Vector2(...b.line.a), b: new THREE.Vector2(...b.line.b), speed: b.line.speed, t: 0.15 };
    boats.push(boat);
  }
  const moveBoats = (t: number, dt: number) => {
    for (const b of boats) {
      if (b.circle) {
        const c = b.circle;
        c.a += (c.speed / c.r) * dt;
        b.base.set(c.c.x + Math.cos(c.a) * c.r, 0, c.c.y + Math.sin(c.a) * c.r);
        // tangent direction of travel
        const dx = -Math.sin(c.a) * Math.sign(c.speed);
        const dz = Math.cos(c.a) * Math.sign(c.speed);
        b.yaw = Math.atan2(dx, dz);
      } else if (b.line) {
        const l = b.line;
        const len = l.a.distanceTo(l.b);
        l.t = (l.t + (l.speed * dt) / len) % 1;
        b.base.set(l.a.x + (l.b.x - l.a.x) * l.t, 0, l.a.y + (l.b.y - l.a.y) * l.t);
        b.yaw = Math.atan2(l.b.x - l.a.x, l.b.y - l.a.y);
      }
      const size = b.kind === "ship" ? 0.35 : b.kind === "sailboat" ? 0.8 : 1;
      const bob = (Math.sin(t * 1.1 + b.phase) * 0.07 + Math.sin(t * 1.9 + b.phase * 2.3) * 0.04) * size;
      b.obj.position.set(b.base.x, bob, b.base.z);
      // bow is +X in the models; heading yaw means forward = (sin, cos)
      b.obj.rotation.set(
        Math.sin(t * 0.9 + b.phase) * 0.035 * size,
        b.yaw - Math.PI / 2,
        Math.sin(t * 1.3 + b.phase * 1.4) * 0.05 * size,
        "YXZ"
      );
    }
  };

  // ---------- waterfall
  const wf = data.waterfall;
  const top = new THREE.Vector3(...wf.top);
  const bottom = new THREE.Vector3(...wf.bottom);
  const out = new THREE.Vector3(...wf.out).normalize();
  const along = new THREE.Vector3(...wf.along).normalize();
  const fallH = top.y - bottom.y;
  const segs = 28;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // leaves the lip outward, then falls; slight spread with depth
    const push = 1.6 * Math.sqrt(t) + 0.8 * t;
    const y = top.y - fallH * t;
    const half = (wf.width / 2) * (1 + 0.35 * t);
    for (const side of [-1, 1]) {
      const p = top.clone().addScaledVector(out, push).addScaledVector(along, side * half);
      p.y = y;
      pos.push(p.x, p.y, p.z);
      uv.push(side < 0 ? 0 : 1, t);
    }
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const wfGeo = new THREE.BufferGeometry();
  wfGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  wfGeo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  wfGeo.setIndex(idx);
  const wfUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(wfUniforms, fogUniformsRef(), { uTime: wind.uTime, uNoise: { value: opts.waterNormal } });
  const wfMat = new THREE.ShaderMaterial({
    uniforms: wfUniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 transformed = position;
        vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uNoise;
      varying vec2 vUv;
      void main() {
        float s1 = texture2D( uNoise, vec2( vUv.x * 1.3, vUv.y * 2.4 - uTime * 0.55 ) ).r;
        float s2 = texture2D( uNoise, vec2( vUv.x * 3.1 + 0.37, vUv.y * 5.0 - uTime * 0.95 ) ).g;
        float edge = smoothstep( 0.0, 0.22, vUv.x ) * smoothstep( 1.0, 0.78, vUv.x );
        float thin = smoothstep( 0.0, 0.05, vUv.y );
        float a = edge * thin * clamp( 0.35 + 0.9 * s1 * s2, 0.0, 1.0 );
        vec3 col = mix( vec3( 0.55, 0.62, 0.66 ), vec3( 0.95, 0.93, 0.9 ), smoothstep( 0.35, 0.9, s1 * s2 + vUv.y * 0.25 ) );
        gl_FragColor = vec4( col, a * 0.92 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const waterfall = new THREE.Mesh(wfGeo, wfMat);
  waterfall.renderOrder = 2;
  group.add(waterfall);
  disposables.push(wfGeo, wfMat);

  // ---------- soft sprites: mist at the waterfall foot + lantern / lighthouse glow
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const soft = new THREE.CanvasTexture(canvas);
  disposables.push(soft);

  const pointsMaterial = (additive: boolean, color: THREE.Color) =>
    new THREE.ShaderMaterial({
      uniforms: { uMap: { value: soft }, uColor: { value: color }, uTime: wind.uTime, uScale: { value: 500 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uScale;
        attribute float size;
        attribute float phase;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          vAlpha = 0.75 + 0.25 * sin( uTime * ( 7.0 + phase ) + phase * 12.0 ) * sin( uTime * 2.3 + phase * 5.0 );
          if ( phase > 50.0 ) { // mist puffs rise and recycle
            float life = fract( uTime * 0.07 + phase * 0.013 );
            p.y += life * 9.0;
            p.xz += vec2( sin( phase ), cos( phase ) ) * life * 3.0;
            vAlpha = sin( life * 3.14159 ) * 0.5;
          }
          vec4 mv = modelViewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          gl_PointSize = size * uScale / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float a = texture2D( uMap, gl_PointCoord ).a * vAlpha;
          gl_FragColor = vec4( uColor * a, a );
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });

  const glowPos: number[] = [];
  const glowSize: number[] = [];
  const glowPhase: number[] = [];
  for (const l of data.lanterns) {
    glowPos.push(...l);
    glowSize.push(1.1);
    glowPhase.push(Math.random() * 10);
  }
  glowPos.push(...data.lighthouse.lamp);
  glowSize.push(26);
  glowPhase.push(0.5);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute("position", new THREE.Float32BufferAttribute(glowPos, 3));
  glowGeo.setAttribute("size", new THREE.Float32BufferAttribute(glowSize, 1));
  glowGeo.setAttribute("phase", new THREE.Float32BufferAttribute(glowPhase, 1));
  const glowMat = pointsMaterial(true, new THREE.Color(1.0, 0.62, 0.28).multiplyScalar(0.9));
  const glows = new THREE.Points(glowGeo, glowMat);
  glows.frustumCulled = false;
  glows.renderOrder = 3;
  group.add(glows);
  disposables.push(glowGeo, glowMat);

  const mistPos: number[] = [];
  const mistSize: number[] = [];
  const mistPhase: number[] = [];
  for (let i = 0; i < 14; i++) {
    const p = bottom.clone().addScaledVector(out, 2.5 + Math.random() * 3).addScaledVector(along, (Math.random() - 0.5) * 7);
    p.y = 0.8;
    mistPos.push(p.x, p.y, p.z);
    mistSize.push(9 + Math.random() * 6);
    mistPhase.push(60 + i * 5.3);
  }
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute("position", new THREE.Float32BufferAttribute(mistPos, 3));
  mistGeo.setAttribute("size", new THREE.Float32BufferAttribute(mistSize, 1));
  mistGeo.setAttribute("phase", new THREE.Float32BufferAttribute(mistPhase, 1));
  const mistMat = pointsMaterial(false, new THREE.Color(0.85, 0.85, 0.85));
  const mist = new THREE.Points(mistGeo, mistMat);
  mist.frustumCulled = false;
  mist.renderOrder = 2;
  group.add(mist);
  disposables.push(mistGeo, mistMat);

  return {
    group,
    waterfallTop: top,
    waterfallBottom: bottom,
    update(t: number, dt: number, viewportHeight: number) {
      moveBoats(t, dt);
      // point sprites: world size -> pixels for the current projection
      const scale = viewportHeight * 0.9;
      glowMat.uniforms.uScale.value = scale;
      mistMat.uniforms.uScale.value = scale;
    },
    dispose() {
      disposables.forEach(d => d.dispose());
      scene.remove(group);
    },
  };
}
