import { getAudioManager } from "@/game/audio/AudioManager";

/**
 * The sounds of Rook's airmail course, synthesized with the Web Audio API (no files, nothing licensed), the way the
 * Silver Lake lullaby is. The cups are tuned to the lullaby's F major, so a lucky flight plays along with it.
 * Honours the shared Goldline mute. Browsers only allow sound after a gesture; the first press on the course opens it.
 */

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
/** F5, A5, C6: the three cups, in the order a glider meets them */
export const CUP_NOTES = [77, 81, 84];

export type DeliveryAudio = ReturnType<typeof createDeliveryAudio>;

export function createDeliveryAudio() {
  const Ctx: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let flutter: {
    src: AudioBufferSourceNode;
    gain: GainNode;
    filter: BiquadFilterNode;
  } | null = null;
  let hum: { osc: OscillatorNode; gain: GainNode } | null = null;
  let disposed = false;

  const muted = () => getAudioManager().isMuted;

  function ensure(): AudioContext | null {
    if (disposed || muted() || !Ctx) return null;
    if (!ctx) {
      ctx = new Ctx();
      master = ctx.createGain();
      master.gain.value = 0.55;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master.connect(comp).connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      let s = 12345;
      for (let i = 0; i < d.length; i++) {
        s = (s * 16807) % 2147483647;
        d[i] = (s / 2147483647) * 2 - 1;
      }
    }
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
    return ctx;
  }

  function tone(
    freq: number,
    at: number,
    opts: {
      type?: OscillatorType;
      gain: number;
      attack?: number;
      decay: number;
      to?: number;
      detune?: number;
    }
  ) {
    const c = ctx!;
    // a bell's high partials can land above what the device can play: those are simply dropped
    const top = c.sampleRate / 2 - 200;
    if (freq > top) return;
    const o = c.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(freq, at);
    if (opts.to)
      o.frequency.exponentialRampToValueAtTime(
        Math.min(opts.to, top),
        at + opts.decay
      );
    if (opts.detune) o.detune.value = opts.detune;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(opts.gain, at + (opts.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(
      0.0001,
      at + (opts.attack ?? 0.004) + opts.decay
    );
    o.connect(g).connect(master!);
    o.start(at);
    o.stop(at + (opts.attack ?? 0.004) + opts.decay + 0.05);
  }

  function noise(
    at: number,
    opts: {
      gain: number;
      dur: number;
      type?: BiquadFilterType;
      freq: number;
      q?: number;
      to?: number;
      attack?: number;
    }
  ) {
    const c = ctx!;
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    const top = c.sampleRate / 2 - 200;
    f.frequency.setValueAtTime(Math.min(opts.freq, top), at);
    if (opts.to)
      f.frequency.exponentialRampToValueAtTime(
        Math.min(opts.to, top),
        at + opts.dur
      );
    f.Q.value = opts.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(opts.gain, at + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, at + opts.dur);
    src.connect(f).connect(g).connect(master!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + opts.dur + 0.05);
  }

  /** a bell: inharmonic partials, the way a real one rings */
  function bellVoice(at: number, base: number, gain: number, length: number) {
    const partials: [number, number][] = [
      [1, 1],
      [2.76, 0.5],
      [5.4, 0.28],
      [8.93, 0.14],
      [13.34, 0.06],
    ];
    for (const [ratio, amp] of partials) {
      tone(base * ratio, at, {
        gain: gain * amp,
        attack: 0.002,
        decay: length / (1 + ratio * 0.35),
        detune: (ratio - 1) * 3,
      });
    }
  }

  return {
    /** call from a pointer or key press on the course */
    unlock() {
      ensure();
    },
    stretch(tension: number) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      // a rubbery creak, higher as it tightens
      tone(90 + tension * 140, at, {
        type: "sawtooth",
        gain: 0.025 + tension * 0.03,
        attack: 0.01,
        decay: 0.09,
      });
      noise(at, { gain: 0.015, dur: 0.07, freq: 900 + tension * 1400, q: 6 });
    },
    launch(power: number) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      // the elastic snaps, the paper goes
      tone(210 + power * 90, at, {
        type: "triangle",
        gain: 0.22,
        decay: 0.22,
        to: 60,
      });
      tone(420, at, { type: "sine", gain: 0.06, decay: 0.08, to: 160 });
      noise(at + 0.01, {
        gain: 0.12 + power * 0.1,
        dur: 0.45,
        freq: 700,
        to: 3200,
        q: 0.8,
      });
    },
    wings(open: boolean) {
      const c = ensure();
      if (!c) return;
      noise(c.currentTime, {
        gain: open ? 0.06 : 0.04,
        dur: open ? 0.09 : 0.06,
        type: "highpass",
        freq: open ? 2400 : 3400,
      });
    },
    /** paper fluttering in the fan's updraft, continuous; level 0 stops it */
    flutter(level: number) {
      const c = ensure();
      if (!c) return;
      if (!flutter && level > 0.01) {
        const src = c.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        const filter = c.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 1800;
        filter.Q.value = 1.2;
        // the paper's flutter: a tremolo stage the LFO swings between 0.5 and 1, then the level, which can reach
        // silence (an LFO wired straight into the level would keep it sounding at "off")
        const trem = c.createGain();
        trem.gain.value = 0.75;
        const lfo = c.createOscillator();
        lfo.frequency.value = 23;
        const lfoGain = c.createGain();
        lfoGain.gain.value = 0.25;
        lfo.connect(lfoGain).connect(trem.gain);
        const gain = c.createGain();
        gain.gain.value = 0;
        src.connect(filter).connect(trem).connect(gain).connect(master!);
        src.start();
        lfo.start();
        flutter = { src, gain, filter };
      }
      if (flutter)
        flutter.gain.gain.setTargetAtTime(level * 0.09, c.currentTime, 0.05);
    },
    fanHum(on: boolean) {
      const c = ensure();
      if (!c) return;
      if (on && !hum) {
        const osc = c.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = 58;
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = 220;
        const gain = c.createGain();
        gain.gain.value = 0;
        osc.connect(f).connect(gain).connect(master!);
        osc.start();
        hum = { osc, gain };
      }
      if (hum)
        hum.gain.gain.setTargetAtTime(on ? 0.018 : 0, c.currentTime, 0.3);
    },
    /** the little bell on the glider, jostled */
    jingle(strength: number) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      bellVoice(at, 2350 + Math.random() * 120, 0.05 + strength * 0.09, 0.45);
      if (strength > 0.5)
        bellVoice(at + 0.07, 2480, 0.04 + strength * 0.05, 0.3);
    },
    cup(i: number, strength = 1) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      const f = midiHz(CUP_NOTES[i] ?? 77);
      // china: a clear note with a glassy overtone and a tiny click
      tone(f, at, { gain: 0.16 * strength, attack: 0.002, decay: 1.4 });
      tone(f * 2.01, at, { gain: 0.05 * strength, attack: 0.002, decay: 0.6 });
      tone(f * 3.98, at, {
        gain: 0.025 * strength,
        attack: 0.001,
        decay: 0.25,
      });
      noise(at, {
        gain: 0.04 * strength,
        dur: 0.03,
        type: "highpass",
        freq: 5000,
      });
    },
    rope(strength: number) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      tone(118, at, {
        type: "triangle",
        gain: 0.08 + strength * 0.04,
        decay: 0.35,
        to: 82,
      });
      noise(at, { gain: 0.03, dur: 0.12, freq: 600, q: 3 });
    },
    skim(on: boolean) {
      const c = ensure();
      if (!c || !on) return;
      noise(c.currentTime, {
        gain: 0.05,
        dur: 0.5,
        freq: 2600,
        q: 0.7,
        to: 1900,
      });
    },
    cloth(strength: number) {
      const c = ensure();
      if (!c) return;
      noise(c.currentTime, {
        gain: 0.07 + strength * 0.03,
        dur: 0.22,
        type: "lowpass",
        freq: 1500,
        to: 500,
      });
    },
    clonk() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      tone(310, at, { type: "triangle", gain: 0.1, decay: 0.12, to: 180 });
      noise(at, { gain: 0.06, dur: 0.08, freq: 1200, q: 2 });
    },
    basket() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      tone(95, at, { gain: 0.18, decay: 0.2, to: 60 });
      noise(at, { gain: 0.09, dur: 0.18, freq: 2200, q: 1.4 });
      noise(at + 0.05, { gain: 0.05, dur: 0.12, freq: 3400, q: 2 });
    },
    thud(speed: number) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      tone(140, at, {
        gain: 0.08 + Math.min(speed, 8) * 0.012,
        decay: 0.12,
        to: 70,
      });
      noise(at, { gain: 0.06, dur: 0.1, type: "lowpass", freq: 1800 });
    },
    whoosh() {
      const c = ensure();
      if (!c) return;
      noise(c.currentTime, {
        gain: 0.12,
        dur: 0.25,
        freq: 500,
        to: 2600,
        q: 1.4,
      });
    },
    splash() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      noise(at, { gain: 0.1, dur: 0.18, freq: 1600, q: 1.2, to: 900 });
      tone(900, at + 0.02, { gain: 0.03, decay: 0.08, to: 1500 });
    },
    meow(kind: "sleepy" | "indignant" | "mrrp" = "indignant") {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      const len = kind === "mrrp" ? 0.18 : kind === "sleepy" ? 0.5 : 0.62;
      const o = c.createOscillator();
      o.type = "sawtooth";
      const base = kind === "sleepy" ? 420 : 520;
      o.frequency.setValueAtTime(base, at);
      o.frequency.linearRampToValueAtTime(
        base * (kind === "mrrp" ? 1.25 : 1.7),
        at + len * 0.35
      );
      o.frequency.linearRampToValueAtTime(base * 0.85, at + len);
      const f1 = c.createBiquadFilter();
      f1.type = "bandpass";
      f1.Q.value = 6;
      f1.frequency.setValueAtTime(700, at);
      f1.frequency.linearRampToValueAtTime(1300, at + len * 0.4);
      f1.frequency.linearRampToValueAtTime(800, at + len);
      const f2 = c.createBiquadFilter();
      f2.type = "bandpass";
      f2.Q.value = 8;
      f2.frequency.value = 2600;
      const g = c.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(kind === "sleepy" ? 0.12 : 0.2, at + 0.05);
      g.gain.setValueAtTime(kind === "sleepy" ? 0.1 : 0.18, at + len * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(f1).connect(g);
      o.connect(f2).connect(g);
      g.connect(master!);
      o.start(at);
      o.stop(at + len + 0.05);
    },
    pat() {
      const c = ensure();
      if (!c) return;
      noise(c.currentTime, {
        gain: 0.08,
        dur: 0.06,
        type: "lowpass",
        freq: 900,
      });
    },
    whap() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      noise(at, { gain: 0.14, dur: 0.1, freq: 1400, q: 1 });
      tone(220, at, { type: "triangle", gain: 0.06, decay: 0.08, to: 120 });
    },
    click() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      tone(1200, at, { type: "square", gain: 0.03, decay: 0.03 });
      tone(600, at + 0.04, { type: "triangle", gain: 0.05, decay: 0.06 });
    },
    shutter() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      noise(at, { gain: 0.05, dur: 0.16, freq: 500, q: 4, to: 900 });
      tone(180, at + 0.12, { type: "triangle", gain: 0.06, decay: 0.08 });
    },
    birds() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      for (let i = 0; i < 6; i++)
        noise(at + i * 0.07, {
          gain: 0.06,
          dur: 0.06,
          type: "lowpass",
          freq: 700,
        });
      tone(3600, at + 0.1, { gain: 0.04, decay: 0.08, to: 4400 });
      tone(4100, at + 0.28, { gain: 0.035, decay: 0.07, to: 3300 });
    },
    flop() {
      const c = ensure();
      if (!c) return;
      noise(c.currentTime, {
        gain: 0.09,
        dur: 0.14,
        type: "lowpass",
        freq: 1100,
        to: 300,
      });
    },
    /** the little ding Rook makes testing the bell: already far too loud for its size */
    testDing() {
      const c = ensure();
      if (!c) return;
      bellVoice(c.currentTime, 2200, 0.28, 0.9);
    },
    /** Bella's bell on her bicycle. Outrageously loud for something so small. */
    bigBell(length = 3.2) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      bellVoice(at, 1960, 0.5, length);
      bellVoice(at + 0.012, 1972, 0.35, length * 0.9);
      // a long shimmer
      const o = c.createOscillator();
      o.frequency.value = 1960 * 2.76;
      const vib = c.createOscillator();
      vib.frequency.value = 6;
      const vg = c.createGain();
      vg.gain.value = 9;
      vib.connect(vg).connect(o.frequency);
      const g = c.createGain();
      g.gain.setValueAtTime(0.06, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + length);
      o.connect(g).connect(master!);
      o.start(at);
      vib.start(at);
      o.stop(at + length + 0.1);
      vib.stop(at + length + 0.1);
    },
    /** the three cups' melody and a soft chord: the courtyard orchestra */
    chord(i: number) {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      const f = midiHz(CUP_NOTES[i] ?? 77);
      tone(f, at, { gain: 0.14, decay: 1.8 });
      tone(f / 2, at, { gain: 0.05, decay: 1.6, type: "triangle" });
    },
    finale() {
      const c = ensure();
      if (!c) return;
      const at = c.currentTime;
      [65, 69, 72, 77].forEach((m, k) =>
        tone(midiHz(m), at + k * 0.03, { gain: 0.09, decay: 2.4 })
      );
    },
    dispose() {
      disposed = true;
      try {
        flutter?.src.stop();
        hum?.osc.stop();
      } catch {
        /* already stopped */
      }
      void ctx?.close().catch(() => undefined);
      ctx = null;
    },
  };
}
