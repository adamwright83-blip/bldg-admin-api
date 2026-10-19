import * as THREE from "three";

/**
 * The illustrated look for Silver Lake: cel shading, painted surface detail and ink outlines.
 *
 * Every lit material becomes a MeshToonMaterial with a soft three-band ramp. Surfaces get a hand-drawn
 * detail texture (shingles, thatch, plaster, wood grain, grass, sand, stone) projected in world space
 * (triplanar), multiplied over the material's own colour so the palette from Blender stays in charge.
 * Outlines come from OutlineEffect in the runtime; materials opt out through userData.outlineParameters.
 */

type Kind = "shingle" | "thatch" | "plaster" | "wood" | "grass" | "sand" | "stone" | "cliff" | "plain";

function kindFor(name: string): Kind {
  const n = name.toLowerCase();
  if (n.startsWith("thatch")) return "thatch";
  if (n.startsWith("roof") || n === "birdhouse") return "shingle";
  if (n.startsWith("plaster") || n === "cream") return "plaster";
  if (n === "timber" || n.startsWith("door") || n === "box" || n === "bench" || n === "crate") return "wood";
  if (n.startsWith("grass")) return "grass";
  if (n === "path") return "sand";
  if (n.startsWith("stone") || n === "chimney") return "stone";
  if (n.startsWith("cliff")) return "cliff";
  return "plain";
}

