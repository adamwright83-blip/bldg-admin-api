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
import { reportGoldlineLifecycleDelta } from "../testSupport/lifecycleProbe";

export type AudioCategory =
  | "ui"
  | "traversal"
  | "encounter"
  | "world"
  | "victory"
  | "failure";

export type AudioCueId =
  | "tower_charge" | "tower_launch" | "tower_impact" | "tower_debris"
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
  | "arcade_miss"
  | "mission_proximity"
  | "action_ready"
  | "captured_truth"
  | "contested_truth"
  | "closed_truth"
  | "recovery_truth"
  | "capability_available"
  | "corridor_transition"
  | "strike_hit"
  | "hostile_down"
  | "player_hurt"
  | "barrier_release"
  | "clockhead_charge"
  | "clockhead_fire"
  | "clockhead_sweep"
  | "shield_clang"
  | "player_stagger"
  | "target_reveal"
  | "dodge"
  | "clock_tick"
  | "clock_tock"
  | "bolt_hang"
  | "bolt_resume"
  | "lineblade_slash"
  | "lineblade_hit"
  | "perfect_block"
  | "return_wave"
  | "deadline_slam"
  | "phase_break"
  | "seal_break"
  | "door_creak"
  | "recoil_snap"
  | "clock_toll";

/**
 * One synthesized step. `glideTo` bends the pitch across the step (whooshes,
 * snaps); `gain` sets its loudness (default 0.18); `type: "noise"` plays
 * band-passed white noise centred on `freq` — the grit of an impact that a
 * pure oscillator cannot make.
 */
type ToneStep = {
  freq: number;
  durationMs: number;
  type?: OscillatorType | "noise";
  glideTo?: number;
  gain?: number;
};

const CUE_DEFINITIONS: Record<
  AudioCueId,
  { category: AudioCategory; steps: ToneStep[] }
