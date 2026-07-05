import type { RallyEvent } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

type BrowserWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export class RallyAudio {
  private context: AudioContext | null = null;
  private enabled = false;

  get isEnabled() {
    return this.enabled;
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) return;
    const context = this.getContext();
    if (context.state === "suspended") await context.resume();
    this.chord([220, 330, 440], 0.08, 0.025);
  }

  handleEvent(event: RallyEvent) {
    this.haptic(event);
    if (!this.enabled) return;
    const tier = event.tier ?? 0;
    switch (event.type) {
      case "serve":
        this.sweep(220, 480, 0.18, "triangle", 0.08);
        break;
      case "breath_loop":
        this.noise(0.09, 0.028, 900);
        this.tone(110, 0.08, "sawtooth", 0.025);
        break;
      case "return":
        this.tone(180 + tier * 85, 0.13, "square", 0.11);
        this.noise(0.045, 0.05, 2600);
        break;
      case "wall_bounce":
        this.tone(250 + tier * 150, 0.06, "triangle", 0.055);
        break;
      case "bumper_bank":
        this.chord([310 + tier * 90, 465 + tier * 90], 0.09, 0.07);
        break;
      case "ignite":
        this.sweep(240, 960, 0.26, "sawtooth", 0.07);
        break;
      case "freeze_cast":
        this.sweep(760, 160, 0.42, "sine", 0.08);
        break;
      case "freeze_break":
        this.noise(0.13, 0.08, 4200);
        this.chord([420, 630, 840], 0.2, 0.065);
        break;
      case "rescue_ready":
        this.chord([330, 440, 660], 0.22, 0.055);
        break;
      case "gate_score_for":
        this.noise(0.16, 0.11, 1800);
        this.chord([180, 360, 540], 0.42, 0.1);
        break;
      case "gate_score_against":
        this.noise(0.16, 0.1, 900);
        this.sweep(260, 80, 0.4, "sawtooth", 0.09);
        break;
      case "victory":
        this.chord([261.6, 329.6, 392, 523.3], 0.8, 0.075);
        break;
      case "defeat":
        this.sweep(220, 55, 0.75, "triangle", 0.1);
        break;
      default:
        break;
    }
  }

  private getContext() {
    if (!this.context) {
      const AudioContextConstructor =
        window.AudioContext || (window as BrowserWindow).webkitAudioContext;
      if (!AudioContextConstructor) throw new Error("Web Audio is unavailable");
      this.context = new AudioContextConstructor();
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number
  ) {
    try {
      const context = this.getContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch {
      // Audio is optional; gameplay must never depend on an AudioContext.
    }
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    volume: number
  ) {
    try {
      const context = this.getContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(from, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(to, context.currentTime + duration);
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    } catch {
      // Optional enhancement.
    }
  }

  private chord(frequencies: number[], duration: number, volume: number) {
    for (const frequency of frequencies) {
      this.tone(frequency, duration, "triangle", volume / frequencies.length);
    }
  }

  private noise(duration: number, volume: number, highpass: number) {
    try {
      const context = this.getContext();
      const sampleCount = Math.ceil(context.sampleRate * duration);
      const buffer = context.createBuffer(1, sampleCount, context.sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < sampleCount; index += 1) {
        channel[index] = Math.sin(index * 91.731) * (1 - index / sampleCount);
      }
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = buffer;
      filter.type = "highpass";
      filter.frequency.value = highpass;
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(context.destination);
      source.start();
    } catch {
      // Optional enhancement.
    }
  }

  private haptic(event: RallyEvent) {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    if (event.type === "return") navigator.vibrate(RALLY_CONFIG.haptics.returnMs);
    if (event.type === "gate_score_for" || event.type === "gate_score_against") {
      navigator.vibrate(RALLY_CONFIG.haptics.scoreMs);
    }
  }
}