let rampTex: THREE.DataTexture | null = null;
let leafRamp: THREE.DataTexture | null = null;
/** Foliage is lit softly: dense canopies shade themselves, and the darkest band reads as brown from above. */
export function foliageRamp(): THREE.DataTexture {
  if (leafRamp) return leafRamp;
  const steps = [178, 222, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  leafRamp = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  leafRamp.minFilter = THREE.NearestFilter;
  leafRamp.magFilter = THREE.NearestFilter;
  leafRamp.needsUpdate = true;
  return leafRamp;
}
export function toonRamp(): THREE.DataTexture {
  if (rampTex) return rampTex;
  const steps = [96, 168, 220, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  rampTex = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  rampTex.minFilter = THREE.NearestFilter;
  rampTex.magFilter = THREE.NearestFilter;
  rampTex.needsUpdate = true;
  return rampTex;
}

const rand = (() => {
  let s = 1234567;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
})();

function canvas(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return [c, c.getContext("2d")!] as const;
}

function shade(v: number, a = 1) {
  const k = Math.round(Math.max(0, Math.min(1, v)) * 255);
  return `rgba(${k},${k},${k},${a})`;
}

/** Detail textures are greyscale around 0.9, multiplied into the base colour. */
function paint(kind: Kind): HTMLCanvasElement {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = shade(0.92);
  g.fillRect(0, 0, S, S);
  const speckle = (n: number, lo: number, hi: number, rmax: number) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = shade(lo + rand() * (hi - lo), 0.55);
      g.beginPath();
      g.arc(rand() * S, rand() * S, 0.6 + rand() * rmax, 0, Math.PI * 2);
      g.fill();
    }
  };
  if (kind === "shingle") {
    const rows = 8;
    const rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * (rh * 0.6);
      for (let x = -rh; x < S + rh; x += rh * 1.2) {
        const cx = x + off;
        const y = r * rh;
        g.fillStyle = shade(0.86 + rand() * 0.12);
        g.beginPath();
        g.moveTo(cx - rh * 0.6, y);
        g.lineTo(cx + rh * 0.6, y);
        g.lineTo(cx + rh * 0.6, y + rh * 0.55);
        g.quadraticCurveTo(cx + rh * 0.6, y + rh * 1.02, cx, y + rh * 1.02);
        g.quadraticCurveTo(cx - rh * 0.6, y + rh * 1.02, cx - rh * 0.6, y + rh * 0.55);
        g.closePath();
        g.fill();
        g.strokeStyle = shade(0.55, 0.85);
        g.lineWidth = 2.2;
        g.stroke();
        g.fillStyle = shade(1, 0.35);
        g.fillRect(cx - rh * 0.4, y + rh * 0.12, rh * 0.5, rh * 0.08);
      }
    }
  } else if (kind === "thatch") {
    for (let i = 0; i < 900; i++) {
      const x = rand() * S;
      const y = rand() * S;
      g.strokeStyle = shade(0.68 + rand() * 0.34, 0.8);
      g.lineWidth = 1 + rand() * 1.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rand() - 0.5) * 6, y + 14 + rand() * 18);
      g.stroke();
    }
    for (let r = 0; r < 4; r++) {
      g.fillStyle = shade(0.62, 0.5);
      g.fillRect(0, r * 64 + 60, S, 4);
    }
  } else if (kind === "plaster") {
    for (let i = 0; i < 26; i++) {
      g.fillStyle = shade(0.86 + rand() * 0.14, 0.35);
      g.beginPath();
      g.ellipse(rand() * S, rand() * S, 16 + rand() * 40, 10 + rand() * 26, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    speckle(600, 0.72, 1.0, 1.2);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = shade(0.62, 0.5);
      g.lineWidth = 1.4;
      const x = rand() * S;
      const y = rand() * S;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 8 + rand() * 10, y + 4 + rand() * 6);
      g.lineTo(x + 14 + rand() * 12, y + rand() * 10);
      g.stroke();
    }
  } else if (kind === "wood") {
    for (let y = 0; y < S; y += 3) {
      g.strokeStyle = shade(0.74 + rand() * 0.26, 0.7);
      g.lineWidth = 1 + rand() * 1.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= S; x += 16) g.lineTo(x, y + Math.sin(x * 0.05 + y * 0.3) * 1.6);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      g.strokeStyle = shade(0.55, 0.8);
      g.lineWidth = 1.6;
      g.beginPath();
      g.ellipse(rand() * S, rand() * S, 6 + rand() * 6, 3 + rand() * 3, 0, 0, Math.PI * 2);
      g.stroke();
    }
    for (let y = 0; y < S; y += 64) {
      g.fillStyle = shade(0.5, 0.7);
      g.fillRect(0, y, S, 2.5);
    }
  } else if (kind === "grass") {
    for (let i = 0; i < 24; i++) {
      g.fillStyle = shade(0.82 + rand() * 0.2, 0.4);
      g.beginPath();
      g.ellipse(rand() * S, rand() * S, 20 + rand() * 36, 14 + rand() * 24, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 520; i++) {
      const x = rand() * S;
      const y = rand() * S;
      g.strokeStyle = shade(rand() > 0.5 ? 0.66 : 1.0, 0.75);
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + 2, y - 4, x + (rand() - 0.5) * 5, y - 7 - rand() * 4);
      g.stroke();
    }
  } else if (kind === "sand") {
    speckle(900, 0.74, 1.0, 1.1);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = shade(0.72 + rand() * 0.2, 0.8);
      g.beginPath();
      g.ellipse(rand() * S, rand() * S, 2 + rand() * 3.5, 1.5 + rand() * 2.5, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
  } else if (kind === "stone" || kind === "cliff") {
    speckle(500, 0.7, 1.0, 1.6);
    for (let i = 0; i < (kind === "cliff" ? 30 : 12); i++) {
      g.strokeStyle = shade(0.55, 0.6);
      g.lineWidth = kind === "cliff" ? 2.4 : 1.4;
      const y = rand() * S;
      g.beginPath();
      g.moveTo(rand() * S, y);
      g.lineTo(rand() * S, y + (rand() - 0.5) * 16);
      g.stroke();
    }
  }
  return c;
}

const detailCache = new Map<Kind, THREE.Texture>();
function detail(kind: Kind) {
  let t = detailCache.get(kind);
  if (!t) {
    t = new THREE.CanvasTexture(paint(kind));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
    detailCache.set(kind, t);
  }
  return t;
}

const SCALE: Record<Kind, number> = { shingle: 0.42, thatch: 0.32, plaster: 0.22, wood: 0.45, grass: 0.16, sand: 0.22, stone: 0.4, cliff: 0.12, plain: 1 };

