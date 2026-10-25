/** The round-up's sounds, synthesised: moos, a bark, the boxer's charge, the gate's chime, the tear, the coyote. */
export type HerdSounds = { moo(kind: number): void; bark(): void; charge(): void; penned(n: number): void; combo(n: number): void; lost(): void; coyote(): void; flee(): void; win(stars: number): void; setMuted(m: boolean): void; dispose(): void };

export function createHerdSounds(): HerdSounds {
  let ctx: AudioContext | null = null;
  let out: GainNode | null = null;
  let muted = false;
  let lastMoo = 0;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return null;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = muted ? 0 : 0.55;
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
  const tone = (type: OscillatorType, f0: number, f1: number, peak: number, a: number, d: number, at = 0, lp = 0) => {
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
  };
  const noise = (seconds: number, peak: number, f0: number, f1: number, q = 2, at = 0) => {
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
  };
  return {
    moo(kind) {
      const c = ensure();
      if (!c) return;
      const now = c.currentTime;
      if (now - lastMoo < 0.35) return;
      lastMoo = now;
      // a calf's moo is higher and shorter
      const base = kind === 2 ? 210 : 120 + Math.random() * 30;
      tone("sawtooth", base, base * 0.82, 0.16, 0.12, kind === 2 ? 0.35 : 0.6, 0, 700);
      tone("sawtooth", base * 1.01, base * 0.8, 0.08, 0.15, kind === 2 ? 0.35 : 0.6, 0, 500);
    },
    bark() {
      noise(0.09, 0.4, 1600, 700, 1.5);
      tone("square", 520, 300, 0.12, 0.005, 0.1, 0, 2000);
      noise(0.08, 0.3, 1500, 650, 1.5, 0.13);
      tone("square", 480, 280, 0.1, 0.005, 0.09, 0.13, 2000);
    },
    charge() {
      noise(0.5, 0.35, 300, 900, 0.8);
      tone("sawtooth", 110, 70, 0.18, 0.02, 0.4, 0, 400);
    },
    penned(n) {
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 987.77, 1046.5];
      tone("triangle", notes[Math.min(notes.length - 1, n - 1)], notes[Math.min(notes.length - 1, n - 1)], 0.22, 0.005, 0.5);
      tone("sine", notes[Math.min(notes.length - 1, n - 1)] * 2, notes[Math.min(notes.length - 1, n - 1)] * 2, 0.08, 0.005, 0.4, 0.05);
    },
    combo(n) {
      for (let i = 0; i < Math.min(4, n + 1); i++) tone("triangle", 784 * Math.pow(1.122, i), 784 * Math.pow(1.122, i), 0.16, 0.005, 0.18, i * 0.07);
    },
    lost() {
      tone("sine", 600, 60, 0.3, 0.01, 0.9);
      noise(0.6, 0.12, 2000, 200, 1);
    },
    coyote() {
      tone("sine", 600, 1100, 0.12, 0.25, 0.5, 0);
      tone("sine", 1100, 700, 0.12, 0.05, 0.9, 0.7);
    },
    flee() {
      tone("sine", 900, 1500, 0.08, 0.02, 0.25);
    },
    win(stars) {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < 2 + stars; i++) tone("triangle", notes[i % 4] * (i >= 4 ? 2 : 1), notes[i % 4], 0.2, 0.005, 0.35, i * 0.11);
    },
    setMuted(m) {
      muted = m;
      if (out) out.gain.value = m ? 0 : 0.55;
    },
    dispose() {
      ctx?.close().catch(() => undefined);
      ctx = null;
      out = null;
    },
  };
}
