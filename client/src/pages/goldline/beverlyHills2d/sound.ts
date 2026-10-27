/**
 * The Lost Creek's sounds: the small procedural score, and one named cue per verb (the sim asks for them in
 * `Adventure.cues`; the page plays and clears them). Starts only after a user gesture, disposed on exit.
 */
import type { Cue } from "./adventure";
import { createSynth, moo } from "./synth";

export function createSound() {
  const synth = createSynth(0.6);
  const { tone, noise } = synth;
  let timer: ReturnType<typeof setInterval> | undefined;
  let step = 0;
  const cues: Record<Cue, () => void> = {
    splash() {
      noise(0.35, 0.22, 1800, 380, 0.8);
      tone("sine", 320, 110, 0.06, 0.01, 0.25);
    },
    pop() {
      tone("sine", 380, 920, 0.14, 0.005, 0.12);
      noise(0.18, 0.12, 1400, 500, 1.2, 0.04);
    },
    hose() {
      // a 1.2 s gurgle: little bubbles at uneven pitches
      for (let i = 0; i < 8; i++) noise(0.11, 0.1, 260 + ((i * 337) % 520), 200 + ((i * 211) % 300), 7, i * 0.15);
    },
    fill() {
      tone("sine", 300, 540, 0.05, 0.2, 0.9);
    },
    creak() {
      tone("sawtooth", 92, 138, 0.1, 0.05, 0.45, 0, 620);
      tone("sawtooth", 130, 96, 0.07, 0.04, 0.3, 0.32, 520);
    },
    knock() {
      tone("triangle", 190, 120, 0.22, 0.004, 0.14);
      noise(0.05, 0.16, 900, 700, 3);
      tone("triangle", 170, 110, 0.14, 0.004, 0.12, 0.16);
    },
    moo() {
      moo(synth, 2);
    },
    huff() {
      noise(0.22, 0.24, 520, 260, 1.2);
      noise(0.18, 0.16, 480, 240, 1.2, 0.26);
    },
    sigh() {
      noise(0.85, 0.12, 760, 280, 1);
    },
    chime() {
      tone("triangle", 1318.5, 1318.5, 0.12, 0.005, 0.7);
      tone("sine", 2637, 2637, 0.04, 0.005, 0.5, 0.03);
    },
    chord() {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => tone("triangle", f, f, 0.14, 0.01, 1.6, i * 0.09));
      tone("sine", 261.63, 261.63, 0.08, 0.05, 2);
    },
    rustle() {
      noise(0.6, 0.12, 3200, 1400, 0.7);
      noise(0.3, 0.08, 2400, 1800, 1, 0.22);
    },
    lap() {
      for (let i = 0; i < 6; i++) noise(0.05, 0.14, 2100, 1300, 3, i * 0.32);
    },
    toss() {
      noise(0.26, 0.12, 600, 2200, 1.4);
    },
    pick() {
      tone("sine", 880, 990, 0.08, 0.005, 0.12);
    },
    thunk() {
      tone("triangle", 150, 92, 0.2, 0.004, 0.18);
      tone("sine", 620, 600, 0.05, 0.004, 0.5);
    },
    sniff() {
      for (let i = 0; i < 3; i++) noise(0.07, 0.1, 2600, 1900, 2, i * 0.11);
    },
    bleat() {
      tone("sawtooth", 300, 240, 0.12, 0.03, 0.3, 0, 900);
    },
    ding() {
      tone("sine", 1567.98, 1567.98, 0.1, 0.005, 0.8);
      tone("sine", 1174.66, 1174.66, 0.1, 0.005, 1, 0.22);
    },
  };
  return {
    start() {
      const c = synth.ensure();
      if (!c) return;
      if (!timer) {
        timer = setInterval(() => {
          const notes = [220, 329.63, 440, 293.66, 261.63, 392, 329.63, 293.66];
          const f = notes[step++ % notes.length];
          tone("sine", f, f, 0.035, 0.03, 3.8);
        }, 1200);
      }
      void c.resume();
    },
    mute(value: boolean) {
      synth.setMuted(value);
    },
    play(cue: Cue) {
      cues[cue]?.();
    },
    dispose() {
      if (timer) clearInterval(timer);
      timer = undefined;
      synth.dispose();
    },
  };
}
