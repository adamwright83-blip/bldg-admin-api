/**
 * Every spoken line on the Wayward. Short, literal, and — for Rook — true.
 *
 * WORLD_BIBLE §11: since the Sunder, Rook's voice fails on a direct lie. He can
 * omit, redirect, and let a letter do the talking; he cannot say a false thing.
 * Each Rook line carries the reason it is true. waywardLines.test.ts keeps that
 * note mandatory, so a later edit cannot slip a lie into his mouth unexamined.
 */
export type Speaker = "ROOK" | "TRAILBLAZER" | "INSPECTOR";

type Line = { speaker: Speaker; text: string; truth?: string };

export const LINES = {
  "rook-nobody-alive": {
    speaker: "ROOK",
    text: "Nobody alive remembers her moving.",
    truth: "WORLD_BIBLE §5: nobody remembers seeing the Wayward sail.",
  },
  "tb-mine": { speaker: "TRAILBLAZER", text: "Mine." },
  "rook-not-yet": {
    speaker: "ROOK",
    text: "Not yet.",
    truth: "She does not have the ship yet; it is still tethered.",
  },
  "rook-long-way-down": {
    speaker: "ROOK",
    text: "Long way down.",
    truth: "The span is broken over open sky.",
  },
  "rook-when-it-comes-back": {
    speaker: "ROOK",
    text: "When it swings clear. Not before.",
    truth: "Advice, not a claim: the cast fouls on whatever is in the way.",
  },
  "rook-how-was-it": {
    speaker: "ROOK",
    text: "How was it?",
    truth: "A question asserts nothing. (WORLD_BIBLE §26, verbatim.)",
  },
  "tb-short": { speaker: "TRAILBLAZER", text: "Short." },
  "rook-again": { speaker: "ROOK", text: "Again?", truth: "A question asserts nothing." },
  "tb-no": { speaker: "TRAILBLAZER", text: "No." },
  "rook-wait-here": { speaker: "ROOK", text: "Wait here.", truth: "An instruction asserts nothing." },
  "rook-wait-here-again": { speaker: "ROOK", text: "Wait. Here.", truth: "An instruction asserts nothing." },
  "inspector-square": { speaker: "INSPECTOR", text: "This makes us square." },
  "tb-what-did-you-tell-them": { speaker: "TRAILBLAZER", text: "What did you tell them?" },
  "rook-nothing-untrue": {
    speaker: "ROOK",
    text: "Nothing untrue.",
    truth: "True by construction: he cannot speak a lie. (He never says what the letter said.)",
  },
  "rook-your-turn": {
    speaker: "ROOK",
    text: "Your turn.",
    truth: "The clamp is hers to open; he has done his part.",
  },
  "rook-plan": { speaker: "ROOK", text: "Plan?", truth: "A question. (WORLD_BIBLE §4, verbatim.)" },
  "tb-yes": { speaker: "TRAILBLAZER", text: "Yes." },
  "rook-good": { speaker: "ROOK", text: "Good.", truth: "An opinion he holds." },
  "tb-go-away-quickly": { speaker: "TRAILBLAZER", text: "Go away from it quickly." },
  "tb-where-is-she-taking-us": { speaker: "TRAILBLAZER", text: "Where's she taking us?" },
  "rook-i-dont-know": {
    speaker: "ROOK",
    text: "I don't know.",
    truth: "He does not. (In the Brass Republic, admitting it is indecent — §13. They have left it.)",
  },
  "rook-i-like-it": { speaker: "ROOK", text: "I like it.", truth: "An opinion he holds, and means." },
} as const satisfies Record<string, Line>;

export type LineId = keyof typeof LINES;
