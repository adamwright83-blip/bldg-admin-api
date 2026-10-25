/**
 * The 1965 brochure: Century Park East screen-printed in three inks on cream paper.
 *
 * Century City was master-planned in 1957 and sold through the early sixties as a self-contained city; its towers are
 * children of the mid-century print brochure. So cozy night is not lit, it is printed: the rendered frame is separated
 * into three ink plates (a warm ink, a cool ink, a dark ink), each plate is screened into halftone dots at its own
 * angle, the plates are laid over paper with a little misregistration, a thin ink line traces the edges, and the paper
 * has grain. Nothing here is a filter over a photograph; it is how a print shop would have reproduced this building.
 *
 * Zombie night prints the same plates in two cold inks with a coarser screen (see cpeCctv.ts for the monitors).
 */
import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

export type InkSet = {
  paper: string;
  /** warm ink (mustard), red ink (terracotta), cool ink (teal), dark ink (umber) */
  inks: [string, string, string, string];
  /** halftone cell in CSS pixels */
  cell: number;
  /** plate misregistration in CSS pixels */
  misregister: number;
  grain: number;
  line: number;
};

export const INK_SETS: Record<"cozy" | "zombie", InkSet> = {
  // the brochure: mustard, terracotta, teal and warm umber on cream
  cozy: { paper: "#f4e9d2", inks: ["#e8a93a", "#c8674e", "#2f8f8a", "#3a2a22"], cell: 3.6, misregister: 1.0, grain: 0.06, line: 0.7 },
  // the same plates after dark: a sick green, a dried red, ultramarine, ink black on grey newsprint, coarser screen
  zombie: { paper: "#c9cfc4", inks: ["#8fb36a", "#8a3a3a", "#2e3f8a", "#121a18"], cell: 5, misregister: 1.6, grain: 0.1, line: 0.65 },
};

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const fragment = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uRes;
  uniform float uDpr;
  uniform vec3 uPaper, uInkA, uInkR, uInkB, uInkC;
  uniform float uCell, uMisreg, uGrain, uLine, uTime, uStrength;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  /** the four plates: how much of each ink this colour needs. Light, neutral colour stays paper. */
  vec4 separate(vec3 c) {
    float L = luma(c);
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float sat = (mx - mn) / max(mx, 0.001);
    float warm = smoothstep(0.06, 0.4, c.r - c.b) * smoothstep(0.05, 0.3, c.g - c.b * 0.6);
    float red = smoothstep(0.1, 0.45, c.r - c.g) * smoothstep(0.0, 0.3, c.r - c.b);
    float cool = smoothstep(0.04, 0.35, max(c.b - c.r, (c.g - c.r) * 0.8));
    float light = smoothstep(0.62, 0.97, L);
    float dark = smoothstep(0.1, 0.9, 1.0 - L);
    float a = warm * (0.3 + 0.7 * sat) * (1.0 - light * 0.9);
    float r = red * (0.4 + 0.6 * sat) * (1.0 - light * 0.9);
    float b = cool * (0.35 + 0.65 * sat) * (1.0 - light * 0.85) + (1.0 - sat) * 0.18 * dark;
    float d = pow(dark, 1.6);
    // the dark plate carries the shadows; the colour plates thin out where it is heavy
    a *= 1.0 - d * 0.5;
    r *= 1.0 - d * 0.5;
    b *= 1.0 - d * 0.5;
    return clamp(vec4(a, r, b, d), 0.0, 1.0);
  }

  /** screen one plate: dots on a rotated grid, radius from density, anti-aliased */
  float screen(float density, vec2 px, float angle, float cell) {
    float s = sin(angle), c = cos(angle);
    vec2 r = vec2(px.x * c - px.y * s, px.x * s + px.y * c) / cell;
    vec2 f = fract(r) - 0.5;
    float d = length(f) * cell;
    float radius = sqrt(clamp(density, 0.0, 1.0)) * cell * 0.62;
    return 1.0 - smoothstep(radius - 0.75, radius + 0.75, d);
  }

  void main() {
    vec2 px = vUv * uRes;
    float cell = uCell * uDpr;
    float mis = uMisreg * uDpr / uRes.x;
    // each plate is sampled through its own slightly-off registration
    vec3 cA = texture2D(tDiffuse, vUv + vec2(mis, mis * 0.4)).rgb;
    vec3 cB = texture2D(tDiffuse, vUv + vec2(-mis * 0.6, -mis)).rgb;
    vec3 cC = texture2D(tDiffuse, vUv).rgb;
    vec3 cR = texture2D(tDiffuse, vUv + vec2(mis * 0.3, -mis * 0.8)).rgb;
    float dA = separate(cA).x, dR = separate(cR).y, dB = separate(cB).z, dC = separate(cC).w;
    float covA = screen(dA, px + vec2(0.3, 0.1) * cell, 0.262, cell);
    float covR = screen(dR, px + vec2(0.1, -0.3) * cell, 1.047, cell);
    float covB = screen(dB, px + vec2(-0.2, 0.4) * cell, 1.309, cell);
    float covC = screen(dC, px, 0.785, cell);

    // paper first, then each ink multiplies over it
    vec3 col = uPaper;
    col = mix(col, col * uInkA, covA * 0.96);
    col = mix(col, col * uInkR, covR * 0.96);
    col = mix(col, col * uInkB, covB * 0.96);
    col = mix(col, col * uInkC, covC * 0.94);

    // the line plate: a thin dark line where the picture changes sharply (sobel on luma)
    vec2 t = 1.0 / uRes;
    float l00 = luma(texture2D(tDiffuse, vUv + vec2(-t.x, -t.y)).rgb), l10 = luma(texture2D(tDiffuse, vUv + vec2(0.0, -t.y)).rgb), l20 = luma(texture2D(tDiffuse, vUv + vec2(t.x, -t.y)).rgb);
    float l01 = luma(texture2D(tDiffuse, vUv + vec2(-t.x, 0.0)).rgb), l21 = luma(texture2D(tDiffuse, vUv + vec2(t.x, 0.0)).rgb);
    float l02 = luma(texture2D(tDiffuse, vUv + vec2(-t.x, t.y)).rgb), l12 = luma(texture2D(tDiffuse, vUv + vec2(0.0, t.y)).rgb), l22 = luma(texture2D(tDiffuse, vUv + vec2(t.x, t.y)).rgb);
    float gx = -l00 - 2.0 * l01 - l02 + l20 + 2.0 * l21 + l22;
    float gy = -l00 - 2.0 * l10 - l20 + l02 + 2.0 * l12 + l22;
    float edge = smoothstep(0.18, 0.55, length(vec2(gx, gy)));
    col = mix(col, uInkC * 0.85, edge * uLine);

    // paper: fibre at low frequency, grain at pixel frequency, a soft vignette from the press
    float fibre = vnoise(px / (14.0 * uDpr)) * 0.5 + vnoise(px / (3.0 * uDpr)) * 0.5;
    col *= 1.0 - uGrain * (fibre - 0.5) * 1.6;
    col += (hash(px + fract(uTime) * 7.0) - 0.5) * uGrain * 0.5;
    vec2 d = vUv - 0.5;
    col *= 1.0 - dot(d, d) * 0.35;

    vec3 plain = texture2D(tDiffuse, vUv).rgb;
    gl_FragColor = vec4(mix(plain, col, uStrength), 1.0);
  }
