/**
 * The small sounds the body makes: a rope creak on every pull, a grunt when she's tired, a thud when she lands, a
 * slide when she drops to a knot. Synthesised in Web Audio so there is no file; the context opens on the first press,
 * which is a user gesture.
 */
export type CpeSounds = { creak(strength: number): void; grunt(): void; thud(): void; slide(): void; setMuted(m: boolean): void; dispose(): void };

export function createCpeSounds(): CpeSounds {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let muted = false;
  const ensure = () => {
    if (ctx) return ctx;
    const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    return ctx;
  };
  const noise = (c: AudioContext, seconds: number) => {
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  };
  const env = (c: AudioContext, peak: number, attack: number, decay: number) => {
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  };
  return {
    creak(strength) {
      const c = ensure();
      if (!c || !master) return;
      // rope fibres: filtered noise with a slow sweep, louder when she pulls harder
      const n = noise(c, 0.18);
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(420 + Math.random() * 200, c.currentTime);
      f.frequency.exponentialRampToValueAtTime(220, c.currentTime + 0.16);
      f.Q.value = 6;
      const g = env(c, 0.18 + strength * 0.25, 0.01, 0.16);
      n.connect(f).connect(g).connect(master);
      n.start();
    },
    grunt() {
      const c = ensure();
      if (!c || !master) return;
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(150, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(95, c.currentTime + 0.14);
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 600;
      const g = env(c, 0.16, 0.015, 0.14);
      o.connect(f).connect(g).connect(master);
      o.start();
      o.stop(c.currentTime + 0.2);
    },
    thud() {
      const c = ensure();
      if (!c || !master) return;
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(90, c.currentTime);
      o.frequency.exponentialRampToValueAtTime(42, c.currentTime + 0.18);
      const g = env(c, 0.5, 0.005, 0.22);
      o.connect(g).connect(master);
      o.start();
      o.stop(c.currentTime + 0.3);
      const n = noise(c, 0.05);
      const ng = env(c, 0.12, 0.002, 0.04);
      n.connect(ng).connect(master);
      n.start();
    },
    slide() {
      const c = ensure();
      if (!c || !master) return;
      const n = noise(c, 0.35);
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(900, c.currentTime);
      f.frequency.exponentialRampToValueAtTime(300, c.currentTime + 0.3);
      f.Q.value = 3;
      const g = env(c, 0.3, 0.01, 0.3);
      n.connect(f).connect(g).connect(master);
      n.start();
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 0.5;
    },
    dispose() {
      ctx?.close().catch(() => undefined);
      ctx = null;
      master = null;
    },
  };
}
