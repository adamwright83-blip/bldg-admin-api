import * as THREE from "three";
import { fogUniformsRef } from "./env";

/**
 * Sea: one large plane, no vertex waves (phones pay per vertex and per pass).
 * Everything that sells "live water" happens per pixel:
 *
 * - three scrolls of a generated ripple normal map at different scales;
 * - Fresnel mix between the water body and the sky reflected in the normal;
 * - a sun glitter path (tight + broad lobes) toward the low sunset sun;
 * - shallows, foam and a turquoise tint from the baked shore mask;
 * - the same height/sun fog as the level, so the horizon melts into the sky.
 */
export type WaterOptions = {
  normalMap: THREE.Texture;
  sky: THREE.Texture;
  skyVBottom: number;
  shore: THREE.Texture;
  /** three-space xz rect of the shore mask: [x0, zBlenderY0, size] */
  shoreRect: [number, number, number];
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
};

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWorld;
void main() {
  vec3 transformed = position;
  vec4 wp = modelMatrix * vec4( transformed, 1.0 );
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uNormal;
uniform sampler2D uSky;
uniform sampler2D uShore;
uniform vec3 uShoreRect;
uniform float uSkyVBottom;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vWorld;

vec3 skyAt( vec3 d ) {
  d.y = max( d.y, 0.012 );
  d = normalize( d );
  float u = atan( d.z, d.x ) * RECIPROCAL_PI2 + 0.5;
  float v = asin( clamp( d.y, -1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
  v = ( v - uSkyVBottom ) / ( 1.0 - uSkyVBottom );
  return texture2D( uSky, vec2( u, v ) ).rgb;
}

vec3 ripple( vec2 uv ) {
  vec3 n = texture2D( uNormal, uv ).xyz * 2.0 - 1.0;
  return vec3( n.x, n.z, n.y ); // tangent (x, y, up) -> world (x, up, z)
}

void main() {
  vec2 p = vWorld.xz;
  float dist = length( cameraPosition - vWorld );
  vec3 n = ripple( p * 0.041 + vec2( uTime * 0.011, uTime * 0.007 ) ) * 0.55
         + ripple( p * 0.113 + vec2( -uTime * 0.018, uTime * 0.014 ) ) * 0.35
         + ripple( p * 0.0071 + vec2( uTime * 0.0036, -uTime * 0.0021 ) ) * 0.7;
  // flatten toward the horizon: detail there only aliases
  float far = smoothstep( 40.0, 900.0, dist );
  n.y *= mix( 2.1, 7.0, far );
  n = normalize( n );

  vec3 V = normalize( cameraPosition - vWorld );
  vec3 R = reflect( -V, n );
  float fres = 0.02 + 0.98 * pow( 1.0 - max( dot( n, V ), 0.0 ), 5.0 );

  vec2 suv = vec2( ( p.x - uShoreRect.x ) / uShoreRect.z, ( -p.y - uShoreRect.y ) / uShoreRect.z );
  float inRect = step( 0.0, suv.x ) * step( suv.x, 1.0 ) * step( 0.0, suv.y ) * step( suv.y, 1.0 );
  vec2 shoreTex = texture2D( uShore, clamp( suv, 0.0, 1.0 ) ).rg * inRect;
  float shallow = shoreTex.r;

  vec3 deep = vec3( 0.015, 0.06, 0.085 );
  vec3 teal = vec3( 0.05, 0.25, 0.26 );
  vec3 body = mix( deep, teal, shallow * 0.85 );
  // light carried through wave backs toward the sun
  float back = pow( max( dot( -V, uSunDir ), 0.0 ), 4.0 ) * ( 0.25 + 0.75 * max( n.x * uSunDir.x + n.z * uSunDir.z, 0.0 ) );
  body += uSunColor * back * 0.12;

  vec3 refl = skyAt( R ) * 0.62;
  vec3 col = mix( body, refl, fres );

  float sd = max( dot( R, uSunDir ), 0.0 );
  col += uSunColor * ( pow( sd, 1400.0 ) * 26.0 + pow( sd, 160.0 ) * 1.6 + pow( sd, 18.0 ) * 0.07 );

  // foam: broken bands along the waterline
  float foamNoise = texture2D( uNormal, p * 0.19 + vec2( uTime * 0.03, 0.0 ) ).r;
  float band = smoothstep( 0.72, 0.98, shallow + 0.18 * sin( uTime * 1.3 + shallow * 26.0 ) );
  float foam = band * smoothstep( 0.35, 0.75, foamNoise ) * ( 1.0 - shoreTex.g );
  col = mix( col, vec3( 0.92, 0.9, 0.84 ) * ( 0.55 + 0.45 * uSunColor.r ), foam * 0.7 );

  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createWater(opts: WaterOptions) {
  for (const t of [opts.normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
  Object.assign(uniforms, fogUniformsRef(), {
    uNormal: { value: opts.normalMap },
    uSky: { value: opts.sky },
    uShore: { value: opts.shore },
    uShoreRect: { value: new THREE.Vector3(...opts.shoreRect) },
    uSkyVBottom: { value: opts.skyVBottom },
    uTime: { value: 0 },
    uSunDir: { value: opts.sunDir },
    uSunColor: { value: opts.sunColor },
  });
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, fog: true });
  const geometry = new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return {
    mesh,
    update(time: number, cameraPos: THREE.Vector3) {
      uniforms.uTime.value = time;
      mesh.position.set(Math.round(cameraPos.x / 50) * 50, 0, Math.round(cameraPos.z / 50) * 50);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
