import type * as THREE from "three";

/**
 * One simple environmental mix, synthesized (no audio files): ocean swell,
 * wind that grows with height, the gorge waterfall by distance, footsteps on
 * stone or wood, and the chase's mechanical cues (the shutdown bell, gates,
 * the crane's ratchet, a rope letting go). It starts from the tap-to-begin gesture.
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

  cues = 0;

  /** One-shot cue for a chase event (see Phase2World.events). */
  cue(name: string) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.white) return;
    const now = ctx.currentTime;
    this.cues++;
    const out = this.master;
    const tone = (freq: number, dur: number, gain: number, type: OscillatorType = "sine", at = 0, glide = 1) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, now + at);
      if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, now + at + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(gain, now + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      o.connect(g).connect(out);
      o.start(now + at);
      o.stop(now + at + dur + 0.05);
    };
    const hit = (freq: number, q: number, dur: number, gain: number, at = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = this.white;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, now + at);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      src.connect(f).connect(g).connect(out);
      src.start(now + at, Math.random(), dur + 0.05);
    };
    switch (name) {
      case "bell":
        // a harbour bell: inharmonic partials, long decay, struck three times
        for (const at of [0, 1.1, 2.2]) {
          for (const [ratio, amp] of [[1, 0.16], [2.76, 0.07], [5.4, 0.035], [0.5, 0.08]] as const) tone(392 * ratio, 3.2, amp, "sine", at);
        }
        break;
      case "gate":
        hit(900, 0.7, 0.35, 0.35);
        tone(70, 0.5, 0.35, "sine", 0, 0.6);
        break;
      case "clank":
        hit(2400, 3, 0.18, 0.2);
        tone(160, 0.2, 0.12, "triangle");
        break;
      case "winch":
      case "ratchet":
        for (let i = 0; i < (name === "winch" ? 16 : 10); i++) hit(3200, 6, 0.04, 0.12, i * 0.075);
        tone(55, 1.2, 0.18, "sawtooth", 0, 0.8);
        break;
      case "snap":
        hit(3800, 1.2, 0.09, 0.4);
        hit(700, 1.5, 0.25, 0.2, 0.02);
        break;
      case "grab":
        tone(120, 0.12, 0.25, "sine", 0, 0.6);
        hit(1500, 2, 0.08, 0.15);
        break;
      case "letgo":
        hit(600, 0.6, 0.45, 0.12);
        break;
      case "dock":
        hit(1200, 2, 0.3, 0.25);
        tone(90, 0.6, 0.25, "sine", 0, 0.7);
        break;
      case "unhook":
        tone(2640, 0.5, 0.06, "sine");
        tone(3960, 0.35, 0.03, "sine");
        break;
      case "leap":
        // a hop and a rush of air
        tone(180, 0.18, 0.18, "sine", 0, 1.8);
        hit(900, 0.5, 0.6, 0.18, 0.05);
        break;
      case "zip":
        // the strap on the rope: a rising metallic whine over a hiss, fading as he goes
        tone(420, 4.5, 0.05, "sawtooth", 0, 2.2);
        tone(630, 4.5, 0.025, "sawtooth", 0.05, 2.2);
        hit(4200, 1.5, 4.5, 0.09);
        break;
      case "endcard":
        // a low sting under the title
        tone(55, 4.0, 0.2, "sine", 0, 0.98);
        tone(82.5, 4.0, 0.12, "sine", 0.02);
        tone(110, 3.0, 0.07, "triangle", 0.04);
        hit(300, 0.8, 1.2, 0.12);
        break;
      case "reveal":
        tone(110, 3.5, 0.06, "sine");
        tone(165, 3.5, 0.04, "sine", 0.3);
        break;
    }
  }

  /** QA: context state and output RMS. */
  probe() {
    let rms = 0;
    if (this.analyser) {
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      rms = Math.sqrt(buf.reduce((a, b) => a + b * b, 0) / buf.length);
    }
    return { started: this.started, state: this.ctx?.state ?? "none", rms, steps: this.steps, cues: this.cues };
  }

  dispose() {
    void this.ctx?.close();
    this.ctx = null;
  }
}
