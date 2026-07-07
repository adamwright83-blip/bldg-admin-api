import type { RallyEvent } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";

type BrowserWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

type AudioGroup = "barks" | "sfx" | "crowd" | "ui";

export class RallyAudio {
  private context: AudioContext | null = null;
  private enabled = false;
  private master: GainNode | null = null;
  private groups: Record<AudioGroup, GainNode> | null = null;
  private crowdSource: OscillatorNode | null = null;
  private currentVariation = 0;

  get isEnabled() {
    return this.enabled;
  }

  async setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      if (this.context && this.groups) {
        this.groups.crowd.gain.setValueAtTime(0, this.context.currentTime);
      }
      return;
    }
    const context = this.getContext();
    if (context.state === "suspended") await context.resume();
    this.groups!.crowd.gain.setValueAtTime(RALLY_CONFIG.audio.crowdGain, context.currentTime);
    this.startCrowd();
    this.chord([220, 330, 440], 0.08, 0.025);
  }

  handleEvent(event: RallyEvent) {
    this.haptic(event);
    if (!this.enabled) return;
    this.currentVariation = event.variation ?? 0;
    const tier = event.tier ?? 0;
    switch (event.type) {
      case "serve":
        this.sweep(220, 480, 0.18, "triangle", 0.08);
        break;
      case "strike_crack":
        this.tone(320 + tier * 70, 0.08, "square", 0.11);
        this.noise(0.045, 0.055, 2800);
        break;
      case "contact_dink":
        this.tone(145, 0.05, "sine", 0.05);
        break;
      case "contact_header":
        this.tone(230 + tier * 80, 0.09, "triangle", 0.075);
        break;
      case "surge_on":
        this.sweep(180, 720, 0.28, "sawtooth", 0.08);
        break;
      case "breath_start":
        this.sweep(120, 520, 0.12, "sawtooth", 0.055);
        this.noise(0.08, 0.03, 700);
        break;
      case "breath_loop":
        this.noise(0.09, 0.028, 900);
        this.tone(110, 0.08, "sawtooth", 0.025);
        break;
      case "breath_contact":
        this.noise(0.07, 0.045, 2400);
        this.tone(420, 0.06, "triangle", 0.035);
        break;
      case "charged_release":
        this.sweep(180, 1180, 0.24, "sawtooth", 0.08);
        this.noise(0.16, 0.055, 540);
        break;
      case "breath_exhausted":
        this.tone(72, 0.06, "square", 0.045);
        this.tone(54, 0.08, "square", 0.03);
        break;
      case "return":
        this.setCrowdTier(tier);
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
      case "tape_place":
        this.noise(0.12, 0.04, 3100);
        break;
      case "tape_sling":
        this.sweep(180, 720, 0.16, "square", 0.06);
        break;
      case "shield_up":
        this.chord([260, 390, 520], 0.22, 0.06);
        break;
      case "shield_break":
        this.noise(0.18, 0.09, 3600);
        this.tone(110, 0.2, "square", 0.06);
        break;
      case "stamp_tick":
        this.tone(880, 0.07, "square", 0.04);
        break;
      case "stamp_slam":
        this.sweep(170, 45, 0.28, "sawtooth", 0.1);
        break;
      case "receipts_on":
        this.sweep(440, 1320, 0.34, "sine", 0.05);
        break;
      case "freeze_cast":
        this.sweep(760, 160, 0.42, "sine", 0.08);
        break;
      case "frozen":
        this.tone(520, 0.16, "triangle", 0.06);
        break;
      case "freeze_break":
        this.noise(0.13, 0.08, 4200);
        this.chord([420, 630, 840], 0.2, 0.065);
        break;
      case "rescue_ready":
        this.chord([330, 440, 660], 0.22, 0.055);
        break;
      case "score_sealed":
        this.sweep(560, 130, 0.22, "sine", 0.06);
        break;
      case "gate_score_for":
        this.duckForBark();
        this.noise(0.16, 0.11, 1800, "barks");
        this.chord([180, 360, 540], 0.42, 0.1, "barks");
        break;
      case "gate_score_against":
        this.duckForBark();
        this.noise(0.16, 0.1, 900, "barks");
        this.sweep(260, 80, 0.4, "sawtooth", 0.09, "barks");
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
      this.master = this.context.createGain();
      this.master.gain.value = RALLY_CONFIG.audio.masterGain;
      this.master.connect(this.context.destination);
      this.groups = {
        barks: this.context.createGain(),
        sfx: this.context.createGain(),
        crowd: this.context.createGain(),
        ui: this.context.createGain(),
      };
      this.groups.barks.gain.value = RALLY_CONFIG.audio.barkGain;
      this.groups.sfx.gain.value = RALLY_CONFIG.audio.sfxGain;
      this.groups.crowd.gain.value = 0;
      this.groups.ui.gain.value = RALLY_CONFIG.audio.uiGain;
      for (const group of Object.values(this.groups)) group.connect(this.master);
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    group: AudioGroup = "sfx"
  ) {
    try {
      const context = this.getContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      const durationScale = 1 + this.currentVariation * RALLY_CONFIG.audio.durationVariation;
      const variedDuration = duration * durationScale;
      const pitchScale = 2 ** ((this.currentVariation * RALLY_CONFIG.audio.detuneCents) / 1200);
      oscillator.frequency.setValueAtTime(frequency * pitchScale, context.currentTime);
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + variedDuration);
      oscillator.connect(gain);
      gain.connect(this.groups![group]);
      oscillator.start();
      oscillator.stop(context.currentTime + variedDuration);
    } catch {
      // Audio is optional; gameplay must never depend on an AudioContext.
    }
  }

  private sweep(
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    group: AudioGroup = "sfx"
  ) {
    try {
      const context = this.getContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      const durationScale = 1 + this.currentVariation * RALLY_CONFIG.audio.durationVariation;
      const variedDuration = duration * durationScale;
      const pitchScale = 2 ** ((this.currentVariation * RALLY_CONFIG.audio.detuneCents) / 1200);
      oscillator.frequency.setValueAtTime(from * pitchScale, context.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(to * pitchScale, context.currentTime + variedDuration);
      gain.gain.setValueAtTime(volume, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + variedDuration);
      oscillator.connect(gain);
      gain.connect(this.groups![group]);
      oscillator.start();
      oscillator.stop(context.currentTime + variedDuration);
    } catch {
      // Optional enhancement.
    }
  }

  private chord(frequencies: number[], duration: number, volume: number, group: AudioGroup = "sfx") {
    for (const frequency of frequencies) {
      this.tone(frequency, duration, "triangle", volume / frequencies.length, group);
    }
  }

  private noise(duration: number, volume: number, highpass: number, group: AudioGroup = "sfx") {
    try {
      const context = this.getContext();
      const variedDuration = duration * (1 + this.currentVariation * RALLY_CONFIG.audio.durationVariation);
      const sampleCount = Math.ceil(context.sampleRate * variedDuration);
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
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + variedDuration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.groups![group]);
      source.start();
    } catch {
      // Optional enhancement.
    }
  }

  private startCrowd() {
    if (this.crowdSource) return;
    const context = this.getContext();
    const oscillator = context.createOscillator();
    oscillator.type = "sawtooth";
    oscillator.frequency.value = RALLY_CONFIG.audio.crowdBaseHz;
    oscillator.connect(this.groups!.crowd);
    oscillator.start();
    this.crowdSource = oscillator;
  }

  private setCrowdTier(tier: number) {
    const context = this.getContext();
    const gain = RALLY_CONFIG.audio.crowdGain + tier * RALLY_CONFIG.audio.crowdTierGain;
    this.groups!.crowd.gain.setTargetAtTime(gain, context.currentTime, 0.08);
  }

  private duckForBark() {
    const context = this.getContext();
    const duckScale = 10 ** (RALLY_CONFIG.audio.barkDuckDb / 20);
    const crowd = this.groups!.crowd.gain;
    crowd.cancelScheduledValues(context.currentTime);
    crowd.setValueAtTime(RALLY_CONFIG.audio.crowdGain * duckScale, context.currentTime);
    crowd.linearRampToValueAtTime(
      RALLY_CONFIG.audio.crowdGain,
      context.currentTime + RALLY_CONFIG.audio.barkDuckMs / 1000
    );
  }

  private haptic(event: RallyEvent) {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    if (event.type === "return") navigator.vibrate(RALLY_CONFIG.haptics.returnMs);
    if (event.type === "gate_score_for" || event.type === "gate_score_against") {
      navigator.vibrate(RALLY_CONFIG.haptics.scoreMs);
    }
  }
}
