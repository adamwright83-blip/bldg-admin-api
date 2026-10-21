/**
 * Beverly Hills' soundtrack: a generative hotel-lobby lounge loop, synthesized with the Web Audio API (no files,
 * nothing licensed). Soft Rhodes-like chords on a ii-V-I in F, a walking upright bass, brushed hats on the
 * backbeat with a lazy swing, and a vibraphone noodling over the top. Silver Lake keeps its lullaby; uptown gets jazz.
 * Browsers only allow sound after a gesture, so call start() from a click or tap.
 */

export type LoungeMusic = { start(): void; setMuted(m: boolean): void; dispose(): void };

const BPM = 78;
const BEAT = 60 / BPM;
const SWING = 0.62; // the off-beat lands late, like a person playing
const LEVEL = 0.13;
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// two bars each: Gm9, C13, Fmaj9, Dm9 (bass root first)
const CHORDS: number[][] = [
  [43, 58, 62, 65, 69],
  [36, 58, 64, 69, 70],
  [41, 57, 64, 67, 72],
  [38, 57, 60, 65, 64],
];
const VIBES = [65, 67, 69, 72, 74, 76, 77, 79, 81];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function createLoungeMusic(): LoungeMusic {
  const Ctx: typeof AudioContext | undefined =
    typeof window === "undefined" ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bus: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let next = 0;
  let beat = 0;
  let muted = false;
  let disposed = false;
  const onVisibility = () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  };

  function tone(freq: number, at: number, type: OscillatorType, gain: number, attack: number, release: number, trem = 0) {
    if (!ctx || !bus) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    let out: AudioNode = g;
    if (trem) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      const amp = ctx.createGain();
      lfo.frequency.value = trem;
      depth.gain.value = 0.35;
      amp.gain.value = 0.65;
      lfo.connect(depth).connect(amp.gain);
      g.connect(amp);
      out = amp;
      lfo.start(at);
      lfo.stop(at + attack + release + 0.05);
    }
    out.connect(bus);
    o.connect(g);
    o.start(at);
    o.stop(at + attack + release + 0.05);
  }

  function hat(at: number, gain: number) {
    if (!ctx || !bus || !noise) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    src.connect(hp).connect(g).connect(bus);
    src.start(at);
    src.stop(at + 0.2);
  }

  function schedule(i: number, at: number) {
    const bar = Math.floor(i / 4);
    const b = i % 4;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const r = rng(i * 2654435761 + (Math.floor(i / 32) % 2) * 97);
    // chords: a soft Rhodes-ish stab on 1 and the "and" of 2, a little different each pass
    if (b === 0 || (b === 1 && r() < 0.6)) {
      const t = b === 0 ? at : at + BEAT * SWING;
      for (const n of chord.slice(1)) {
        tone(midiHz(n), t, "sine", 0.03, 0.01, 1.6);
        tone(midiHz(n) * 2, t, "sine", 0.006, 0.005, 0.5);
      }
    }
    // walking bass: root on 1, then chord tones and approach notes
    const walk = [chord[0], chord[0] + 7, chord[0] + 12 - (r() < 0.5 ? 2 : 0), chord[0] + 4 + (r() < 0.5 ? 1 : 0)];
    tone(midiHz(walk[b]), at, "triangle", 0.075, 0.015, BEAT * 0.9);
    // brushes: 2 and 4, plus a swung ghost
    if (b === 1 || b === 3) hat(at, 0.05);
    if (r() < 0.55) hat(at + BEAT * SWING, 0.018);
    // vibraphone: sparse, swung, motor-tremolo
    for (const sub of [0, SWING]) {
      if (r() < (sub === 0 ? 0.42 : 0.3)) {
        const pool = VIBES.filter(v => chord.some(c => (v - c) % 12 === 0)).concat(VIBES);
        const n = pool[Math.floor(r() * pool.length)];
        tone(midiHz(n), at + sub * BEAT, "sine", 0.045, 0.004, 1.4, 5.5);
      }
    }
  }

  function pump() {
    if (!ctx) return;
    while (next < ctx.currentTime + 0.7) {
      schedule(beat, next);
      next += BEAT;
      beat += 1;
    }
  }

  return {
    start() {
      if (disposed || !Ctx) return;
      if (!ctx) {
        try {
          ctx = new Ctx();
        } catch {
          return;
        }
        master = ctx.createGain();
        master.gain.value = 0;
        bus = ctx.createGain();
        const warm = ctx.createBiquadFilter();
        warm.type = "lowpass";
        warm.frequency.value = 5200;
        const room = ctx.createDelay(1.0);
        room.delayTime.value = 0.19;
        const fb = ctx.createGain();
        fb.gain.value = 0.28;
        const wet = ctx.createGain();
        wet.gain.value = 0.2;
        bus.connect(warm);
        bus.connect(room);
        room.connect(fb).connect(room);
        room.connect(wet).connect(warm);
        warm.connect(master).connect(ctx.destination);
        noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
        next = ctx.currentTime + 0.15;
        timer = setInterval(pump, 120);
        document.addEventListener("visibilitychange", onVisibility);
        pump();
      }
      void ctx.resume().catch(() => undefined);
      if (master && !muted) master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 1.0);
    },
    setMuted(m) {
      muted = m;
      if (ctx && master) master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, m ? 0.15 : 0.8);
    },
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
      if (ctx) {
        document.removeEventListener("visibilitychange", onVisibility);
        const c = ctx;
        master?.gain.setTargetAtTime(0, c.currentTime, 0.12);
        setTimeout(() => void c.close().catch(() => undefined), 500);
      }
      ctx = null;
    },
  };
}
