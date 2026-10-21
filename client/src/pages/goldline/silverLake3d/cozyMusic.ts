/**
 * Silver Lake's lullaby: a slow, generative music-box loop synthesized with the Web Audio API.
 * There are no audio files and nothing licensed. A warm chord pad, a soft bass note each bar, and bell-like
 * pentatonic notes over a dreamy echo, at about 64 BPM. The phrase repeats every four bars with small variations,
 * so it lulls without looping mechanically.
 *
 * Browsers only allow sound after a user gesture, so call start() from a click or tap.
 */

export type CozyMusic = {
  start(): void;
  setMuted(muted: boolean): void;
  dispose(): void;
};

const BPM = 64;
const BEAT = 60 / BPM;
const LEVEL = 0.12;

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

// F major: F – Dm – Bb – C, two bars each (MIDI note numbers, root first)
const CHORDS: number[][] = [
  [53, 57, 60, 65], // F
  [50, 53, 57, 62], // Dm
  [46, 50, 53, 58], // Bb
  [48, 52, 55, 60], // C
];
// F-major pentatonic over two octaves for the music box
const BELL = [65, 67, 69, 72, 74, 77, 79, 81, 84];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCozyMusic(): CozyMusic {
  const Ctx: typeof AudioContext | undefined =
    typeof window === "undefined" ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bus: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let muted = false;
  let nextBeatTime = 0;
  let beatIndex = 0;
  let disposed = false;

  const onVisibility = () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else void ctx.resume().catch(() => undefined);
  };

  function voice(freq: number, at: number, opts: { type: OscillatorType; gain: number; attack: number; hold: number; release: number; detune?: number }) {
    if (!ctx || !bus) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type;
    osc.frequency.value = freq;
    if (opts.detune) osc.detune.value = opts.detune;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(opts.gain, at + opts.attack);
    g.gain.setValueAtTime(opts.gain, at + opts.attack + opts.hold);
    g.gain.exponentialRampToValueAtTime(0.0001, at + opts.attack + opts.hold + opts.release);
    osc.connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + opts.attack + opts.hold + opts.release + 0.05);
  }

  function bell(midi: number, at: number, gain: number) {
    const f = midiHz(midi);
    voice(f, at, { type: "sine", gain, attack: 0.006, hold: 0, release: 2.2 });
    voice(f * 2.0, at, { type: "sine", gain: gain * 0.28, attack: 0.004, hold: 0, release: 0.9 });
    voice(f * 3.01, at, { type: "sine", gain: gain * 0.1, attack: 0.003, hold: 0, release: 0.45 });
  }

  function scheduleBeat(i: number, at: number) {
    const bar = Math.floor(i / 4);
    const beatInBar = i % 4;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    // pad: a new chord every two bars, slow swell
    if (beatInBar === 0 && bar % 2 === 0) {
      for (const n of chord.slice(1)) {
        voice(midiHz(n), at, { type: "sine", gain: 0.022, attack: 1.6, hold: BEAT * 5, release: 2.4 });
        voice(midiHz(n), at, { type: "triangle", gain: 0.008, attack: 2.0, hold: BEAT * 5, release: 2.4, detune: 6 });
      }
    }
    // a soft bass note on each bar
    if (beatInBar === 0) voice(midiHz(chord[0] - 12), at, { type: "triangle", gain: 0.05, attack: 0.04, hold: 0.2, release: 2.6 });
    // music box: the four-bar phrase repeats, with a gentle variation each time it comes around
    const phrase = Math.floor(i / 16);
    const rnd = mulberry32((i % 16) * 7919 + (phrase % 3) * 104729);
    const tones = BELL.filter(n => chord.some(c => (n - c) % 12 === 0)).concat(BELL);
    for (const sub of [0, 0.5]) {
      if (rnd() < (sub === 0 ? 0.8 : 0.45)) {
        const n = tones[Math.floor(rnd() * tones.length)];
        bell(n, at + sub * BEAT + (rnd() - 0.5) * 0.012, sub === 0 ? 0.05 : 0.032);
      }
    }
  }

  function pump() {
    if (!ctx) return;
    while (nextBeatTime < ctx.currentTime + 0.7) {
      scheduleBeat(beatIndex, nextBeatTime);
      nextBeatTime += BEAT;
      beatIndex += 1;
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
        const tone = ctx.createBiquadFilter();
        tone.type = "lowpass";
        tone.frequency.value = 3400;
        bus = ctx.createGain();
        bus.gain.value = 1;
        // dreamy echo
        const delay = ctx.createDelay(1.5);
        delay.delayTime.value = BEAT * 0.75;
        const feedback = ctx.createGain();
        feedback.gain.value = 0.33;
        const wet = ctx.createGain();
        wet.gain.value = 0.28;
        bus.connect(tone);
        bus.connect(delay);
        delay.connect(feedback).connect(delay);
        delay.connect(wet).connect(tone);
        tone.connect(master).connect(ctx.destination);
        nextBeatTime = ctx.currentTime + 0.15;
        timer = setInterval(pump, 120);
        document.addEventListener("visibilitychange", onVisibility);
        pump();
      }
      void ctx.resume().catch(() => undefined);
      if (master && !muted) master.gain.setTargetAtTime(LEVEL, ctx.currentTime, 1.2);
    },
    setMuted(next) {
      muted = next;
      if (ctx && master) master.gain.setTargetAtTime(next ? 0 : LEVEL, ctx.currentTime, next ? 0.15 : 0.8);
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
