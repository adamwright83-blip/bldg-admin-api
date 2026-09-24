import * as THREE from "three";

/**
 * Trailblazer's surface detail, drawn per pixel from the bind-pose position so
 * seams stay clean at any distance and the detail rides the skinning exactly.
 *
 * The garment mesh carries a surface id in its vertex colour's alpha (see
 * build_trailblazer.py): linen top, olive denim, leather, boots, knit socks,
 * the bracer, brass, the bandana, hair. Each surface gets its own fine normal
 * (weave, twill, grain, ribbing), roughness and metalness, and the top gets the
 * v2 sheet's construction: olive side panels, a leather-bound V with brass
 * eyelets, a stitched hem. Nothing here changes the cut or the coverage: that
 * is the geometry.
 *
 * Every Trailblazer material also gets a rim: a cool sky rim that keeps her
 * silhouette off dark stone, and a warm one when she stands against the sun.
 */
export type HeroLight = { sunView: { value: THREE.Vector3 }; sunVis: { value: number } };

const COMMON = /* glsl */ `
varying vec3 vBind;
float tbHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float tbNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(tbHash(i), tbHash(i + vec3(1,0,0)), f.x), mix(tbHash(i + vec3(0,1,0)), tbHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(tbHash(i + vec3(0,0,1)), tbHash(i + vec3(1,0,1)), f.x), mix(tbHash(i + vec3(0,1,1)), tbHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
// 1 inside a line of half-width w around d == 0, antialiased by the pixel footprint
float tbLine(float d, float w) { float aa = max(fwidth(d), 1e-5); return 1.0 - smoothstep(w - aa, w + aa, abs(d)); }
float tbDash(float t, float period) { return step(0.42, fract(t / period)); }
vec3 tbPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
  vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
  vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
  vec3 vN = surf_norm;
  vec3 R1 = cross(vSigmaY, vN);
  vec3 R2 = cross(vN, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

const GARMENT_COLOR = /* glsl */ `
  vec3 p = vBind;
  int sid = int(floor(vColor.a * 16.0 + 0.5));
  float foot = length(fwidth(p));           // metres per pixel here
  float fine = clamp(1.0 - foot * 900.0, 0.0, 1.0);   // fade detail finer than a pixel
  float tbH = 0.0;                             // bump height, metres-ish (scaled below)
  tbRough = 0.82;
  tbMetal = 0.0;
  vec3 c = vColor.rgb;
  // Trim each cut piece to its designed outline. The pieces were cut from the body along whole
  // faces, so their edges are stair-stepped; these are the same lines build_trailblazer.py cuts on
  // (hem, armholes, the laced V, the shoulder straps, the crossbody band), drawn exactly.
  if (sid == 1) {
    float tx = abs(p.x);
    if (p.y < 1.165 || (tx > 0.145 && p.y > 1.33) || (p.z > 0.03 && p.y > 1.30 && tx < (p.y - 1.30) * 0.55)
        || (p.y > 1.435 && (tx < 0.055 || tx > 0.125))) discard;
  }
  if (sid == 2) {
    // the frayed hem: an uneven fringe cut per pixel, loose threads hanging a little below it
    float hem = 0.80 + 0.028 * tbNoise(vec3(p.x * 70.0, 0.0, p.z * 70.0)) + 0.012 * tbNoise(vec3(p.x * 260.0, 3.0, p.z * 260.0));
    float thread = step(0.8, tbNoise(vec3(p.x * 900.0, 7.0, p.z * 900.0))) * step(hem - 0.018, p.y);
    if ((p.y < hem && thread < 0.5) || p.y > 1.035) discard;
    c = mix(c, vec3(0.34, 0.33, 0.2), (1.0 - smoothstep(hem, hem + 0.02, p.y)) * 0.55);
  }
  if (sid == 11) {
    float sd = dot(p - vec3(-0.095, 1.47, 0.0), normalize(vec3(0.505, 0.27, 0.0)));
    if (abs(sd) > 0.0232) discard;
    float g = tbNoise(p * 700.0);
    c = vec3(0.2, 0.1, 0.045) * (0.84 + 0.24 * g * fine);
    // darker burnished edges and a line of stitching down each side
    c *= 1.0 - 0.35 * smoothstep(0.018, 0.023, abs(sd));
    c = mix(c, vec3(0.5, 0.38, 0.2), tbLine(abs(sd) - 0.0165, 0.0006) * tbDash(p.y + p.x, 0.005));
    tbH += g * 0.00035 * fine;
    tbRough = 0.66;
    sid = 0;
  }
  if (sid == 1) {
    // linen top: olive side panels below the armholes, a leather-bound V with brass eyelets, stitched hem
    float ax = abs(p.x);
    // side panels: the flanks only (not the front of the bust), under the arms, as on the v2 sheet
    float flank = 1.0 - smoothstep(0.035, 0.05, p.z);
    float panel = smoothstep(0.112, 0.116, ax) * (1.0 - smoothstep(1.355, 1.37, p.y)) * flank;
    c = mix(c, vec3(0.105, 0.11, 0.055), panel);
    c *= 1.0 - 0.4 * tbLine(ax - 0.114, 0.0011) * (1.0 - smoothstep(1.355, 1.37, p.y)) * flank;
    if (p.z > 0.02 && p.y > 1.30) {
      float e = ax - (p.y - 1.30) * 0.55;
      float bind = 1.0 - smoothstep(0.0105, 0.0125, e);
      c = mix(c, vec3(0.085, 0.045, 0.022), bind);
      float r = length(vec2(e - 0.0055, mod(p.y - 1.305, 0.028) - 0.014));
      float eye = tbLine(r - 0.0032, 0.0011);
      c = mix(c, vec3(0.62, 0.44, 0.16), eye);
      tbMetal = eye * 0.8;
      tbH += bind * 0.0006;
    }
    // leather straps over the shoulder tops (antialiased edges)
    float strap = smoothstep(1.403, 1.407, p.y) * (1.0 - smoothstep(0.034, 0.036, abs(ax - 0.09)));
    c = mix(c, vec3(0.16, 0.08, 0.035), strap);
    tbRough = mix(0.93, 0.66, strap);
    // hem: a turned band and a running stitch
    float hem = 1.0 - smoothstep(1.183, 1.186, p.y);
    c *= 1.0 - 0.12 * hem;
    c = mix(c, vec3(0.30, 0.25, 0.17), tbLine(p.y - 1.1875, 0.0007) * tbDash(p.x + p.z, 0.006));
    // wear: grime toward the hem and under the arms, sun-faded shoulders
    float n = tbNoise(p * 38.0);
    c *= 0.86 + 0.16 * smoothstep(1.17, 1.32, p.y) - 0.08 * n;
    tbH += (sin(p.x * 1400.0) * sin(p.y * 1400.0) * 0.5 + 0.5) * 0.00018 * fine * (1.0 - strap) + n * 0.0003;
  } else if (sid == 2) {
    // olive denim: 2/1 twill, lighter worn highs, flat-felled side seams, fly and back-pocket stitching
    float tw = sin((p.x * 0.8 + p.y) * 1500.0 + (p.z) * 700.0);
    c *= 0.92 + 0.1 * tw * fine;
    float n = tbNoise(p * 60.0);
    c = mix(c, c * 1.55 + vec3(0.02), smoothstep(0.62, 0.9, n) * 0.35);
    vec3 thread = vec3(0.55, 0.43, 0.22);
    float seamSide = (tbLine(p.z - 0.004, 0.0007) + tbLine(p.z + 0.002, 0.0007)) * step(0.08, abs(p.x));
    float fly = tbLine(p.x - 0.022, 0.0007) * step(0.02, p.z) * step(0.915, p.y);
    float pocket = 0.0;
    if (p.z < -0.02 && p.y > 0.905 && p.y < 1.005) {
      float px = abs(p.x);
      pocket = (tbLine(px - 0.035, 0.0007) + tbLine(px - 0.125, 0.0007)) * step(0.91, p.y) * step(p.y, 0.995)
             + tbLine(p.y - 0.91, 0.0007) * step(0.035, px) * step(px, 0.125);
    }
    c = mix(c, thread, clamp(seamSide + fly + pocket, 0.0, 1.0) * tbDash(p.y + p.x, 0.005));
    // waistband: darker, heavier
    c *= 1.0 - 0.15 * smoothstep(1.005, 1.012, p.y);
    tbH += tw * 0.0002 * fine + (seamSide + fly + pocket) * 0.0003;
    tbRough = 0.86;
  } else if (sid == 3 || sid == 10 || sid == 6) {
    // leather: pebbled grain, darker creases, a waxed sheen; the belt gets edge stitching
    float g = tbNoise(p * 700.0);
    float cr = tbNoise(p * 90.0);
    c *= 0.82 + 0.26 * g * fine - 0.12 * smoothstep(0.55, 0.8, cr);
    if (sid == 3 && p.y > 0.955 && p.y < 1.03) {
      float st = tbLine(p.y - 0.9665, 0.0006) + tbLine(p.y - 1.0175, 0.0006);
      c = mix(c, vec3(0.52, 0.4, 0.22), st * tbDash(p.x + p.z, 0.005));
    }
    tbH += g * 0.00035 * fine + cr * 0.0004;
    tbRough = sid == 6 ? 0.6 : 0.64;
  } else if (sid == 4) {
    // boots: grained leather with ankle creases, scuffed toes, a dark welt
    float g = tbNoise(p * 650.0);
    float crease = sin(p.y * 160.0) * (1.0 - smoothstep(0.12, 0.24, abs(p.y - 0.13)));
    c *= 0.84 + 0.22 * g * fine;
    // a darker, rounder toe box: the boot is cut from the foot, so keep the toes from reading as toes
    c *= 1.0 - 0.28 * smoothstep(0.08, 0.14, p.z) * (1.0 - smoothstep(0.03, 0.1, p.y));
    c *= 1.0 - 0.5 * (1.0 - smoothstep(0.03, 0.036, p.y));
    tbH += g * 0.0003 * fine + crease * 0.0006;
    tbRough = 0.58;
  } else if (sid == 5) {
    // folded knit socks: ribbing
    float rib = sin(atan(p.z, abs(p.x) - 0.1) * 30.0);
    c *= 0.9 + 0.12 * rib * fine;
    tbH += rib * 0.0004 * fine;
    tbRough = 0.95;
  } else if (sid == 7) {
    c = vec3(0.78, 0.55, 0.22);
    tbMetal = 0.9;
    tbRough = 0.32;
  } else if (sid == 8) {
    // the bandana: a worn madder red with a small gold-and-black paisley scatter
    float d = tbNoise(p * 160.0);
    c = mix(c, vec3(0.62, 0.42, 0.12), smoothstep(0.78, 0.82, d) * fine);
    c = mix(c, vec3(0.05, 0.02, 0.02), smoothstep(0.1, 0.06, d) * fine);
    tbRough = 0.85;
  } else if (sid == 9) {
    tbRough = 0.45;
  }
  diffuseColor.rgb = c;
  diffuseColor.a = 1.0;
  tbBump = tbH;