/** Triplanar world-space detail multiplied into the diffuse colour. Roofs skip the top projection so rows stay level. */
function addTriplanar(mat: THREE.MeshToonMaterial, kind: Kind) {
  const tex = detail(kind);
  const skipTop = kind === "shingle" || kind === "thatch" ? 1 : 0;
  mat.onBeforeCompile = shader => {
    shader.uniforms.slDetail = { value: tex };
    shader.uniforms.slScale = { value: SCALE[kind] };
    shader.uniforms.slSkipTop = { value: skipTop };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSlPos;\nvarying vec3 vSlNrm;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvSlPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSlNrm = normalize(mat3(modelMatrix) * objectNormal);"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vSlPos;\nvarying vec3 vSlNrm;\nuniform sampler2D slDetail;\nuniform float slScale;\nuniform float slSkipTop;"
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          vec3 w = pow(abs(normalize(vSlNrm)), vec3(4.0));
          w.y *= (1.0 - slSkipTop);
          w /= max(1e-4, w.x + w.y + w.z);
          vec3 p = vSlPos * slScale;
          float d = texture2D(slDetail, p.zy).r * w.x + texture2D(slDetail, p.xz).r * w.y + texture2D(slDetail, p.xy).r * w.z;
          diffuseColor.rgb *= mix(1.0, d / 0.92, 0.85);
        }`
      );
  };
  mat.customProgramCacheKey = () => `sl-tri-${kind}`;
}

const NO_OUTLINE = { visible: false };

/** Convert one material to the illustrated look. Returns the new material. */
export function toonify(src: THREE.Material, opts: { outline?: boolean; vertexColors?: boolean } = {}): THREE.Material {
  const s = src as THREE.MeshStandardMaterial;
  if (!(s as THREE.MeshStandardMaterial).isMeshStandardMaterial) return src;
  const toon = new THREE.MeshToonMaterial({
    name: s.name,
    color: s.color.clone().multiplyScalar(s.map ? 1.12 : 1.06),
    map: s.map ?? null,
    gradientMap: s.map ? foliageRamp() : toonRamp(),
    emissive: s.emissive?.clone() ?? new THREE.Color(0),
    emissiveIntensity: s.emissiveIntensity ?? 0,
    emissiveMap: s.emissiveMap ?? null,
    alphaTest: s.alphaTest || (s.map && s.transparent ? 0.5 : 0),
    transparent: false,
    side: s.side,
    // Quaternius foliage stores wind weights in COLOR_0; multiplying them in turns leaves mauve
    vertexColors: s.map ? false : (opts.vertexColors ?? s.vertexColors),
  });
  const kind = kindFor(s.name);
  const isFoliage = Boolean(s.map) || s.alphaTest > 0;
  if (!isFoliage && kind !== "plain") addTriplanar(toon, kind);
  if (isFoliage || opts.outline === false) toon.userData.outlineParameters = NO_OUTLINE;
  else toon.userData.outlineParameters = { thickness: kind === "grass" || kind === "cliff" || kind === "sand" ? 0 : 0.0042, color: [0.16, 0.1, 0.07], alpha: 1, visible: kind !== "grass" && kind !== "sand" && kind !== "cliff" };
  if (s.emissiveIntensity > 0.5) toon.userData.outlineParameters = { thickness: 0.0042, color: [0.16, 0.1, 0.07], alpha: 1, visible: true };
  s.dispose();
  return toon;
}

export function stylizeObject(root: THREE.Object3D, opts: { outline?: boolean } = {}) {
  const done = new Map<string, THREE.Material>();
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const vc = Boolean(m.geometry?.attributes?.color);
    const convert = (mat: THREE.Material) => {
      const key = (vc ? "vc:" : "") + mat.uuid;
      let out = done.get(key);
      if (!out) {
        out = toonify(mat.clone(), { ...opts, vertexColors: vc });
        done.set(key, out);
      }
      return out;
    };
    m.material = Array.isArray(m.material) ? m.material.map(convert) : convert(m.material);
  });
}

export function noOutline(mat: THREE.Material) {
  mat.userData.outlineParameters = NO_OUTLINE;
}
