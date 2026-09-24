import * as THREE from "three";
import { withSunFog } from "./env";

/**
 * Level materials. Lighting is split so it stays cheap on a phone:
 *
 * - the sun is one real-time directional light, and its contribution is
 *   multiplied by a *baked* sun visibility (lightmap G, or a per-vertex
 *   `_sunvis` on thin props), so buildings and cliffs cast long sunset
 *   shadows without a scene-wide shadow map;
 * - sky light is the hemisphere light, darkened by baked AO (lightmap R);
 * - the only real-time shadow map is the tight one around Trailblazer.
 *
 * Surfaces near the water are wet: darker, with a sun highlight.
 */
export type TextureSet = { albedo: THREE.Texture; normal: THREE.Texture };

type Spec = {
  tex?: string;
  tint: string;
  normalScale?: number;
  wet?: boolean;
  wind?: number;
};

// level material name -> look. Tints multiply the albedo texture (and the vertex shade).
const SPECS: Record<string, Spec> = {
  rock: { tex: "rock", tint: "#b3a595", normalScale: 1.0 },
  rock_dark: { tex: "rock", tint: "#7d7166" },
  cobble: { tex: "cobble", tint: "#c9b9a4", normalScale: 0.9, wet: true },
  step: { tex: "stone", tint: "#d3c4ae", normalScale: 0.8, wet: true },
  mortar: { tex: "stone", tint: "#c7b39a", normalScale: 0.7 },
  quay: { tex: "stone", tint: "#a99985", normalScale: 0.9, wet: true },
  plaster: { tex: "plaster", tint: "#f1e4cf", normalScale: 0.6 },
  plaster_warm: { tex: "plaster", tint: "#e2b98c", normalScale: 0.6 },
  wood: { tex: "wood", tint: "#b58e6a", normalScale: 0.8, wet: true },
  wood_dark: { tex: "wood_dark", tint: "#7a5a43", normalScale: 0.8, wet: true },
  roof: { tex: "roof", tint: "#d58a66", normalScale: 0.8 },
  sand: { tex: "sand", tint: "#c7b391" },
  far: { tex: "rock", tint: "#8f8579", normalScale: 0.5 },
  cloth_red: { tint: "#a8402f", wind: 1 },
  cloth_cream: { tint: "#e0d0b0", wind: 1 },
  cloth_blue: { tint: "#3f5f85", wind: 1 },
  rope: { tint: "#9c8462", wind: 1 },
  iron: { tint: "#3b3530" },
  foliage: { tint: "#56703a", wind: 1 },
  window: { tint: "#1c1511" },
};

export type SunVisSource = "lightmap" | "vertex" | "none";

export type MaterialContext = {
  textures: Map<string, TextureSet>;
  lightmaps: Map<string, THREE.Texture>;
  /** material name -> lightmap name */
  lightmapOf: Map<string, string>;
  windUniforms: { uTime: { value: number }; uWind: { value: THREE.Vector3 } };
};

const DIR_LIGHT_LINE = "getDirectionalLightInfo( directionalLight, directLight );";