`;

export type PrintPass = ShaderPass & { setInks(set: InkSet): void; setStrength(s: number): void; setSize(w: number, h: number): void; tick(t: number): void };

export function createPrintPass(dpr: number): PrintPass {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: dpr },
      uPaper: { value: new THREE.Color() },
      uInkA: { value: new THREE.Color() },
      uInkR: { value: new THREE.Color() },
      uInkB: { value: new THREE.Color() },
      uInkC: { value: new THREE.Color() },
      uCell: { value: 4.5 },
      uMisreg: { value: 1 },
      uGrain: { value: 0.07 },
      uLine: { value: 0.8 },
      uTime: { value: 0 },
      uStrength: { value: 1 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
  }) as PrintPass;
  // the inks are given in sRGB; the frame at this point is sRGB too (this pass runs after OutputPass)
  const srgb = (hex: string) => new THREE.Color(hex).convertLinearToSRGB();
  pass.setInks = set => {
    pass.uniforms.uPaper.value.copy(srgb(set.paper));
    pass.uniforms.uInkA.value.copy(srgb(set.inks[0]));
    pass.uniforms.uInkR.value.copy(srgb(set.inks[1]));
    pass.uniforms.uInkB.value.copy(srgb(set.inks[2]));
    pass.uniforms.uInkC.value.copy(srgb(set.inks[3]));
    pass.uniforms.uCell.value = set.cell;
    pass.uniforms.uMisreg.value = set.misregister;
    pass.uniforms.uGrain.value = set.grain;
    pass.uniforms.uLine.value = set.line;
  };
  pass.setStrength = s => {
    pass.uniforms.uStrength.value = s;
  };
  const baseSetSize = pass.setSize.bind(pass);
  pass.setSize = (w, h) => {
    baseSetSize(w, h);
    pass.uniforms.uRes.value.set(w, h);
  };
  pass.tick = t => {
    pass.uniforms.uTime.value = t;
  };
  pass.setInks(INK_SETS.cozy);
  return pass;
}
