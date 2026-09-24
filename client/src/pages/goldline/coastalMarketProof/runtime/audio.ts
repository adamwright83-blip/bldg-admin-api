import type * as THREE from "three";

/**
 * One simple environmental mix, synthesized (no audio files): ocean swell,
 * wind that grows with height, the gorge waterfall by distance, and footsteps
 * on stone or wood. It starts from the tap-to-begin gesture.
 */
function noiseBuffer(ctx: AudioContext, seconds: number, kind: "pink" | "brown" | "white"): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "white") d[i] = w;
    else if (kind === "brown") {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      b0 = 0.997 * b0 + w * 0.029591;
      b1 = 0.985 * b1 + w * 0.032534;
      b2 = 0.95 * b2 + w * 0.048056;
      d[i] = (b0 + b1 + b2 + w * 0.05) * 3;
    }
  }
  return buf;
}

export class ProofAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ocean: GainNode | null = null;
  private wind: GainNode | null = null;
  private fall: GainNode | null = null;
  private fallPan: StereoPannerNode | null = null;
  private white: AudioBuffer | null = null;
  private lastStep = 0;
  private analyser: AnalyserNode | null = null;
  steps = 0;
  started = false;

  /** Must be called from a user gesture. */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    void ctx.resume();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    const master = ctx.createGain();
    master.gain.value = 0;
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);
    master.connect(comp).connect(ctx.destination);
    this.master = master;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    comp.connect(this.analyser);
    this.white = noiseBuffer(ctx, 2, "white");

    const loop = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.start();
      return src;
    };
    // ocean: brown noise under a slow swell, plus a washing hiss
    const oceanGain = ctx.createGain();
    oceanGain.gain.value = 0.5;
    const swell = ctx.createGain();
    swell.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.35;
    lfo.connect(lfoAmt).connect(swell.gain);
    lfo.start();
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 420;
    loop(noiseBuffer(ctx, 6, "brown")).connect(low).connect(swell).connect(oceanGain);
    const hiss = ctx.createBiquadFilter();
    hiss.type = "bandpass";
    hiss.frequency.value = 1800;
    hiss.Q.value = 0.4;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.12;
    loop(noiseBuffer(ctx, 5, "pink")).connect(hiss).connect(hissGain).connect(swell);
    oceanGain.connect(master);
    this.ocean = oceanGain;

    // wind: pink noise through a wandering band-pass
    const windGain = ctx.createGain();
    windGain.gain.value = 0.2;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 650;
    band.Q.value = 0.8;
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.13;
    const wlfoAmt = ctx.createGain();
    wlfoAmt.gain.value = 260;
    wlfo.connect(wlfoAmt).connect(band.frequency);
    wlfo.start();
    loop(noiseBuffer(ctx, 7, "pink")).connect(band).connect(windGain).connect(master);
    this.wind = windGain;

    // waterfall: bright roar + low rumble, gain and pan by distance / bearing
    const fallGain = ctx.createGain();
    fallGain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const roar = ctx.createBiquadFilter();
    roar.type = "bandpass";
    roar.frequency.value = 1400;
    roar.Q.value = 0.5;
    const rumble = ctx.createBiquadFilter();
    rumble.type = "lowpass";
    rumble.frequency.value = 180;
    loop(noiseBuffer(ctx, 4, "white")).connect(roar).connect(fallGain);
    loop(noiseBuffer(ctx, 4, "brown")).connect(rumble).connect(fallGain);
    fallGain.connect(pan).connect(master);
    this.fall = fallGain;
    this.fallPan = pan;
    this.started = true;
  }

  /** Per frame: listener = camera; mix follows height, water proximity and the waterfall. */
  update(camera: THREE.Camera, playerY: number, waterfall: THREE.Vector3, nearWater: number) {
    const ctx = this.ctx;
    if (!ctx || !this.ocean || !this.wind || !this.fall || !this.fallPan) return;
    const t = ctx.currentTime;
    const height = Math.max(0, Math.min(1, playerY / 30));
    this.ocean.gain.setTargetAtTime(0.3 + 0.45 * nearWater, t, 0.8);
    this.wind.gain.setTargetAtTime(0.08 + 0.22 * height, t, 0.8);
    const cp = camera.position;
    const dx = waterfall.x - cp.x;
    const dz = waterfall.z - cp.z;
    const dist = Math.hypot(dx, dz);
    this.fall.gain.setTargetAtTime(Math.min(0.55, 9 / Math.max(6, dist)), t, 0.5);
    // bearing relative to the camera's view
    const e = camera.matrixWorld.elements;
    const rx = e[0], rz = e[2]; // camera right vector
    const side = (dx * rx + dz * rz) / Math.max(1, dist);
    this.fallPan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, side)), t, 0.3);
  }

  footstep(surface: "stone" | "wood", strength: number) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.white) return;
    const now = ctx.currentTime;
    if (now - this.lastStep < 0.12) return;
    this.lastStep = now;
    this.steps++;
    const g = ctx.createGain();
    const v = 0.1 + 0.2 * strength;
    g.gain.setValueAtTime(v, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + (surface === "wood" ? 0.16 : 0.09));
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = surface === "wood" ? 520 + Math.random() * 120 : 2200 + Math.random() * 600;
    f.Q.value = surface === "wood" ? 2.5 : 0.9;
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random() * 1.5, 0.2);
    // body of the step: a short knock
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(surface === "wood" ? 190 : 110, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(v * (surface === "wood" ? 0.9 : 0.5), now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(og).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** QA: context state and output RMS. */
  probe() {
    let rms = 0;
    if (this.analyser) {
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      rms = Math.sqrt(buf.reduce((a, b) => a + b * b, 0) / buf.length);
    }
    return { started: this.started, state: this.ctx?.state ?? "none", rms, steps: this.steps };
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
