import { createSynth, moo } from "./synth";

/** The round-up's sounds, synthesised: moos, a bark, the boxer's charge, the gate's chime, the tear, the coyote. */
export type HerdSounds = { moo(kind: number): void; bark(): void; charge(): void; penned(n: number): void; combo(n: number): void; lost(): void; coyote(): void; flee(): void; win(stars: number): void; setMuted(m: boolean): void; dispose(): void };

export function createHerdSounds(): HerdSounds {
  const synth = createSynth(0.55);
  const { tone, noise } = synth;
  let lastMoo = 0;
  return {
    moo(kind) {
      const c = synth.ensure();
      if (!c) return;
      const now = c.currentTime;
      if (now - lastMoo < 0.35) return;
      lastMoo = now;
      moo(synth, kind);
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
    setMuted: synth.setMuted,
    dispose: synth.dispose,
  };
}
