/**
 * The visual and motion rulebook, in a form that can be tested.
 *
 * WHY THIS IS CODE AND NOT ONLY A DOCUMENT
 *
 * A rulebook nobody can run is a rulebook that drifts. The prose version lives
 * at `docs/goldline/VISUAL_MOTION_RULEBOOK.md` and carries the things prose is
 * better at — image-generation prompts, the asset acceptance checklist, the
 * reasoning. What lives HERE is the part a test can enforce, so that "the city
 * is daylight" and "motion is compositor-only" stop being promises and become
 * failing builds.
 *
 * WHAT THIS DOES NOT REDEFINE
 *
 * `docs/goldline/WORLD_BIBLE.md` §3 already sets the presentation law — cinematic
 * character-forward action-adventure, the phone as a camera into a larger stage,
 * never a flat 2D game board. That is canon and is referenced, not restated. This
 * covers what the bible predates: the daylight reversal and the window states the
 * real business drives.
 */

/**
 * The daylight palette.
 *
 * The operator works out of a van in LA sun. A dark screen is not a taste
 * question there — it is unreadable, and an unreadable tool stops being opened.
 * Dark TEXT and dark SHADOWS remain correct and necessary; it is dark GROUNDS
 * that are banned.
 */
export const DAYLIGHT_PALETTE = {
  "--lc-day-sky": "#dfeefb",
  "--lc-day-ground": "#f6efe0",
  "--lc-day-ink": "#24354d",
  "--lc-day-ink-muted": "#5d6b80",
  "--lc-day-label": "#fffdf2f2",
  "--lc-day-edge": "#d8c9a8",
  "--lc-window-gold": "#ffc94d",
  "--lc-ribbon-gold": "#ffb01f",
  "--lc-panel": "#fffdf6",
} as const;

/**
 * Relative luminance below which a background reads as dark rather than as a
 * shade of daylight. Cream sits near 0.95; the slate this replaced near 0.02.
 */
export const DAYLIGHT_LUMINANCE_FLOOR = 0.45;

/**
 * The large surfaces the operator reads the city against.
 *
 * A deliberately NAMED list. Asserting every background in the stylesheet would
 * reject legitimate shadows, architectural detail and the intentionally dark
 * Tower Wars arena, while still missing the ways a surface actually goes dark in
 * practice — imagery, gradients, overlays. Rendered screenshots cover those.
 */
export const DESIGNATED_DAYLIGHT_SURFACES = [
  ".pwc-world",
  ".cr-world-geography-surface",
  ".cr-day-phase",
  ".pwc-page .pwc-metric",
] as const;

/** Surfaces that are meant to be dark, so nobody "fixes" them later. */
export const INTENTIONALLY_DARK_SURFACES = [
  ".tw-page",
  ".tw-arena",
  ".tw-cold-world",
] as const;

/**
 * Window states, and the truth each one is allowed to assert.
 *
 * This is the firewall expressed as appearance. `sustainedWarmth` is reachable
 * from exactly one state, and outreach is not it.
 */
export const WINDOW_STATES = {
  warm: {
    meaning: "This customer is active — ordering within cadence, or has an order in flight.",
    earnedBy: "order evidence",
    sustainedWarmth: true,
    motion: "gentle shimmer",
  },
  quiet: {
    meaning: "This customer has gone dormant. The building stays sunlit; the shimmer stops.",
    earnedBy: "lapsed cadence",
    sustainedWarmth: false,
    motion: "still",
  },
  stirring: {
    meaning: "Outreach was sent recently. The customer is STILL dormant.",
    earnedBy: "attested outreach",
    sustainedWarmth: false,
    motion: "transient gold ribbon, expiring on the event's own clock",
  },
  unknown: {
    meaning: "No order history. Not dormant, not active — excluded from the lit share.",
    earnedBy: "absence of evidence",
    sustainedWarmth: false,
    motion: "flat, no shimmer",
  },
} as const;
export type WindowState = keyof typeof WINDOW_STATES;

/**
 * Motion budget.
 *
 * Compositor-only because these pages animate continuously on a phone in a van;
 * anything that triggers layout or paint per frame costs battery and drops
 * frames on exactly the hardware the operator actually has.
 */
export const MOTION_CANON = {
  /** The only properties a keyframe may animate. */
  animatableProperties: ["opacity", "transform", "filter"] as const,
  /** Ambient loops must be slow enough to read as life, not as alarm. */
  minAmbientLoopMs: 2000,
  /** A reaction to a real event must resolve quickly. */
  maxReactionMs: 1200,
  /** Every animation must have a reduced-motion fallback that loses no meaning. */
  reducedMotionFallbackRequired: true,
} as const;

/**
 * Keyframes that break the compositor rule and predate it.
 *
 * A rulebook that finds a real violation and quietly exempts it is worthless; a
 * rulebook that silently rewrites unrelated visuals to satisfy itself is worse.
 * So known violations are NAMED here and the conformance test ratchets: these
 * may exist, nothing new may join them. Each is a genuine cost — animating
 * box-shadow repaints every frame — recorded so it can be paid down deliberately
 * rather than discovered again.
 */
export const KNOWN_MOTION_EXCEPTIONS: ReadonlyArray<{
  keyframe: string;
  property: string;
  cost: string;
}> = [
  {
    keyframe: "lc-reignite",
    property: "box-shadow",
    cost: "Repaints each frame on lantern reignite. Fix by moving the glow to filter: drop-shadow().",
  },
  {
    keyframe: "lc-tether-pull",
    property: "height",
    cost: "Forces layout every frame, which is worse than a repaint. Fix with transform: scaleY().",
  },
];

/**
 * Things that are wrong regardless of how good they look.
 *
 * Several are recovered from the World Bible rather than invented, so a reader
 * can trace each to the canon it protects.
 */
export const FORBIDDEN_PATTERNS = [
  {
    rule: "No dark background on a designated daylight surface.",
    because: "The operator works in LA sun; a dark ground is unreadable there.",
  },
  {
    rule: "Never light a window on outreach alone.",
    because: "Sending is an action, not an outcome. Only a verified reorder earns warmth.",
  },
  {
    rule: "Colour or motion may never be the only channel carrying a state.",
    because: "A plain-language status must always accompany it.",
  },
  {
    rule: "Never zoom out until the whole level fits the screen.",
    because: "WORLD_BIBLE §3: the phone is a camera into a larger stage.",
  },
  {
    rule: "A paused frame must not read as a flat 2D fantasy game board.",
    because: "WORLD_BIBLE §3: if it does, the composition has failed.",
  },
  {
    rule: "A dormant building is never unlit, only unshimmering.",
    because: "Darkness says abandoned; quiet says nobody has ordered lately.",
  },
] as const;

/** Every token the canon defines, for conformance checking against the CSS. */
export function paletteTokenNames(): string[] {
  return Object.keys(DAYLIGHT_PALETTE);
}

/** Relative luminance of a hex colour, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map(c => c + c).join("") : value.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Whether a colour is light enough to be a daylight ground. */
export function isDaylight(hex: string): boolean {
  return luminance(hex) > DAYLIGHT_LUMINANCE_FLOOR;
}
