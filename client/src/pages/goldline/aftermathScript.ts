/**
 * After Clockhead falls: LEVEL COMPLETE, then the arena goes quiet — and one
 * of his handless dials, which was never a clock, crackles to life.
 *
 * Canon (WORLD_BIBLE §11, §12): the Seven are never revealed mechanically —
 * no boss dies, no prison door opens with Rook conveniently inside. Rook was
 * rumoured captured; he has been running an illegal communications network
 * through the Republic's own clocks the whole time. He is a former infamous
 * liar who, since the Sunder, cannot speak a direct lie — his voice simply
 * fails — and it has not reduced how much he talks. He works inside truth,
 * which is not the same as telling Trailblazer everything.
 *
 * Presentation data only: nothing here can record anything.
 */
import { SPEAKER_DIAL } from "./ClockheadConstruct";
import { CLOCKHEAD_CENTER, type StagePoint } from "./colosseumStage";

export type RadioSpeaker = "unknown" | "rook" | "trailblazer";

export type RadioLine = {
  speaker: RadioSpeaker;
  text: string;
  /**
   * The Sunder: he starts a direct lie and the static takes it. This is what
   * he says instead — the truth, grudgingly.
   */
  lieFails?: string;
};

export const ROOK_ON_THE_LINE: readonly RadioLine[] = [
  { speaker: "unknown", text: "You took your time." },
  { speaker: "trailblazer", text: "…Rook?" },
  { speaker: "rook", text: "Everyone says I was captured. I let them say it." },
  {
    speaker: "rook",
    text: "Every clock in the Republic has a speaker. He never checked who else was on the line.",
  },
  { speaker: "rook", text: "I was never worried about y—", lieFails: "…I was a little worried." },
  { speaker: "trailblazer", text: "Anything else I should know?" },
  { speaker: "rook", text: "Yes." },
];

export const SPEAKER_LABELS: Record<RadioSpeaker, string> = {
  unknown: "UNKNOWN FREQUENCY",
  rook: "ROOK",
  trailblazer: "TRAILBLAZER",
};

export const AFTERMATH_TIMING = {
  /** LEVEL COMPLETE lands with the bell. */
  stampAtMs: 380,
  statsAtMs: 950,
  /** Tapping may cut the stamp short once it has landed. */
  stampSkippableAtMs: 900,
  stampOutMs: 3300,
  /** The arena goes quiet, then a dead speaker crackles. */
  crackleAtMs: 4300,
  firstLineAtMs: 4900,
  typeMsPerChar: 22,
  readMsPerChar: 30,
  minReadMs: 1000,
  /** How long the static holds a failed lie before he tries the truth. */
  lieStaticMs: 700,
  partyAfterLastLineMs: 1100,
} as const;

/** Time to type a line out. */
export function typeMs(text: string): number {
  return text.length * AFTERMATH_TIMING.typeMsPerChar;
}

/** How long a line stays up once typed, so it can be read. */
export function readMs(text: string): number {
  return Math.max(AFTERMATH_TIMING.minReadMs, text.length * AFTERMATH_TIMING.readMsPerChar);
}

/** A line's whole duration, including a failed lie and what replaces it. */
export function lineDurationMs(line: RadioLine): number {
  if (!line.lieFails) return typeMs(line.text) + readMs(line.text);
  return typeMs(line.text) + AFTERMATH_TIMING.lieStaticMs + typeMs(line.lieFails) + readMs(line.lieFails);
}

/** Where the speaking dial sits on the stage when he is standing, for effects. */
export function speakerPoint(center: StagePoint = CLOCKHEAD_CENTER): StagePoint {
  // The construct is 60 stage units across a 240-unit viewBox.
  return { x: center.x + SPEAKER_DIAL.x / 4, y: center.y + SPEAKER_DIAL.y / 4 };
}
