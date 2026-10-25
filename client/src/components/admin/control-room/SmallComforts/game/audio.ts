// Procedural WebAudio. Nothing is downloaded. Starts on first tap.
import type { SoundCue } from "../logic/chapters";

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
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
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

  // ------------------------------------------------------------------ Chapters 1-4 Comedy & Slapstick Audio
  /** Formant-filtered vocal synthesis for the free glass shards' a cappella barbershop harmonies */
  glassShardChorus(notesHz: readonly number[], dur = 0.68) {
    this.start();
    const c = this.ctx;
    if (!c || this.muted) return;
    const t0 = c.currentTime;
    // Vowel formants ("AH" -> "EE" celebratory syllable)
    const f1 = 730;
    const f2 = 1220;
    notesHz.forEach((freq, idx) => {
      const osc = c.createOscillator();
      const glassHarmonic = c.createOscillator();
      osc.type = "sawtooth";
      glassHarmonic.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);
      glassHarmonic.frequency.setValueAtTime(freq * 2, t0);

      // Gentle vibrato so it feels like happy a cappella singers
      const vib = c.createOscillator();
      const vibGain = c.createGain();
      vib.frequency.value = 5.5 + idx * 0.4;
      vibGain.gain.value = 3.2;
      vib.connect(vibGain).connect(osc.frequency);
      vib.start(t0);
      vib.stop(t0 + dur + 0.08);

      const bp1 = c.createBiquadFilter();
      bp1.type = "bandpass";
      bp1.frequency.setValueAtTime(f1, t0);
      bp1.frequency.exponentialRampToValueAtTime(f1 * 1.25, t0 + dur * 0.6);
      bp1.Q.value = 4.5;

      const bp2 = c.createBiquadFilter();
      bp2.type = "bandpass";
      bp2.frequency.setValueAtTime(f2, t0);
      bp2.frequency.exponentialRampToValueAtTime(f2 * 1.4, t0 + dur * 0.6);
      bp2.Q.value = 5.0;

      const env = c.createGain();
      const startDelay = idx * 0.025;
      env.gain.setValueAtTime(0.0001, t0 + startDelay);
      env.gain.exponentialRampToValueAtTime(0.11, t0 + startDelay + 0.035);
      env.gain.exponentialRampToValueAtTime(0.08, t0 + startDelay + dur * 0.75);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + startDelay + dur);

      osc.connect(bp1).connect(env);
      osc.connect(bp2).connect(env);
      glassHarmonic.connect(env);
      env.connect(this.master);

      osc.start(t0 + startDelay);
      glassHarmonic.start(t0 + startDelay);
      osc.stop(t0 + startDelay + dur + 0.05);
      glassHarmonic.stop(t0 + startDelay + dur + 0.05);
    });
    // Crystalline clink sparkle on top of the vocal chord
    this.tone(2637, 0.18, "triangle", 0.08, 3136, 0.01);
  }

  playCue(cue: SoundCue) {
    this.start();
    switch (cue.kind) {
      case "zipper_tooth":
        this.tone(cue.freqHz, 0.14, "triangle", 0.22, cue.freqHz * 1.18);
        this.noise(0.03, 2800, 0.18, "highpass");
        break;
      case "zipper_run_down":
        cue.notesHz.forEach((f, i) => {
          this.tone(f, 0.11, "triangle", 0.18, f * 0.96, i * 0.055);
        });
        break;
      case "cap_clink":
        this.tone(1180, 0.12, "sine", 0.2, 880);
        this.tone(2360, 0.08, "triangle", 0.1, 1760, 0.02);
        break;
      case "sling_stretch":
        this.tone(160 + cue.tension * 180, 0.22, "sawtooth", 0.09, 260 + cue.tension * 240);
        break;
      case "egg_crack":
        this.noise(0.09, 2600, 0.35, "bandpass", 0.42);
        this.tone(240, 0.18, "sine", 0.25, 110, 0.45);
        break;
      case "shell_crunch":
        this.noise(0.11, 3200, 0.32, "highpass");
        this.noise(0.08, 1800, 0.25, "bandpass", 0.04);
        break;
      case "whoopee_toot":
        this.tone(cue.pitchHz, cue.durationSec, "sawtooth", 0.26, 58);
        this.tone(cue.pitchHz * 1.04, cue.durationSec * 0.9, "square", 0.12, 62, 0.03);
        this.noise(cue.durationSec * 0.8, 360, 0.2, "bandpass", 0.02, 140);
        break;
      case "toaster_lever":
        this.latch();
        break;
      case "smoke_alarm":
        [0, 0.22, 0.44].forEach(d => this.tone(3120, 0.12, "square", 0.14, 3080, d));
        break;
      case "pratfall_boing":
        this.tone(190, 0.38, "triangle", 0.26, 420);
        this.tone(420, 0.32, "sine", 0.2, 150, 0.18);
        break;
      case "trimmer_buzz":
        this.tone(92 - cue.load * 18, 0.16, "sawtooth", 0.11, 86 - cue.load * 22);
        this.noise(0.12, 1400, 0.08, "bandpass");
        break;
      case "man_stir_snort":
        this.noise(0.28, 420, 0.28, "bandpass", 0, 180);
        this.tone(110, 0.24, "sawtooth", 0.12, 75);
        break;
      case "this_is_a_sign":
        [392, 493.88, 587.33, 783.99].forEach((f, i) => this.tone(f, 0.45, "sine", 0.14, undefined, i * 0.1));
        break;
      case "pinball_bumper":
        this.tone(880, 0.14, "triangle", 0.24, 1320);
        this.tone(1320, 0.18, "sine", 0.18, 1760, 0.05);
        break;
      case "inhale_swell":
        this.noise(0.45, 500, 0.18, "bandpass", 0, 1200);
        this.tone(260, 0.35, "sine", 0.14, 520);
        break;
      case "exhale_blast":
        this.noise(0.42, 900, 0.34, "bandpass", 0, 220);
        this.tone(150, 0.35, "sawtooth", 0.16, 65);
        break;
      case "spoon_twang":
        this.tone(240, 0.25, "triangle", 0.24, 580);
        break;
      case "gulp_choke":
        this.tone(320, 0.18, "sine", 0.28, 120);
        this.tone(180, 0.22, "triangle", 0.24, 290, 0.18);
        break;
      case "window_shatter":
        this.noise(0.35, 3800, 0.42, "highpass");
        [1567, 2093, 2637, 3135, 3951].forEach((f, i) =>
          this.tone(f, 0.22, "triangle", 0.14, f * 0.85, i * 0.04),
        );
        break;
      case "ass_thud":
        this.thump();
        this.tone(85, 0.32, "sine", 0.45, 38, 0.06);
        break;
      case "heimlich_grunt":
        this.tone(cue.synced ? 220 : 145, 0.2, "triangle", 0.28, cue.synced ? 330 : 110);
        break;
      case "glass_shard_chorus":
        this.glassShardChorus(cue.notesHz);
        break;
      case "cork_pop_triumph":
        this.tone(180, 0.09, "sine", 0.35, 760);
        this.glassShardChorus([261.63, 329.63, 392.0, 523.25, 659.25], 1.1);
        break;
      case "chapter_chime":
        this.chime();
        break;
    }
  }
}
