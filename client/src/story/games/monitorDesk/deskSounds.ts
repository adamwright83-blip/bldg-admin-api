/**
 * The desk's few sounds, synthesised: a motion blip, the recorder's shutter, a refusal, and the hum when the
 * indicator lights. Nothing loads; the audio context opens on the first press, as browsers require.
 */
export type DeskSounds = {
  wake(): void;
  blip(): void;
  shutter(): void;
  refuse(): void;
  hum(on: boolean): void;
  setMuted(muted: boolean): void;
  dispose(): void;
};

export function createDeskSounds(): DeskSounds {
  let ctx: AudioContext | null = null;
  let out: GainNode | null = null;
  let hum: { osc: OscillatorNode; gain: GainNode } | null = null;
  let muted = false;

  const tone = (freq: number, dur: number, type: OscillatorType, peak: number, slide = 0) => {
    if (!ctx || !out || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  const noise = (dur: number, peak: number) => {
    if (!ctx || !out || muted) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = peak;
    src.connect(gain).connect(out);
    src.start();
  };

  return {
    wake() {
      if (ctx) return;
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        ctx = new Ctor();
        out = ctx.createGain();
        out.gain.value = 0.5;
        out.connect(ctx.destination);
      } catch {
        ctx = null;
      }
    },
    blip() {
      tone(1320, 0.09, "square", 0.05);
      setTimeout(() => tone(990, 0.09, "square", 0.04), 110);
    },
    shutter() {
      noise(0.05, 0.35);
      tone(180, 0.08, "triangle", 0.12, 0.6);
    },
    refuse() {
      tone(220, 0.16, "sawtooth", 0.05, 0.8);
    },
    hum(on) {
      if (!ctx || !out) return;
      if (on && !hum) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 60;
        gain.gain.value = 0;
        gain.gain.linearRampToValueAtTime(muted ? 0 : 0.05, ctx.currentTime + 1.2);
        osc.connect(gain).connect(out);
        osc.start();
        hum = { osc, gain };
      } else if (!on && hum) {
        const h = hum;
        hum = null;
        h.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        h.osc.stop(ctx.currentTime + 0.45);
      }
    },
    setMuted(m) {
      muted = m;
      if (hum && ctx) hum.gain.gain.linearRampToValueAtTime(m ? 0 : 0.05, ctx.currentTime + 0.2);
    },
    dispose() {
      hum?.osc.stop();
      hum = null;
      void ctx?.close();
      ctx = null;
    },
  };
}
