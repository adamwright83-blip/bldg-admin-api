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
  | "clockface_impact"
  | "clockhead_howl"
  | "clockhead_roar"
  | "borrowed_minute"
  | "seal_lock"
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
 *
 * Steps play one after another unless they give `atMs`: then they start that
 * long after the cue does, layered over the others. An impact is several
 * sounds at once (a crack, a ring, a thump), and a voice is several
 * resonances at once, so the richer cues are built from layers.
 */
export type ToneStep = {
  freq: number;
  durationMs: number;
  type?: OscillatorType | "noise";
  glideTo?: number;
  gain?: number;
  atMs?: number;
  /** Time to reach full gain (default 10ms). Near the whole step, it swells like reversed tape. */
  attackMs?: number;
  /** Fraction of the step held at full gain before it decays. */
  sustain?: number;
  /** Pitch passes through `to` at fraction `at` of the step on its way to `glideTo`. */
  bend?: { to: number; at: number };
  /** A tremble in pitch: `rate` Hz, `depth` Hz either side. */
  vibrato?: { rate: number; depth: number };
  /** Shapes an oscillator the way a throat or a cabinet would. */
  filter?: { type: BiquadFilterType; freq: number; q?: number; glideTo?: number };
};

export type PlayOptions = {
  /** Multiplies every frequency in the cue — small variations keep repeats alive. */
  pitch?: number;
  /** Start the cue this long from now. */
  delayMs?: number;
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
  /**
   * The Lineblade biting into his face: a hard click and a burst of bright
   * grit, the thump of the whole dial taking the blow, then the bronze rings —
   * inharmonic partials, like struck bell-metal — with the dial glass
   * chittering on top.
   */
  clockface_impact: {
    category: "encounter",
    steps: [
      { atMs: 0, freq: 3400, durationMs: 9, type: "square", gain: 0.24, attackMs: 1 },
      { atMs: 0, freq: 5200, durationMs: 80, type: "noise", glideTo: 1500, gain: 0.68, attackMs: 1 },
      { atMs: 0, freq: 170, durationMs: 150, type: "sine", glideTo: 58, gain: 0.52, attackMs: 1 },
      { atMs: 2, freq: 1187, durationMs: 340, type: "triangle", glideTo: 1172, gain: 0.2, attackMs: 2 },
      { atMs: 2, freq: 1811, durationMs: 250, type: "sine", gain: 0.14, attackMs: 2 },
      { atMs: 2, freq: 2903, durationMs: 150, type: "sine", gain: 0.1, attackMs: 1 },
      { atMs: 2, freq: 4271, durationMs: 90, type: "sine", gain: 0.06, attackMs: 1 },
      { atMs: 14, freq: 6400, durationMs: 50, type: "noise", gain: 0.16, attackMs: 1 },
    ],
  },
  /**
   * Clockhead, hurt: a clockwork throat. Two detuned, formant-filtered voices
   * yelp up and fall away under a fast tremble, over a growl and the grind
   * of his gears. Played a beat after the impact, never instead of it.
   */
  clockhead_howl: {
    category: "encounter",
    steps: [
      { atMs: 0, freq: 247, durationMs: 520, type: "sawtooth", bend: { to: 294, at: 0.16 }, glideTo: 156, gain: 0.204, attackMs: 30, sustain: 0.35, vibrato: { rate: 13, depth: 11 }, filter: { type: "bandpass", freq: 950, q: 1.6, glideTo: 620 } },
      { atMs: 0, freq: 262, durationMs: 500, type: "sawtooth", bend: { to: 311, at: 0.16 }, glideTo: 165, gain: 0.136, attackMs: 30, sustain: 0.3, vibrato: { rate: 17, depth: 9 }, filter: { type: "bandpass", freq: 2350, q: 2.8, glideTo: 1500 } },
      { atMs: 0, freq: 82, durationMs: 440, type: "square", bend: { to: 98, at: 0.16 }, glideTo: 58, gain: 0.085, attackMs: 40, sustain: 0.3, vibrato: { rate: 31, depth: 6 }, filter: { type: "lowpass", freq: 520 } },
      { atMs: 10, freq: 480, durationMs: 420, type: "noise", glideTo: 300, gain: 0.119, attackMs: 25, sustain: 0.25 },
    ],
  },
  /** The finisher, and "NOT YET!": the howl at full size, every loose part of him rattling. */
  clockhead_roar: {
    category: "encounter",
    steps: [
      { atMs: 0, freq: 175, durationMs: 900, type: "sawtooth", bend: { to: 247, at: 0.24 }, glideTo: 104, gain: 0.195, attackMs: 70, sustain: 0.5, vibrato: { rate: 9, depth: 10 }, filter: { type: "bandpass", freq: 850, q: 1.5, glideTo: 540 } },
      { atMs: 0, freq: 185, durationMs: 880, type: "sawtooth", bend: { to: 262, at: 0.24 }, glideTo: 110, gain: 0.135, attackMs: 70, sustain: 0.5, vibrato: { rate: 12.5, depth: 13 }, filter: { type: "bandpass", freq: 2100, q: 2.4, glideTo: 1250 } },
      { atMs: 0, freq: 65, durationMs: 860, type: "square", bend: { to: 87, at: 0.24 }, glideTo: 49, gain: 0.09, attackMs: 80, sustain: 0.45, vibrato: { rate: 29, depth: 5 }, filter: { type: "lowpass", freq: 480 } },
      { atMs: 0, freq: 620, durationMs: 820, type: "noise", glideTo: 240, gain: 0.12, attackMs: 90, sustain: 0.35 },
      { atMs: 60, freq: 760, durationMs: 620, type: "triangle", gain: 0.045, attackMs: 40, sustain: 0.3, vibrato: { rate: 23, depth: 42 } },
    ],
  },
  /**
   * He spends a Borrowed Minute on himself: sound sucked backwards and cut
   * dead, ticks running backwards faster and faster, then the minute is spent.
   */
  borrowed_minute: {
    category: "encounter",
    steps: [
      { atMs: 0, freq: 700, durationMs: 1000, type: "noise", glideTo: 3800, gain: 0.13, attackMs: 950 },
      { atMs: 0, freq: 196, durationMs: 1000, type: "sine", glideTo: 784, gain: 0.07, attackMs: 940 },
      ...[0, 130, 250, 355, 450, 535, 610, 675, 730, 778, 820, 856, 888, 916, 940].map(atMs => ({
        atMs,
        freq: 2600,
        durationMs: 11,
        type: "square" as const,
        gain: 0.05,
        attackMs: 1,
      })),
      { atMs: 1000, freq: 130, durationMs: 180, type: "sine", glideTo: 62, gain: 0.22, attackMs: 1 },
      { atMs: 1000, freq: 900, durationMs: 90, type: "noise", glideTo: 300, gain: 0.16, attackMs: 1 },
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
  /**
   * A seal slamming shut on him in the first-entry prologue. That is fiction
   * (he locks himself away), so it is an encounter cue — unlike seal_break,
   * which shows a real recorded outcome.
   */
  seal_lock: {
    category: "encounter",
    steps: [
      { atMs: 0, freq: 125, durationMs: 170, type: "sine", glideTo: 52, gain: 0.36, attackMs: 1 },
      { atMs: 0, freq: 1900, durationMs: 60, type: "noise", glideTo: 600, gain: 0.27, attackMs: 1 },
      { atMs: 0, freq: 430, durationMs: 26, type: "square", gain: 0.105, attackMs: 1 },
      { atMs: 4, freq: 988, durationMs: 220, type: "triangle", gain: 0.105, attackMs: 2 },
      { atMs: 4, freq: 1486, durationMs: 160, type: "sine", gain: 0.06, attackMs: 2 },
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

/**
 * Gestures that can unlock audio. Browsers differ on which count — on touch
 * screens a pointerdown is not a user activation, a pointerup/touchend/click
 * is — so listen for all of them and stop only once audio is really running.
 */
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

/**
 * Schedule one cue onto any Web Audio graph. `AudioManager.play` uses it for
 * live sound; an OfflineAudioContext can use it to render a cue to a file.
 */
export function scheduleCue(
  ctx: BaseAudioContext,
  destination: AudioNode,
  cue: AudioCueId,
  options: PlayOptions & { startAt?: number; noise?: AudioBuffer } = {}
) {
  const pitch = options.pitch ?? 1;
  const t0 = options.startAt ?? ctx.currentTime + Math.max(0, options.delayMs ?? 0) / 1000;
  let cursor = t0;
  for (const step of CUE_DEFINITIONS[cue].steps) {
    const start = step.atMs != null ? t0 + step.atMs / 1000 : cursor;
    const duration = step.durationMs / 1000;
    const end = start + duration;
    if (step.atMs == null) cursor = end;

    const peak = step.gain ?? 0.18;
    const attack = Math.min(duration * 0.95, (step.attackMs ?? 10) / 1000);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    if (step.sustain) gain.gain.setValueAtTime(peak, start + Math.max(attack, duration * step.sustain));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(destination);

    if (step.type === "noise") {
      const source = ctx.createBufferSource();
      source.buffer = options.noise ?? noiseBufferFor(ctx);
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.4;
      band.frequency.setValueAtTime(step.freq * pitch, start);
      if (step.glideTo) band.frequency.exponentialRampToValueAtTime(step.glideTo * pitch, end);
      source.connect(band).connect(gain);
      source.start(start);
      source.stop(end + 0.02);
      continue;
    }

    const osc = ctx.createOscillator();
    osc.type = step.type ?? "sine";
    osc.frequency.setValueAtTime(step.freq * pitch, start);
    if (step.bend) osc.frequency.exponentialRampToValueAtTime(step.bend.to * pitch, start + duration * step.bend.at);
    if (step.glideTo) osc.frequency.exponentialRampToValueAtTime(step.glideTo * pitch, end);
    if (step.vibrato) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = step.vibrato.rate;
      depth.gain.value = step.vibrato.depth * pitch;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(end + 0.02);
    }
    if (step.filter) {
      const filter = ctx.createBiquadFilter();
      filter.type = step.filter.type;
      filter.Q.value = step.filter.q ?? 1;
      filter.frequency.setValueAtTime(step.filter.freq * pitch, start);
      if (step.filter.glideTo) filter.frequency.exponentialRampToValueAtTime(step.filter.glideTo * pitch, end);
      osc.connect(filter).connect(gain);
    } else {
      osc.connect(gain);
    }
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

/**
 * The master bus in front of the speakers. Cues now layer (an impact and his
 * howl land together, over the ticking, and a fast combo stacks them), and
 * summed layers must never clip: a gentle compressor rides the loud moments,
 * then a soft clipper — linear below 70% — rounds off anything it let past.
 * Single cues pass through untouched.
 */
export function createMasterBus(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -6;
  compressor.knee.value = 6;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.16;
  const clipper = ctx.createWaveShaper();
  clipper.curve = SOFT_CLIP;
  clipper.oversample = "2x";
  compressor.connect(clipper);
  return { input: compressor, output: clipper };
}

const SOFT_CLIP = (() => {
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i += 1) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    curve[i] = magnitude <= 0.7 ? x : Math.sign(x) * (0.7 + 0.3 * Math.tanh((magnitude - 0.7) / 0.3));
  }
  return curve;
})();

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise per context, generated once and reused by every noise step. */
function noiseBufferFor(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: AudioNode | null = null;
  private muted: boolean;
  private unlockTarget: EventTarget | null = null;
  /** A resume() is in flight from a gesture: cues queue and play the moment it lands. */
  private resumePending = false;
  private gestureTarget: EventTarget | null = null;
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

  /** Whether sound can actually be heard right now (unmuted and unlocked). */
  get isRunning(): boolean {
    return !this.muted && this.ctx?.state === "running";
  }

  /**
   * Call from the mute toggle's click handler. Unmuting is itself a user
   * gesture, so it creates or resumes the context right there — a player
   * who starts muted and taps "sound on" hears the very next cue.
   */
  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      window.localStorage.setItem(STORAGE_KEY, muted ? "1" : "0");
    } catch {
      // Best-effort only; audio still functions without persisted preference.
    }
    if (muted) {
      // Nothing can play while muted; let the device rest its audio hardware.
      void this.ctx?.suspend().catch(() => undefined);
    } else {
      this.unlock();
    }
  }

  /**
   * Arm audio to unlock on the next user gesture (autoplay policy). The
   * listeners stay armed until the context is actually running: a gesture
   * made while muted, or one the browser does not count as an activation,
   * does not use the unlock up.
   */
  primeOnGesture(target: EventTarget = window) {
    if (typeof window === "undefined") return;
    this.gestureTarget = target;
    if (this.unlockTarget || this.ctx?.state === "running") return;
    this.unlockTarget = target;
    for (const type of UNLOCK_EVENTS) {
      target.addEventListener(type, this.onUnlockGesture, { capture: true, passive: true });
    }
  }

  private readonly onUnlockGesture = () => this.unlock();

  private disarmUnlock() {
    const target = this.unlockTarget;
    if (!target) return;
    for (const type of UNLOCK_EVENTS) {
      target.removeEventListener(type, this.onUnlockGesture, { capture: true });
    }
    this.unlockTarget = null;
  }

  /** Create or resume the context. Meant for inside a user gesture; safe to repeat. */
  unlock() {
    if (this.muted || typeof window === "undefined") return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === "running") {
      this.disarmUnlock();
      return;
    }
    // iOS Safari: starting any buffer inside the gesture opens the output.
    try {
      const kick = ctx.createBufferSource();
      kick.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      kick.connect(ctx.destination);
      kick.start(0);
    } catch {
      // Best effort; resume() below is the standard path.
    }
    this.resumePending = true;
    void ctx
      .resume()
      .then(() => {
        if (ctx.state === "running") this.disarmUnlock();
      })
      .catch(() => undefined)
      .finally(() => {
        this.resumePending = false;
      });
  }

  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    if (!this.ctx) {
      const ctx = new Ctor();
      this.ctx = ctx;
      // If the OS takes audio away (a call, another app), the next gesture
      // brings it back.
      ctx.addEventListener?.("statechange", () => {
        if (ctx.state !== "running" && !this.muted && this.gestureTarget) {
          this.primeOnGesture(this.gestureTarget);
        }
      });
    }
    return this.ctx;
  }

  private output(ctx: AudioContext): AudioNode {
    if (this.master) return this.master;
    try {
      const bus = createMasterBus(ctx);
      bus.output.connect(ctx.destination);
      this.master = bus.input;
    } catch {
      this.master = ctx.destination;
    }
    return this.master;
  }

  play(cue: AudioCueId, options: PlayOptions = {}) {
    if (
      typeof window !== "undefined" &&
      import.meta.env.VITE_GOLDLINE_TEST_HARNESS === "1"
    ) {
      const w = window as unknown as { __goldlineAudioLog?: AudioCueId[] };
      (w.__goldlineAudioLog ??= []).push(cue);
    }
    if (this.muted) return;
    const ctx = this.ensureContext();
    // The tap that unlocks audio is usually the tap that asked for this cue:
    // while its resume() is landing, schedule anyway — it plays on resume.
    if (!ctx || (ctx.state !== "running" && !this.resumePending)) return;
    scheduleCue(ctx, this.output(ctx), cue, options);
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
    if (backgrounded) void this.ctx.suspend().catch(() => undefined);
    else if (!this.muted) void this.ctx.resume().catch(() => undefined);
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

/** Every cue id, for checks that scan source for cue names. */
export const AUDIO_CUE_IDS = Object.keys(CUE_DEFINITIONS) as AudioCueId[];

export function cueCategory(cue: AudioCueId): AudioCategory {
  return CUE_DEFINITIONS[cue].category;
}
