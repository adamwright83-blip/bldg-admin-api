/**
 * The little synthesiser both Beverly Hills modes share: a lazily opened AudioContext, one output gain, an enveloped
 * oscillator (`tone`) and filtered noise (`noise`). Everything the animals and the water say is built from these two.
 */
export type Synth = {
  /** the context, opened on first use (null where the browser has no Web Audio) */
  ensure(): AudioContext | null;
  tone(type: OscillatorType, f0: number, f1: number, peak: number, a: number, d: number, at?: number, lp?: number): void;
  noise(seconds: number, peak: number, f0: number, f1: number, q?: number, at?: number): void;
  setMuted(m: boolean): void;
  dispose(): void;
};

export function createSynth(level: number): Synth {
  let ctx: AudioContext | null = null;
  let out: GainNode | null = null;
  let muted = false;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = muted ? 0 : level;
    out.connect(ctx.destination);
    return ctx;
  };
  const env = (c: AudioContext, peak: number, a: number, d: number, at = 0) => {
    const g = c.createGain();
    const t = c.currentTime + at;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    return g;
  };
  return {
    ensure,
    tone(type, f0, f1, peak, a, d, at = 0, lp = 0) {
      const c = ensure();
      if (!c || !out) return;
      const o = c.createOscillator();
      o.type = type;
      const t = c.currentTime + at;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
      const g = env(c, peak, a, d, at);
      if (lp) {
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = lp;
        o.connect(f).connect(g).connect(out);
      } else o.connect(g).connect(out);
      o.start(t);
      o.stop(t + a + d + 0.05);
    },
    noise(seconds, peak, f0, f1, q = 2, at = 0) {
      const c = ensure();
      if (!c || !out) return;
      const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buf;
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      const t = c.currentTime + at;
      f.frequency.setValueAtTime(f0, t);
      f.frequency.exponentialRampToValueAtTime(f1, t + seconds);
      f.Q.value = q;
      src.connect(f).connect(env(c, peak, 0.01, seconds, at)).connect(out);
      src.start(t);
    },
    setMuted(m) {
      muted = m;
      if (out) out.gain.value = m ? 0 : level;
    },
    dispose() {
      ctx?.close().catch(() => undefined);
      ctx = null;
      out = null;
    },
  };
}

/** a cow's moo; a calf's (kind 2) is higher and shorter */
export function moo(s: Synth, kind: number) {
  const base = kind === 2 ? 210 : 120 + Math.random() * 30;
  s.tone("sawtooth", base, base * 0.82, 0.16, 0.12, kind === 2 ? 0.35 : 0.6, 0, 700);
  s.tone("sawtooth", base * 1.01, base * 0.8, 0.08, 0.15, kind === 2 ? 0.35 : 0.6, 0, 500);
}
