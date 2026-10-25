/** Small procedural score; starts only after a user gesture, disposed on exit. */
export function createSound() {
  let ctx: AudioContext | null = null;
  let gain: GainNode;
  let timer: ReturnType<typeof setInterval> | undefined;
  let step = 0;
  let muted = false;
  const note = (frequency: number, volume = 0.07, duration = 2) => {
    if (!ctx || muted) return;
    const osc = ctx.createOscillator(),
      g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(g);
    g.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  };
  return {
    start() {
      if (!ctx) {
        ctx = new AudioContext();
        gain = ctx.createGain();
        gain.gain.value = 0.6;
        gain.connect(ctx.destination);
        timer = setInterval(() => {
          const notes = [220, 329.63, 440, 293.66, 261.63, 392, 329.63, 293.66];
          note(notes[step++ % notes.length], 0.035, 3.8);
        }, 1200);
      }
      void ctx.resume();
    },
    mute(value: boolean) {
      muted = value;
      if (ctx) gain.gain.setTargetAtTime(value ? 0 : 0.6, ctx.currentTime, 0.2);
    },
    cue() {
      note(659.25, 0.05, 0.6);
      setTimeout(() => note(880, 0.04, 1), 100);
    },
    dispose() {
      if (timer) clearInterval(timer);
      void ctx?.close();
      ctx = null;
    },
  };
}