`;

function rimChunk(extra = "") {
  return /* glsl */ `
  {
    vec3 V = normalize(vViewPosition);
    float ndv = clamp(dot(normal, V), 0.0, 1.0);
    float rim = pow(1.0 - ndv, 3.2);
    // cool sky rim always; warm sun rim when she is between the camera and the sun
    float back = clamp(-uSunView.z, 0.0, 1.0);
    reflectedLight.indirectDiffuse += vec3(0.42, 0.5, 0.62) * rim * 0.22 * diffuseColor.rgb * 2.0;
    reflectedLight.directDiffuse += vec3(1.0, 0.66, 0.38) * pow(1.0 - ndv, 4.0) * back * uDynSunVis * 0.9;
    ${extra}
  }`;
}

/** Garments: surface ids -> colour construction, fine normals, roughness and metalness. */
export function patchGarments(mat: THREE.MeshStandardMaterial, light: HeroLight) {
  mat.vertexColors = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uSunView = light.sunView;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vBind;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvBind = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}\nuniform vec3 uSunView;\nfloat tbRough; float tbMetal; float tbBump;`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${GARMENT_COLOR}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = tbRough;`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\nmetalnessFactor = tbMetal;`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\nnormal = tbPerturb(-vViewPosition, normal, vec2(dFdx(tbBump), dFdy(tbBump)) * 60.0, faceDirection);`
      )
      .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>\n${rimChunk()}`);
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|tb-garment`;
}

const SKIN = /* glsl */ `
  {
    vec3 p = vBind;
    // inside the boots: never seen, so never drawn (nothing can poke through the leather)
    if (p.y < 0.39) discard;
    float foot = length(fwidth(p));
    float fine = clamp(1.0 - foot * 1200.0, 0.0, 1.0);
    // uneven living tone: a low mottle, warmer blood at the joints, cheeks and hands
    float mottle = tbNoise(p * 16.0) * 0.6 + tbNoise(p * 45.0) * 0.4;
    float ax = abs(p.x);
    float warm = 0.0;
    warm += 1.0 - smoothstep(0.0, 0.06, abs(p.y - 0.5));                      // knees
    warm += (1.0 - smoothstep(0.0, 0.05, abs(p.y - 1.08))) * step(0.22, ax);   // elbows
    warm += (1.0 - smoothstep(0.86, 0.96, p.y)) * step(0.28, ax);              // hands
    warm += (1.0 - smoothstep(0.0, 0.03, abs(p.y - 1.575))) * step(0.035, ax) * step(ax, 0.07) * step(0.04, p.z); // cheeks
    diffuseColor.rgb *= 0.95 + 0.1 * mottle;
    // under the top's outline the skin wears the linen, so a gap in the cut reads as cloth, not a hole
    float under = step(1.17, p.y) * step(p.y, 1.43) * step(ax, 0.135)
                * (1.0 - step(0.03, p.z) * step(1.30, p.y) * step(ax, (p.y - 1.30) * 0.55));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.45, 0.29) * (0.9 + 0.1 * mottle), under);
    // the same for the boots, socks and shorts: skin that pokes through a garment wears it
    if (p.y < 0.45) diffuseColor.rgb = vec3(0.1, 0.105, 0.05);
    else if (p.y > 0.86 && p.y < 1.03 && ax < 0.2) diffuseColor.rgb = vec3(0.1, 0.11, 0.055);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.06, 0.86, 0.8), clamp(warm, 0.0, 1.0) * 0.4);
    tbBump = (tbNoise(p * 1100.0) - 0.5) * 0.00012 * fine;
  }
