import * as THREE from "three";

/**
 * The proof's camera back-end: one HDR scene target, a small bloom chain, and one
 * full-screen finishing pass (tone map, display grade, vignette, grain).
 *
 * Cost is kept phone-sized on purpose: the bloom works from half resolution down
 * through 1/16 with a 4-tap dual filter (8 small passes in all) and the finish is a
 * single pass. `?fx=0` skips all of it and renders straight to the canvas.
 *
 * Grading happens after tone mapping, in display space, so it behaves like a
 * colourist's grade: cool shadows, warm highlights, a gentle S-curve.
 */
const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const PREFILTER_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
vec3 tap(vec2 o) { return texture2D(tInput, vUv + o * uTexel).rgb; }
void main() {
  // 4-tap box (half resolution) then a soft-knee threshold on the brightest channel
  vec3 c = 0.25 * (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0)));
  c = min(c, vec3(24.0));
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.0);
}`;

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tInput, vUv).rgb * 4.0;
  c += texture2D(tInput, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(-1.0, 1.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(1.0, 1.0) * uTexel).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tInput;
uniform sampler2D tBase;
uniform vec2 uTexel;
uniform float uBlend;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.0);
  c += texture2D(tInput, vUv + vec2(-2.0, 0.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(2.0, 0.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(0.0, -2.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(0.0, 2.0) * uTexel).rgb;
  c += texture2D(tInput, vUv + vec2(-1.0, 1.0) * uTexel).rgb * 2.0;
  c += texture2D(tInput, vUv + vec2(1.0, 1.0) * uTexel).rgb * 2.0;
  c += texture2D(tInput, vUv + vec2(-1.0, -1.0) * uTexel).rgb * 2.0;
  c += texture2D(tInput, vUv + vec2(1.0, -1.0) * uTexel).rgb * 2.0;
  gl_FragColor = vec4(texture2D(tBase, vUv).rgb + c / 12.0 * uBlend, 1.0);
}`;

const FINISH_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uTime;
uniform float uVignette;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uShadowTint;
uniform vec3 uHighlightTint;
uniform float uLetterbox;
uniform vec2 uResolution;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 hdr = texture2D(tScene, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
  vec3 c = toneMapping(hdr);
  c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
  // display grade: split tone by luminance, then a soft S-curve and saturation
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(uShadowTint, uHighlightTint, smoothstep(0.08, 0.75, l));
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  // vignette, elliptical to the frame
  vec2 q = vUv - 0.5;
  q.x *= uResolution.x / uResolution.y;
  float r = length(q) / length(vec2(0.5 * uResolution.x / uResolution.y, 0.5));
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, r);
  // film grain + dither (breaks up gradient banding in the sky)
  float g = hash(vUv * uResolution + fract(uTime * 7.13) * 91.7) - 0.5;
  c += g * (0.018 * (1.0 - l) + 1.0 / 255.0);
  // cinematic bars (reveal only)
  float bar = step(vUv.y, uLetterbox) + step(1.0 - uLetterbox, vUv.y);
  c = mix(c, vec3(0.0), bar);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export type PostFxOptions = { msaa: number };

export class PostFX {
  readonly grade = {
    bloom: 0.22,
    vignette: 0.32,
    contrast: 0.22,
    saturation: 1.06,
    shadowTint: new THREE.Color(0.93, 0.99, 1.06),
    highlightTint: new THREE.Color(1.05, 1.0, 0.93),
    letterbox: 0,
  };
  private readonly renderer: THREE.WebGLRenderer;
  private readonly sceneRT: THREE.WebGLRenderTarget;
  private readonly chain: THREE.WebGLRenderTarget[] = [];
  private readonly ups: THREE.WebGLRenderTarget[] = [];
  private readonly quad: THREE.Mesh;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly prefilter: THREE.ShaderMaterial;
  private readonly down: THREE.ShaderMaterial;
  private readonly up: THREE.ShaderMaterial;
  private readonly finish: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();

