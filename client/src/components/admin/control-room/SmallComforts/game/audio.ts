// Procedural WebAudio. Nothing is downloaded. Starts on first tap.
export class Sound {
  ctx: AudioContext | null = null;
  master!: GainNode;
  rainGain!: GainNode;
  muted = false;
  private noiseBuf: AudioBuffer | null = null;

  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8; this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // rain bed: filtered noise loop
    const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.5;
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 900;
    this.rainGain = c.createGain(); this.rainGain.gain.value = 0.07;
    src.connect(bp).connect(hp).connect(this.rainGain).connect(this.master); src.start();
  }
  dispose() { try { void this.ctx?.close(); } catch { /* ignore */ } this.ctx = null; }
  setMuted(m: boolean) { this.muted = m; if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05); }
  setRain(v: number) { if (this.rainGain && this.ctx) this.rainGain.gain.setTargetAtTime(0.02 + 0.07 * v, this.ctx.currentTime, 0.4); }

  private tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.2, slideTo?: number, delay = 0) {
    const c = this.ctx; if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  private noise(dur: number, f: number, vol = 0.2, type: BiquadFilterType = "bandpass", delay = 0, sweepTo?: number) {
    const c = this.ctx; if (!c || this.muted || !this.noiseBuf) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  latch() { this.noise(0.05, 2400, 0.4); this.tone(180, 0.12, "square", 0.12, 90); this.noise(0.09, 1200, 0.3, "bandpass", 0.09); }
  creak() { this.tone(110, 1.1, "sawtooth", 0.05, 260); this.tone(150, 1.0, "sawtooth", 0.035, 340, 0.05); }
  thump() { this.tone(110, 0.22, "sine", 0.5, 45); this.noise(0.12, 400, 0.25, "lowpass"); }
  place() { this.tone(300, 0.1, "sine", 0.25, 120); this.noise(0.06, 800, 0.15, "lowpass"); }
  nope() { this.tone(160, 0.14, "square", 0.1, 120); }
  pick() { this.tone(500, 0.08, "triangle", 0.15, 700); }
  bell() { for (const [f, v] of [[1318, 0.3], [2637, 0.16], [3951, 0.08]] as const) this.tone(f, 1.6, "sine", v); }
  rip() { this.noise(0.18, 1800, 0.35, "highpass", 0, 5000); }
  lampClick() { this.noise(0.03, 3000, 0.5); this.tone(900, 0.04, "square", 0.1, 400, 0.01); }
  step() { this.noise(0.035, 1100 + Math.random() * 400, 0.07, "bandpass"); }
  bump() { this.tone(200, 0.12, "triangle", 0.3, 80); }
  sigh() { this.noise(0.7, 900, 0.1, "bandpass", 0, 300); }
  trainRumble() { this.noise(3.2, 160, 0.35, "lowpass"); this.tone(70, 3.0, "sawtooth", 0.05, 55); }
  chime() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.9, "sine", 0.12, undefined, i * 0.12)); }
  zzz() { this.tone(260, 0.5, "sine", 0.04, 200); }
}
