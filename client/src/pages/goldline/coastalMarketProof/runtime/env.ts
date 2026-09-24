import * as THREE from "three";

/**
 * One authored late-day light. The sun sits low over the sea (level.json
 * `sunDirection`); fog is warm toward the sun and cool away from it, and
 * thickens near the water so the stacks fade in layers.
 */
export const PALETTE = {
  sun: new THREE.Color("#ffb46b"),
  skyZenith: new THREE.Color("#5f7fa6"),
  skyHorizon: new THREE.Color("#f2b98a"),
  skySunGlow: new THREE.Color("#ffd29a"),
  fogAway: new THREE.Color("#8796ab"),
  fogSun: new THREE.Color("#eab27c"),
  hemiSky: new THREE.Color("#a9bcd6"),
  hemiGround: new THREE.Color("#8a6547"),
};

export type SkyInfo = {
  texture: THREE.Texture;
  vBottom: number;
  horizonSun: [number, number, number];
  horizonAway: [number, number, number];
  zenith: [number, number, number];
};

export function fogUniformsRef() {
  return fogUniforms;
}

export type Env = {
  sunLight: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  sunDir: THREE.Vector3;
  fogUniforms: { fogSunDir: { value: THREE.Vector3 }; fogSunColor: { value: THREE.Color }; fogHeightFalloff: { value: number } };
  followShadow(target: THREE.Vector3): void;
  dispose(): void;
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // on the far plane
}`;

const SKY_FRAG = /* glsl */ `
#include <common>
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec3 uGlow;
uniform sampler2D uSky;
uniform float uSkyVBottom;
uniform vec3 uHaze;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 dd = normalize(vec3(d.x, max(d.y, 0.0), d.z));
  float u = atan(dd.z, dd.x) * RECIPROCAL_PI2 + 0.5;
  float v = asin(clamp(dd.y, -1.0, 1.0)) * RECIPROCAL_PI + 0.5;
  v = (v - uSkyVBottom) / (1.0 - uSkyVBottom);
  vec3 col = texture2D(uSky, vec2(u, v)).rgb * 0.72;
  col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 1.28); // a richer sunset
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlow * pow(sd, 10.0) * 0.55;
  col += uSun * (smoothstep(0.99965, 0.99985, sd) * 9.0 + pow(sd, 380.0) * 1.2);
  // sea haze at and below the horizon
  col = mix(col, uHaze, smoothstep(0.06, -0.02, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Height- and sun-aware fog, injected into every built-in material once. */
let fogPatched = false;
const fogUniforms = {
  fogSunDir: { value: new THREE.Vector3(0, 0, 1) },
  fogSunColor: { value: PALETTE.fogSun.clone() },
  fogHeightFalloff: { value: 0.018 },
};

function patchFogChunks() {
  if (fogPatched) return;
  fogPatched = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogWP = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogWP = instanceMatrix * fogWP;
  #endif
  vFogWorldPos = ( modelMatrix * fogWP ).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  uniform float fogHeightFalloff;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  vec3 fogView = normalize( vFogWorldPos - cameraPosition );
  float sunAmt = pow( max( dot( fogView, fogSunDir ), 0.0 ), 5.0 );
  vec3 fogCol = mix( fogColor, fogSunColor, sunAmt );
  #ifdef FOG_EXP2
    // denser near sea level, thinning with height
    float hAvg = max( 0.0, 0.5 * ( vFogWorldPos.y + cameraPosition.y ) );
    float dens = fogDensity * exp( - hAvg * fogHeightFalloff );
    float fogFactor = 1.0 - exp( - dens * dens * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;
}

// sky.json colours are display (sRGB) values sampled from sky.webp
const srgb = (c: [number, number, number]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

export function createEnv(scene: THREE.Scene, sunDirArr: [number, number, number], skyInfo: SkyInfo): Env {
  patchFogChunks();
  const sunDir = new THREE.Vector3(...sunDirArr).normalize();
  fogUniforms.fogSunDir.value.copy(sunDir);
  // haze: the sky's own horizon colours, a little deeper so distance reads as layers
  const away = srgb(skyInfo.horizonAway).multiplyScalar(0.62).lerp(new THREE.Color("#5f7189"), 0.35);
  const toward = srgb(skyInfo.horizonSun).multiplyScalar(0.75).lerp(PALETTE.sun, 0.5);
  fogUniforms.fogSunColor.value.copy(toward);

  scene.fog = new THREE.FogExp2(away.getHex(), 0.0027);

  const hemi = new THREE.HemisphereLight(srgb(skyInfo.zenith).lerp(PALETTE.hemiSky, 0.4), PALETTE.hemiGround, 1.25);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight(PALETTE.sun, 3.1);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024);
  const sc = sunLight.shadow.camera;
  sc.left = -9;
  sc.right = 9;
  sc.top = 9;
  sc.bottom = -9;
  sc.near = 1;
  sc.far = 90;
  sunLight.shadow.bias = -0.0006;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const skyMat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uSunDir: { value: sunDir },
      uGlow: { value: new THREE.Color(1.0, 0.55, 0.22) },
      uSun: { value: new THREE.Color(1.0, 0.86, 0.62) },
      uSky: { value: skyInfo.texture },
      uSkyVBottom: { value: skyInfo.vBottom },
      uHaze: { value: away.clone().lerp(toward, 0.25) },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  return {
    sunLight,
    hemi,
    sky,
    sunDir,
    fogUniforms,
    followShadow(target: THREE.Vector3) {
      // tight frustum on the player; snap to texels to stop shimmer
      const texel = 18 / 1024;
      const tx = Math.round(target.x / texel) * texel;
      const tz = Math.round(target.z / texel) * texel;
      sunLight.target.position.set(tx, target.y, tz);
      sunLight.position.set(tx + sunDir.x * 40, target.y + sunDir.y * 40 + 6, tz + sunDir.z * 40);
      sky.position.set(target.x, 0, target.z);
    },
    dispose() {
      sky.geometry.dispose();
      skyMat.dispose();
      sunLight.shadow.map?.dispose();
    },
  };
}

/** Hook the extra fog uniforms onto a material that uses scene fog. */
export function withSunFog<T extends THREE.Material>(material: T): T {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, fogUniforms);
  };
  return material;
}