function patchLevelShader(shader: THREE.WebGLProgramParametersWithUniforms, sunVis: SunVisSource, wet: boolean, wind: number, ctx: MaterialContext) {
  let vs = shader.vertexShader;
  let fs = shader.fragmentShader;
  const needWorld = wet;
  const vDecl: string[] = [];
  const fDecl: string[] = [];
  const vBody: string[] = [];
  if (sunVis === "vertex") {
    vDecl.push("attribute float _sunvis;", "varying float vSunVis;");
    fDecl.push("varying float vSunVis;");
    vBody.push("vSunVis = _sunvis;");
  }
  if (needWorld) {
    vDecl.push("varying float vWorldY;");
    fDecl.push("varying float vWorldY;");
  }
  if (wind > 0) {
    // one wind for the whole world: cloth, bunting, ropes and plants sway on the same gusts
    vDecl.push("attribute float _wind;", "uniform float uTime;", "uniform vec3 uWind;");
    Object.assign(shader.uniforms, ctx.windUniforms);
  }
  vs = vs.replace("#include <common>", `#include <common>\n${vDecl.join("\n")}`);
  let beginVertex = "#include <begin_vertex>";
  if (wind > 0) {
    beginVertex += `
    {
      vec4 wp = modelMatrix * vec4( transformed, 1.0 );
      float gust = 0.55 + 0.45 * sin( uTime * 0.7 + wp.x * 0.05 ) * sin( uTime * 0.23 + wp.z * 0.04 );
      float flutter = sin( uTime * 5.3 + wp.x * 1.7 + wp.y * 2.3 + wp.z * 1.3 ) + 0.5 * sin( uTime * 8.9 + wp.y * 3.1 );
      vec3 push = uWind * gust * ( 0.6 + 0.4 * flutter );
      transformed += push * _wind * ${wind.toFixed(2)};
      transformed.y -= abs( flutter ) * 0.03 * _wind * ${wind.toFixed(2)};
    }`;
  }
  vs = vs.replace("#include <begin_vertex>", beginVertex);
  vBody.push(...(needWorld ? ["vWorldY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;"] : []));
  vs = vs.replace("#include <fog_vertex>", `#include <fog_vertex>\n${vBody.join("\n")}`);

  fs = fs.replace("#include <common>", `#include <common>\n${fDecl.join("\n")}`);
  const sample = sunVis === "lightmap" ? "texture2D( aoMap, vAoMapUv ).g" : sunVis === "vertex" ? "vSunVis" : "1.0";
  const lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace(DIR_LIGHT_LINE, `${DIR_LIGHT_LINE}\n\t\tdirectLight.color *= bakedSunVis;`);
  fs = fs.replace("#include <lights_fragment_begin>", `float bakedSunVis = ${sample};\n${lightsBegin}`);
  if (wet) {
    // wet near the waterline: darker albedo, sharper sun highlight
    fs = fs.replace(
      "#include <color_fragment>",
      "#include <color_fragment>\nfloat wetness = smoothstep( 3.2, 1.4, vWorldY );\ndiffuseColor.rgb *= mix( 1.0, 0.7, wetness );"
    );
    fs = fs.replace("#include <specularmap_fragment>", "#include <specularmap_fragment>\nspecularStrength = mix( 0.06, 0.55, wetness );");
  }
  shader.vertexShader = vs;
  shader.fragmentShader = fs;
}

export function createLevelMaterial(name: string, ctx: MaterialContext, far: boolean, geometry: THREE.BufferGeometry): THREE.Material {
  if (name === "glow") {
    return withSunFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.68, 0.34).multiplyScalar(3.0) }));
  }
  const spec = SPECS[name] ?? { tint: "#bbbbbb" };
  const set = spec.tex ? ctx.textures.get(spec.tex) : undefined;
  const lightmapName = far ? undefined : ctx.lightmapOf.get(name);
  const lightmap = lightmapName ? ctx.lightmaps.get(lightmapName) : undefined;
  const sunVis: SunVisSource = lightmap ? "lightmap" : !far && geometry.getAttribute("_sunvis") ? "vertex" : "none";
  const wet = !!spec.wet && !far;
  const params = {
    color: new THREE.Color(spec.tint),
    map: set?.albedo ?? null,
    normalMap: set?.normal ?? null,
    normalScale: new THREE.Vector2(spec.normalScale ?? 0.8, spec.normalScale ?? 0.8),
    aoMap: lightmap ?? null,
    aoMapIntensity: 1,
    vertexColors: true,
    side: THREE.DoubleSide,
  };
  const mat = wet
    ? new THREE.MeshPhongMaterial({ ...params, shininess: 90, specular: new THREE.Color(0.5, 0.42, 0.33) })
    : new THREE.MeshLambertMaterial(params);
  if (far) {
    mat.normalMap = null;
  }
  withSunFog(mat);
  const wind = geometry.getAttribute("_wind") ? spec.wind ?? 0 : 0;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    patchLevelShader(shader, sunVis, wet, wind, ctx);
  };
  mat.customProgramCacheKey = () => `lvl-${sunVis}-${wet}-${wind}`;
  return mat;
}

/** Sun visibility for anything that moves: a uniform the character shaders multiply the sun by. */
export function patchDynamicSunVis(mat: THREE.Material, uniform: { value: number }) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uDynSunVis = uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uDynSunVis;")
      .replace(
        "#include <lights_fragment_begin>",
        THREE.ShaderChunk.lights_fragment_begin.replace(DIR_LIGHT_LINE, `${DIR_LIGHT_LINE}\n\t\tdirectLight.color *= uDynSunVis;`)
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey()}|dyn-sunvis`;
}
