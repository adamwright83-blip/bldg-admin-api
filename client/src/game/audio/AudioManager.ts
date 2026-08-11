/**
 * Centralized, compact audio manager.
 *
 * All sound is synthesized at runtime with the Web Audio API — short
 * oscillator envelopes, no binary assets, no copyrighted or licensed music.
 * This keeps the audio system at effectively zero bundle cost while still
 * giving each game moment a distinct cue.
 *
 * A single shared AudioContext is created lazily and resumed on the first
 * user gesture (autoplay policies block audio before interaction). Nothing
 * here plays audio during a live phone call — callers are responsible for
 * checking `isCallActive` before invoking `play()`, and `AudioManager` itself
 * exposes no call-aware branching so that rule stays visible at the call site.
 */

export type AudioCategory =
  | "ui"
  | "traversal"
  | "encounter"
  | "world"
  | "victory"
  | "failure";

export type AudioCueId =
  | "ui_tap"
  | "jump"
  | "land"
  | "vault"
  | "portal_hum"
  | "weak_point_hit"
  | "gate_unlock"
  | "signal_lock"
  | "mechanism_align"
  | "mutation_path_open"
  | "victory_flag"
  | "scout_discovery"
  | "arcade_miss";

type ToneStep = { freq: number; durationMs: number; type?: OscillatorType };

const CUE_DEFINITIONS: Record<AudioCueId, { category: AudioCategory; steps: ToneStep[] }> = {
  ui_tap: { category: "ui", steps: [{ freq: 720, durationMs: 40, type: "sine" }] },
  jump: { category: "traversal", steps: [{ freq: 420, durationMs: 70, type: "triangle" }] },
  land: { category: "traversal", steps: [{ freq: 180, durationMs: 60, type: "sine" }] },
  vault: { category: "traversal", steps: [{ freq: 520, durationMs: 90, type: "triangle" }] },
  portal_hum: { category: "world", steps: [{ freq: 260, durationMs: 220, type: "sine" }] },
  weak_point_hit: {
    category: "encounter",
    steps: [{ freq: 900, durationMs: 50, type: "square" }, { freq: 1200, durationMs: 40, type: "square" }],
  },
  gate_unlock: {
    category: "encounter",
    steps: [{ freq: 480, durationMs: 80, type: "triangle" }, { freq: 720, durationMs: 100, type: "triangle" }],
  },
  signal_lock: {
    category: "encounter",
    steps: [{ freq: 660, durationMs: 90, type: "sine" }, { freq: 880, durationMs: 120, type: "sine" }],
  },
  mechanism_align: {
    category: "encounter",
    steps: [{ freq: 540, durationMs: 70, type: "triangle" }, { freq: 810, durationMs: 90, type: "triangle" }],
  },
  mutation_path_open: {
    category: "world",
    steps: [{ freq: 300, durationMs: 100, type: "sine" }, { freq: 450, durationMs: 140, type: "sine" }],
  },
  victory_flag: {
    category: "victory",
    steps: [
      { freq: 523, durationMs: 100, type: "triangle" },
      { freq: 659, durationMs: 100, type: "triangle" },
      { freq: 784, durationMs: 180, type: "triangle" },
    ],
  },
  scout_discovery: {
    category: "world",
    steps: [{ freq: 700, durationMs: 60, type: "sine" }, { freq: 900, durationMs: 60, type: "sine" }],
  },
  arcade_miss: { category: "failure", steps: [{ freq: 160, durationMs: 140, type: "sawtooth" }] },
};

const STORAGE_KEY = "goldline:audio:muted";

export class AudioManager {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private resumeBound = false;

  constructor() {
    this.muted = AudioManager.readStoredMute();
  }

  private static readStoredMute(): boolean {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // Best-effort only; audio still functions without persisted preference.
    }
  }

  /** Call from a user-gesture handler (pointerdown/click) to satisfy autoplay policy. */
  primeOnGesture(target: EventTarget = window) {
    if (this.resumeBound || typeof window === "undefined") return;
    this.resumeBound = true;
    const resume = () => {
      this.ensureContext();
      void this.ctx?.resume();
    };
    target.addEventListener("pointerdown", resume, { once: true, passive: true });
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) this.ctx = new Ctor();
    return this.ctx;
  }

  play(cue: AudioCueId) {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === "suspended") return;
    const definition = CUE_DEFINITIONS[cue];
    let cursor = ctx.currentTime;
    for (const step of definition.steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = step.type ?? "sine";
      osc.frequency.setValueAtTime(step.freq, cursor);
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(0.18, cursor + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, cursor + step.durationMs / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start(cursor);
      osc.stop(cursor + step.durationMs / 1000 + 0.02);
      cursor += step.durationMs / 1000;
    }
  }

  /** Stops accepting new audio while backgrounded; resumes on foreground. */
  setBackgrounded(backgrounded: boolean) {
    if (!this.ctx) return;
    if (backgrounded) void this.ctx.suspend();
    else void this.ctx.resume();
  }
}

let sharedInstance: AudioManager | null = null;

export function getAudioManager(): AudioManager {
  if (!sharedInstance) sharedInstance = new AudioManager();
  return sharedInstance;
}

export function cueCategory(cue: AudioCueId): AudioCategory {
  return CUE_DEFINITIONS[cue].category;
}
