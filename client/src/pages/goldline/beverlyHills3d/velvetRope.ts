/**
 * Beverly Hills: The Velvet Rope. The level's gag, as plain state so it is testable and the 3D runtime only renders it.
 *
 * Sterling, the doorman, will not let you near the building ("Deliveries use the service entrance." "Where is it?"
 * "Beverly Hills doesn't have one."). Only somebody may approach, and somebody arrives with three things:
 *   - a $26 green juice: the juice bar line is three influencers filming themselves; walk into each one's shot until
 *     they leave in disgust, then buy it;
 *   - a handbag dog: Biscotti the pug has escaped and does laps of the fountain; only a sprint catches her;
 *   - sunglasses: the golden poodle on top of the fountain is wearing a pair; climb the tiers and take them.
 * With all three, the rope drops, the paparazzi go off, and Claire brings out the real prospect behind the door.
 *
 * The fiction never reaches the business side: the outreach desk only states facts the server returned.
 */

export type RopeItem = "juice" | "pug" | "shades";
export type RopePhase = "arrive" | "turned_away" | "collecting" | "ready" | "admitted";

export const INFLUENCERS = [
  { id: "aurora", name: "Aurora", model: "influencer_a" },
  { id: "blaze", name: "Blaze", model: "influencer_b" },
  { id: "sage", name: "Sage", model: "influencer_c" },
] as const;
export type InfluencerId = (typeof INFLUENCERS)[number]["id"];

export type RopeState = {
  phase: RopePhase;
  have: Record<RopeItem, boolean>;
  /** influencers who left the juice line in disgust */
  photobombed: InfluencerId[];
  /** the operator skipped the gag ("I'm busy, just let me in") */
  skipped: boolean;
};

export type RopeEvent =
  | { type: "TALK_DOORMAN" }
  | { type: "PHOTOBOMB"; who: InfluencerId }
  | { type: "BUY_JUICE" }
  | { type: "CATCH_PUG" }
  | { type: "GRAB_SHADES" }
  | { type: "SKIP" };

export type Line = { speaker: string; text: string };

export const ITEM_LABEL: Record<RopeItem, string> = {
  juice: "A $26 green juice",
  pug: "A handbag dog",
  shades: "Sunglasses worth more than your rent",
};

export function initialRope(): RopeState {
  return { phase: "arrive", have: { juice: false, pug: false, shades: false }, photobombed: [], skipped: false };
}

export const lineClear = (s: RopeState) => INFLUENCERS.every(i => s.photobombed.includes(i.id));
export const itemCount = (s: RopeState) => (Object.values(s.have) as boolean[]).filter(Boolean).length;
export const isSomebody = (s: RopeState) => s.have.juice && s.have.pug && s.have.shades;

export function ropeReducer(s: RopeState, e: RopeEvent): RopeState {
  if (s.phase === "admitted") return s;
  switch (e.type) {
    case "SKIP":
      return { ...s, phase: "admitted", skipped: true };
    case "TALK_DOORMAN":
      if (s.phase === "arrive") return { ...s, phase: "turned_away" };
      if (isSomebody(s)) return { ...s, phase: "admitted" };
      return s;
    case "PHOTOBOMB":
      if (s.photobombed.includes(e.who)) return s;
      return withPhase({ ...s, photobombed: [...s.photobombed, e.who] });
    case "BUY_JUICE":
      if (!lineClear(s) || s.have.juice) return s;
      return withPhase({ ...s, have: { ...s.have, juice: true } });
    case "CATCH_PUG":
      if (s.have.pug) return s;
      return withPhase({ ...s, have: { ...s.have, pug: true } });
    case "GRAB_SHADES":
      if (s.have.shades) return s;
      return withPhase({ ...s, have: { ...s.have, shades: true } });
  }
}

function withPhase(s: RopeState): RopeState {
  if (s.phase === "admitted") return s;
  if (isSomebody(s)) return { ...s, phase: "ready" };
  if ((s.phase === "arrive" || s.phase === "turned_away") && (itemCount(s) > 0 || s.photobombed.length > 0)) return { ...s, phase: "collecting" };
  return s;
}

