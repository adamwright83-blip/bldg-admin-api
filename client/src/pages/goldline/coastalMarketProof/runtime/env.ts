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
  hemiGround: new THREE.Color("#6b5241"),
};

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
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  float t = pow(max(h, 0.0), 0.45);
  vec3 col = mix(uHorizon, uZenith, t);
  float sd = max(dot(d, uSunDir), 0.0);
  col = mix(col, uGlow, pow(sd, 6.0) * 0.75 * (1.0 - t * 0.6));
  col += uSun * (pow(sd, 900.0) * 6.0 + pow(sd, 90.0) * 0.5);
  // below the horizon: sea haze colour
  col = mix(col, uHorizon * 0.85, smoothstep(0.02, -0.12, d.y));
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

export function createEnv(scene: THREE.Scene, sunDirArr: [number, number, number]): Env {
  patchFogChunks();
  const sunDir = new THREE.Vector3(...sunDirArr).normalize();
  fogUniforms.fogSunDir.value.copy(sunDir);

  scene.fog = new THREE.FogExp2(PALETTE.fogAway.getHex(), 0.0021);

  const hemi = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.05);
  scene.add(hemi);

  const sunLight = new THREE.DirectionalLight(PALETTE.sun, 2.6);
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
      uZenith: { value: PALETTE.skyZenith },
      uHorizon: { value: PALETTE.skyHorizon },
      uGlow: { value: PALETTE.skySunGlow },
      uSun: { value: new THREE.Color(1.0, 0.85, 0.6) },
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
