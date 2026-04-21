/**
 * Sound effects using the Web Audio API.
 * All sounds are synthesized — no external audio files needed.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function playTone(freq: number, duration: number, type: OscillatorType = "sine", volume = 0.15) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Silently fail if audio context is unavailable
  }
}

function playNoise(duration: number, volume = 0.08) {
  try {
    const ctx = getCtx();
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(3000, ctx.currentTime);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(ctx.currentTime);
  } catch {
    // Silently fail
  }
}

export const sounds = {
  /** Camera shutter — mechanical click */
  shutter: () => {
    playNoise(0.08, 0.2);
    setTimeout(() => playTone(2000, 0.05, "square", 0.1), 60);
  },

  /** Scan confirmed — rising two-note chime */
  scanConfirm: () => {
    playTone(880, 0.15, "sine", 0.12);
    setTimeout(() => playTone(1320, 0.2, "sine", 0.12), 120);
  },

  /** Laundry collected — satisfying thwump */
  collect: () => {
    playTone(150, 0.15, "sine", 0.2);
    playNoise(0.05, 0.1);
  },

  /** Obstacle hit — crash */
  crash: () => {
    playNoise(0.2, 0.25);
    playTone(80, 0.3, "sawtooth", 0.15);
  },

  /** Override whine — rising electronic tone */
  overrideWhine: (progress: number) => {
    const freq = 400 + progress * 2000;
    playTone(freq, 0.1, "sine", 0.06);
  },

  /** Override success — massive bass boom */
  overrideSuccess: () => {
    playTone(60, 0.6, "sine", 0.3);
    playTone(120, 0.4, "triangle", 0.2);
    playNoise(0.15, 0.15);
    setTimeout(() => playTone(880, 0.3, "sine", 0.15), 200);
    setTimeout(() => playTone(1320, 0.4, "sine", 0.12), 350);
  },

  /** Override fail */
  overrideFail: () => {
    playTone(200, 0.3, "sawtooth", 0.15);
    setTimeout(() => playTone(150, 0.4, "sawtooth", 0.15), 200);
  },

  /** Countdown tick */
  tick: () => {
    playTone(1000, 0.05, "square", 0.08);
  },

  /** Mission assigned — low bass thrum */
  missionAssign: () => {
    playTone(55, 0.8, "sine", 0.2);
    setTimeout(() => playTone(55, 0.6, "sine", 0.15), 600);
  },

  /** XP counting up */
  xpTick: () => {
    playTone(1200 + Math.random() * 400, 0.05, "sine", 0.06);
  },

  /** Button press */
  press: () => {
    playTone(600, 0.06, "square", 0.06);
  },
};