/** What Sterling says when you walk up to the rope, given how far you have got. */
export function doormanLines(s: RopeState, building: string): Line[] {
  const S = "Sterling";
  if (s.phase === "arrive") {
    return [
      { speaker: S, text: "Good evening. Deliveries use the service entrance." },
      { speaker: "You", text: "Great. Where is it?" },
      { speaker: S, text: "Beverly Hills doesn't have one." },
      { speaker: S, text: `Only guests who are somebody may approach ${building}.` },
      { speaker: S, text: "Somebody arrives with sunglasses worth more than your rent, a handbag dog, and a twenty-six dollar green juice." },
      { speaker: S, text: "You are currently carrying a backpack. I'm so sorry." },
    ];
  }
  if (isSomebody(s)) {
    return [
      { speaker: S, text: "..." },
      { speaker: S, text: "Madam. Forgive me. I didn't recognise you." },
    ];
  }
  const n = itemCount(s);
  const missing = (Object.keys(s.have) as RopeItem[]).filter(k => !s.have[k]).map(k => ITEM_LABEL[k].toLowerCase());
  const quips: Record<number, string> = {
    0: "Still a backpack. Still no.",
    1: "One accessory does not make a somebody. It makes an almost.",
    2: "Two of three. You are approaching somebody. You are not yet somebody.",
  };
  return [
    { speaker: S, text: quips[n] ?? "No." },
    { speaker: S, text: `Missing: ${missing.join("; ")}.` },
  ];
}

export const PHOTOBOMB_LINES: Record<InfluencerId, Line[]> = {
  aurora: [
    { speaker: "Aurora", text: "Babe. BABE. You just walked into my golden hour." },
    { speaker: "Aurora", text: "That was a four-hundred-thousand-follower shot. I'm going to Erewhon." },
  ],
  blaze: [
    { speaker: "Blaze", text: "Bro. I was mid-affirmation." },
    { speaker: "Blaze", text: "This line has bad energy. I'm out." },
  ],
  sage: [
    { speaker: "Sage", text: "Excuse me, this is a ring light. You're standing in my brand." },
    { speaker: "Sage", text: "Fine. FINE. I'll get my juice delivered like a peasant." },
  ],
};

export const BARISTA_LINES = {
  blocked: [{ speaker: "Barista", text: "Line's to the back, love. They're... filming." }],
  sell: [
    { speaker: "Barista", text: "Oh! The line just cleared. Never happens." },
    { speaker: "Barista", text: "One Green Goddess Glow. That's twenty-six dollars. It's mostly vibes." },
    { speaker: "You", text: "...It tastes like a lawn." },
  ],
  done: [{ speaker: "Barista", text: "Enjoy the lawn." }],
};

export const PUG_LINES = {
  tooSlow: [{ speaker: "Biscotti", text: "*escapes with tremendous confidence*" }, { speaker: "Hint", text: "Biscotti only respects a sprint. Hold Shift, or push the stick all the way." }],
  caught: [
    { speaker: "You", text: "Gotcha! The tag says... \"If found, I am worth more than your car.\"" },
    { speaker: "Biscotti", text: "*climbs into your backpack and refuses to leave*" },
  ],
};

export const SHADES_LINES = {
  reach: [{ speaker: "Hint", text: "The golden poodle has the sunglasses. Hop up the fountain's tiers." }],
  grabbed: [
    { speaker: "You", text: "Sorry, sir. I need these more than you." },
    { speaker: "Golden Poodle", text: "..." },
  ],
};

export const ADMITTED_LINES: Line[] = [
  { speaker: "Paparazzi", text: "WHO IS SHE? Over here! OVER HERE!" },
  { speaker: "You", text: "I'm here about laundry." },
];

/** The checklist shown in the HUD. */
export function objectives(s: RopeState): Array<{ item: RopeItem; label: string; done: boolean; hint: string }> {
  return [
    { item: "juice", label: ITEM_LABEL.juice, done: s.have.juice, hint: lineClear(s) ? "The line is clear. Buy it at the bar." : `Juice bar line: ${INFLUENCERS.length - s.photobombed.length} influencer${INFLUENCERS.length - s.photobombed.length === 1 ? "" : "s"} filming. Walk into their shot.` },
    { item: "pug", label: ITEM_LABEL.pug, done: s.have.pug, hint: "Biscotti is doing laps of the fountain. Only a sprint catches her." },
    { item: "shades", label: ITEM_LABEL.shades, done: s.have.shades, hint: "The golden poodle on the fountain has a pair. Climb the tiers." },
  ];
}