  constructor(renderer: THREE.WebGLRenderer, opts: PostFxOptions) {
    this.renderer = renderer;
    const hdr = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.sceneRT = new THREE.WebGLRenderTarget(4, 4, { ...hdr, depthBuffer: true, samples: opts.msaa });
    for (let i = 0; i < 4; i++) this.chain.push(new THREE.WebGLRenderTarget(4, 4, hdr));
    for (let i = 0; i < 3; i++) this.ups.push(new THREE.WebGLRenderTarget(4, 4, hdr));
    const mk = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, toneMapped = false) =>
      new THREE.ShaderMaterial({ vertexShader: FULLSCREEN_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped });
    this.prefilter = mk(PREFILTER_FRAG, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.35 }, uKnee: { value: 0.5 } });
    this.down = mk(DOWN_FRAG, { tInput: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = mk(UP_FRAG, { tInput: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uBlend: { value: 1 } });
    this.finish = mk(
      FINISH_FRAG,
      {
        tScene: { value: this.sceneRT.texture },
        tBloom: { value: null },
        uBloom: { value: 0 },
        uTime: { value: 0 },
        uVignette: { value: 0 },
        uContrast: { value: 0 },
        uSaturation: { value: 1 },
        uShadowTint: { value: new THREE.Color() },
        uHighlightTint: { value: new THREE.Color() },
        uLetterbox: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      true
    );
    // a full-screen triangle
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo, this.finish);
    this.quad.frustumCulled = false;
  }

  setSize(width: number, height: number) {
    // width/height in device pixels
    this.size.set(width, height);
    this.sceneRT.setSize(width, height);
    let w = Math.max(1, Math.round(width / 2));
    let h = Math.max(1, Math.round(height / 2));
    for (let i = 0; i < this.chain.length; i++) {
      this.chain[i].setSize(w, h);
      if (i < this.ups.length) this.ups[i].setSize(w, h);
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
  }

  private pass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quad, this.cam);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, time: number) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    // bloom: prefilter to 1/2, dual-filter down to 1/16, back up to 1/2
    const src = this.sceneRT.texture;
    this.prefilter.uniforms.tInput.value = src;
    this.prefilter.uniforms.uTexel.value.set(1 / this.size.x, 1 / this.size.y);
    this.pass(this.prefilter, this.chain[0]);
    for (let i = 1; i < this.chain.length; i++) {
      const from = this.chain[i - 1];
      this.down.uniforms.tInput.value = from.texture;
      this.down.uniforms.uTexel.value.set(0.5 / from.width, 0.5 / from.height);
      this.pass(this.down, this.chain[i]);
    }
    let low = this.chain[this.chain.length - 1];
    for (let i = this.chain.length - 2; i >= 0; i--) {
      this.up.uniforms.tInput.value = low.texture;
      this.up.uniforms.tBase.value = this.chain[i].texture;
      this.up.uniforms.uTexel.value.set(0.5 / low.width, 0.5 / low.height);
      this.up.uniforms.uBlend.value = 0.9;
      this.pass(this.up, this.ups[i]);
      low = this.ups[i];
    }
    const u = this.finish.uniforms;
    u.tBloom.value = low.texture;
    u.uBloom.value = this.grade.bloom;
    u.uTime.value = time;
    u.uVignette.value = this.grade.vignette;
    u.uContrast.value = this.grade.contrast;
    u.uSaturation.value = this.grade.saturation;
    u.uShadowTint.value.copy(this.grade.shadowTint);
    u.uHighlightTint.value.copy(this.grade.highlightTint);
    u.uLetterbox.value = this.grade.letterbox;
    u.uResolution.value.copy(this.size);
    this.pass(this.finish, null);
  }

  dispose() {
    this.sceneRT.dispose();
    [...this.chain, ...this.ups].forEach(t => t.dispose());
    [this.prefilter, this.down, this.up, this.finish].forEach(m => m.dispose());
    this.quad.geometry.dispose();
  }
}