`;

/** Skin: less plastic. Rougher, a softer sheen, uneven tone, pores, and light scattered through at the terminator. */
export function patchSkin(mat: THREE.MeshStandardMaterial, light: HeroLight) {
  mat.roughness = 0.74;
  mat.envMapIntensity = 0.3;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uSunView = light.sunView;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vBind;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvBind = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON}\nuniform vec3 uSunView;\nfloat tbBump;`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${SKIN}`)
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>\nnormal = tbPerturb(-vViewPosition, normal, vec2(dFdx(tbBump), dFdy(tbBump)) * 60.0, faceDirection);`
      )
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>\n${rimChunk(`
          // light through the skin: the lit side wraps a little past the terminator, reddened
          float ndl = dot(normal, normalize(uSunView));
          float wrapped = clamp((ndl + 0.45) / 1.45, 0.0, 1.0) - clamp(ndl, 0.0, 1.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.34, 0.22) * wrapped * 1.4 * uDynSunVis;
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.5, 0.2, 0.13) * 0.12;`
        )}`
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|tb-skin`;
}

/** Hair and tattoo: the same rim. */
export function patchHeroRim(mat: THREE.MeshStandardMaterial, light: HeroLight, skin = false) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uSunView = light.sunView;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform vec3 uSunView;`)
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>\n${rimChunk(
          skin ? "reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.55, 0.22, 0.14) * 0.16; reflectedLight.directDiffuse *= vec3(1.02, 0.98, 0.95);" : ""
        )}`
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|tb-rim${skin ? "-skin" : ""}`;
}