> = {
  tower_charge: { category: "encounter", steps: [{ freq: 90, durationMs: 180, type: "triangle" }, { freq: 150, durationMs: 200, type: "triangle" }, { freq: 220, durationMs: 180, type: "triangle" }] },
  tower_launch: { category: "encounter", steps: [{ freq: 80, durationMs: 100, type: "sawtooth" }, { freq: 45, durationMs: 160, type: "triangle" }] },
  tower_impact: { category: "encounter", steps: [{ freq: 60, durationMs: 100, type: "square" }, { freq: 35, durationMs: 220, type: "triangle" }] },
  tower_debris: { category: "encounter", steps: [{ freq: 170, durationMs: 35, type: "triangle" }, { freq: 95, durationMs: 55, type: "triangle" }, { freq: 50, durationMs: 70, type: "triangle" }] },
  ui_tap: {
    category: "ui",
    steps: [{ freq: 720, durationMs: 40, type: "sine" }],
  },
  jump: {
    category: "traversal",
    steps: [{ freq: 420, durationMs: 70, type: "triangle" }],
  },
  land: {
    category: "traversal",
    steps: [{ freq: 180, durationMs: 60, type: "sine" }],
  },
  vault: {
    category: "traversal",
    steps: [{ freq: 520, durationMs: 90, type: "triangle" }],
  },
  portal_hum: {
    category: "world",
    steps: [{ freq: 260, durationMs: 220, type: "sine" }],
  },
  weak_point_hit: {
    category: "encounter",
    steps: [
      { freq: 900, durationMs: 50, type: "square" },
      { freq: 1200, durationMs: 40, type: "square" },
    ],
  },
  gate_unlock: {
    category: "encounter",
    steps: [
      { freq: 480, durationMs: 80, type: "triangle" },
      { freq: 720, durationMs: 100, type: "triangle" },
    ],
  },
  signal_lock: {
    category: "encounter",
    steps: [
      { freq: 660, durationMs: 90, type: "sine" },
      { freq: 880, durationMs: 120, type: "sine" },
    ],
  },
  mechanism_align: {
    category: "encounter",
    steps: [
      { freq: 540, durationMs: 70, type: "triangle" },
      { freq: 810, durationMs: 90, type: "triangle" },
    ],
  },
  mutation_path_open: {
    category: "world",
    steps: [
      { freq: 300, durationMs: 100, type: "sine" },
      { freq: 450, durationMs: 140, type: "sine" },
    ],
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
    steps: [
      { freq: 700, durationMs: 60, type: "sine" },
      { freq: 900, durationMs: 60, type: "sine" },
    ],
  },
  arcade_miss: {
    category: "failure",
    steps: [{ freq: 160, durationMs: 140, type: "sawtooth" }],
  },
  mission_proximity: {
    category: "world",
    steps: [{ freq: 392, durationMs: 55, type: "sine" }],
  },
  action_ready: {
    category: "encounter",
    steps: [
      { freq: 440, durationMs: 65, type: "triangle" },
      { freq: 587, durationMs: 85, type: "triangle" },
    ],
  },
  captured_truth: {
    category: "world",
    steps: [
      { freq: 330, durationMs: 95, type: "sine" },
      { freq: 494, durationMs: 130, type: "triangle" },
    ],
  },
  contested_truth: {
    category: "world",
    steps: [
      { freq: 277, durationMs: 85, type: "triangle" },
      { freq: 247, durationMs: 110, type: "sine" },
    ],
  },
  closed_truth: {
    category: "world",
    steps: [{ freq: 196, durationMs: 150, type: "sine" }],
  },
  recovery_truth: {
    category: "world",
    steps: [
      { freq: 294, durationMs: 90, type: "triangle" },
      { freq: 392, durationMs: 120, type: "sine" },
    ],
  },
  capability_available: {
    category: "world",
    steps: [{ freq: 659, durationMs: 90, type: "sine" }],
  },
  corridor_transition: {
    category: "traversal",
    steps: [
      { freq: 349, durationMs: 70, type: "triangle" },
      { freq: 440, durationMs: 100, type: "triangle" },
    ],
  },
  strike_hit: {
    category: "encounter",
    steps: [{ freq: 950, durationMs: 35, type: "square" }],
  },
  player_hurt: {
    category: "encounter",
    steps: [
      { freq: 260, durationMs: 90, type: "triangle" },
      { freq: 190, durationMs: 110, type: "sine" },
    ],
  },
  hostile_down: {
    category: "encounter",
    steps: [
      { freq: 620, durationMs: 70, type: "sawtooth" },
      { freq: 310, durationMs: 130, type: "sawtooth" },
      { freq: 155, durationMs: 160, type: "sine" },
    ],
  },
  barrier_release: {
    category: "encounter",
    steps: [
      { freq: 210, durationMs: 90, type: "sawtooth" },
      { freq: 520, durationMs: 130, type: "triangle" },
      { freq: 660, durationMs: 160, type: "sine" },
    ],
  },
  // Clockhead's palette is deliberately percussive and mechanical. These are
  // fictional encounter cues, not business-result sounds.
  clockhead_charge: {
    category: "encounter",
    steps: [
      { freq: 240, durationMs: 70, type: "sawtooth" },
      { freq: 360, durationMs: 70, type: "sawtooth" },
      { freq: 540, durationMs: 90, type: "triangle" },
    ],
  },
  clockhead_fire: {
    category: "encounter",
    steps: [
      { freq: 980, durationMs: 28, type: "square" },
      { freq: 470, durationMs: 62, type: "sawtooth" },
    ],
  },
  clockhead_sweep: {
    category: "encounter",
    steps: [
      { freq: 190, durationMs: 120, type: "sawtooth" },
      { freq: 280, durationMs: 120, type: "triangle" },
    ],
  },
  shield_clang: {
    category: "encounter",
    steps: [
      { freq: 1320, durationMs: 24, type: "square" },
      { freq: 720, durationMs: 62, type: "triangle" },
      { freq: 330, durationMs: 82, type: "sine" },
    ],
  },
  player_stagger: {
    category: "encounter",
    steps: [
      { freq: 230, durationMs: 78, type: "sawtooth" },
      { freq: 145, durationMs: 120, type: "sine" },
    ],
  },
  target_reveal: {
    category: "world",
    steps: [
      { freq: 205, durationMs: 80, type: "sawtooth" },
      { freq: 520, durationMs: 95, type: "triangle" },
      { freq: 780, durationMs: 105, type: "triangle" },
      { freq: 1040, durationMs: 150, type: "sine" },
    ],
  },
  /** A real flick-evade had no sound at all. Fast descending sweep — a whoosh, not an impact. */
  dodge: {
    category: "traversal",
    steps: [
      { freq: 920, durationMs: 30, type: "sawtooth" },
      { freq: 340, durationMs: 55, type: "sawtooth" },
    ],
  },
  // Colosseum. Every cue below is fiction: encounter, world, traversal or
  // failure — never "victory", which stays reserved for an authoritative
  // business capture. Beating Clockhead must not sound like closing a sale.
  /** Clockhead's heartbeat: the tempo rises each hour. */
  clock_tick: {
    category: "encounter",
    steps: [{ freq: 3100, durationMs: 12, type: "square", gain: 0.05 }],
  },
  clock_tock: {
    category: "encounter",
    steps: [{ freq: 2050, durationMs: 14, type: "square", gain: 0.045 }],
  },
  /** The Aimed Bolt stops mid-air and trembles. */
  bolt_hang: {
    category: "encounter",
    steps: [{ freq: 700, durationMs: 220, type: "triangle", glideTo: 660, gain: 0.07 }],
  },
  /** …then suddenly resumes. */
  bolt_resume: {
    category: "encounter",
    steps: [
      { freq: 1600, durationMs: 16, type: "square", gain: 0.1 },
      { freq: 520, durationMs: 90, type: "sawtooth", glideTo: 170, gain: 0.12 },
    ],
  },
  /** A luminous edge through space, not steel on steel. */
  lineblade_slash: {
    category: "encounter",
    steps: [
      { freq: 1800, durationMs: 95, type: "noise", glideTo: 5200, gain: 0.14 },
      { freq: 1320, durationMs: 70, type: "triangle", glideTo: 1480, gain: 0.05 },
    ],
  },
  lineblade_hit: {
    category: "encounter",
    steps: [
      { freq: 180, durationMs: 36, type: "square", gain: 0.2 },
      { freq: 900, durationMs: 80, type: "noise", glideTo: 300, gain: 0.2 },
      { freq: 1560, durationMs: 160, type: "triangle", glideTo: 1500, gain: 0.07 },
    ],
  },
  perfect_block: {
    category: "encounter",
    steps: [
      { freq: 1760, durationMs: 18, type: "square", gain: 0.12 },
      { freq: 2640, durationMs: 200, type: "triangle", glideTo: 2600, gain: 0.09 },
    ],
  },
  return_wave: {
    category: "encounter",
    steps: [
      { freq: 140, durationMs: 220, type: "sawtooth", glideTo: 620, gain: 0.12 },
      { freq: 420, durationMs: 260, type: "noise", glideTo: 110, gain: 0.22 },
      { freq: 68, durationMs: 320, type: "sine", gain: 0.2 },
    ],
  },
  deadline_slam: {
    category: "encounter",
    steps: [
      { freq: 82, durationMs: 60, type: "square", gain: 0.2 },
      { freq: 260, durationMs: 220, type: "noise", glideTo: 70, gain: 0.2 },
    ],
  },
  /** Between hours: something enormous and bronze is struck once. */
  phase_break: {
    category: "encounter",
    steps: [
      { freq: 98, durationMs: 80, type: "sine", gain: 0.2 },
      { freq: 147, durationMs: 650, type: "triangle", glideTo: 139, gain: 0.15 },
    ],
  },
  /**
   * A seal on his projection breaks because a real visit was recorded. It
   * presents an authoritative fact, so it is "world", like captured_truth —
   * restrained, and still not a victory.
   */
  seal_break: {
    category: "world",
    steps: [
      { freq: 1250, durationMs: 18, type: "square", gain: 0.1 },
      { freq: 2400, durationMs: 180, type: "noise", glideTo: 800, gain: 0.14 },
      { freq: 988, durationMs: 320, type: "triangle", gain: 0.08 },
    ],
  },
  door_creak: {
    category: "world",
    steps: [{ freq: 105, durationMs: 460, type: "sawtooth", glideTo: 150, gain: 0.045 }],
  },
  /** The Line snaps taut and yanks her back. */
  recoil_snap: {
    category: "failure",
    steps: [
      { freq: 900, durationMs: 200, type: "sawtooth", glideTo: 110, gain: 0.11 },
      { freq: 320, durationMs: 140, type: "noise", glideTo: 90, gain: 0.14 },
    ],
  },
  /** The correct time arrives: a single bell. Fiction's resolution, not a sale. */
  clock_toll: {
    category: "world",
    steps: [
      { freq: 880, durationMs: 50, type: "sine", gain: 0.12 },
      { freq: 1318, durationMs: 700, type: "triangle", glideTo: 1311, gain: 0.11 },
      { freq: 659, durationMs: 1100, type: "sine", gain: 0.1 },
    ],
  },
};

const STORAGE_KEY = "goldline:audio:muted";

export class AudioManager {
  private ctx: AudioContext | null = null;
  private muted: boolean;
  private resumeBound = false;
  private playedTokens = new Set<string>();

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
    target.addEventListener("pointerdown", resume, {
      once: true,
      passive: true,
    });
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) this.ctx = new Ctor();
    return this.ctx;
  }

  play(cue: AudioCueId) {
    if (
      typeof window !== "undefined" &&
      import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
    ) {
      const w = window as unknown as { __goldlineAudioLog?: AudioCueId[] };
      (w.__goldlineAudioLog ??= []).push(cue);
    }
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === "suspended") return;
    const definition = CUE_DEFINITIONS[cue];
    let cursor = ctx.currentTime;
    for (const step of definition.steps) {
      const end = cursor + step.durationMs / 1000;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.exponentialRampToValueAtTime(step.gain ?? 0.18, cursor + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      gain.connect(ctx.destination);
      if (step.type === "noise") {
        const source = ctx.createBufferSource();
        source.buffer = this.noiseBuffer(ctx);
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.Q.value = 1.4;
        band.frequency.setValueAtTime(step.freq, cursor);
        if (step.glideTo) band.frequency.exponentialRampToValueAtTime(step.glideTo, end);
        source.connect(band).connect(gain);
        source.start(cursor);
        source.stop(end + 0.02);
      } else {
        const osc = ctx.createOscillator();
        osc.type = step.type ?? "sine";
        osc.frequency.setValueAtTime(step.freq, cursor);
        if (step.glideTo) osc.frequency.exponentialRampToValueAtTime(step.glideTo, end);
        osc.connect(gain);
        osc.start(cursor);
        osc.stop(end + 0.02);
      }
      cursor = end;
    }
  }

  private noise: AudioBuffer | null = null;

  /** One second of white noise, generated once and reused by every noise step. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise && this.noise.sampleRate === ctx.sampleRate) return this.noise;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  /** Prevents refetch/resume from replaying the same semantic cue. */
  playOnce(cue: AudioCueId, token: string) {
    const key = `${cue}:${token}`;
    if (this.playedTokens.has(key)) return;
    this.playedTokens.add(key);
    if (this.playedTokens.size > 128) {
      const oldest = this.playedTokens.values().next().value;
      if (oldest) this.playedTokens.delete(oldest);
    }
    this.play(cue);
  }

  /** Stops accepting new audio while backgrounded; resumes on foreground. */
  setBackgrounded(backgrounded: boolean) {
    if (!this.ctx) return;
    if (backgrounded) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /**
   * One symmetric lifecycle binding per mounted Goldline world. CALL/VISIT
   * handoffs suspend safely; pageshow/focus resume the context but never
   * replay a semantic cue because playback is explicit and token-deduped.
   */
  bindLifecycle(
    documentTarget: Document = document,
    windowTarget: Window = window
  ): () => void {
    const onVisibility = () => this.setBackgrounded(documentTarget.hidden);
    const onPageHide = () => this.setBackgrounded(true);
    const onResume = () => this.setBackgrounded(false);
    documentTarget.addEventListener("visibilitychange", onVisibility);
    windowTarget.addEventListener("pagehide", onPageHide);
    windowTarget.addEventListener("pageshow", onResume);
    windowTarget.addEventListener("focus", onResume);
    reportGoldlineLifecycleDelta("audioLifecycleBinding", 1);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      documentTarget.removeEventListener("visibilitychange", onVisibility);
      windowTarget.removeEventListener("pagehide", onPageHide);
      windowTarget.removeEventListener("pageshow", onResume);
      windowTarget.removeEventListener("focus", onResume);
      reportGoldlineLifecycleDelta("audioLifecycleBinding", -1);
    };
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
