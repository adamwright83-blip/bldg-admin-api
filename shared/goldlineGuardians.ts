/**
 * Cloud guardian roster.
 *
 * Each published territory is assigned exactly one of these. Assignment is a
 * hash of the territory's stable key, so a reload cannot swap Thunder King
 * for the Duchess. The visuals and attacks live here as data; the engine
 * interprets them. Nothing here can write a business record.
 *
 * Visual canon: Goldline Guardians approved asset pack
 * (Thunder King, Cloud Duchess, Sleepy One-Eye, Tiny Emperor,
 * Gust Jester, Drizzle Detective).
 */

import { stableHash } from "./goldlineTerritories";

export const GUARDIAN_ROSTER_IDS = [
  "thunder_king",
  "cloud_duchess",
  "sleepy_one_eye",
  "tiny_emperor",
  "gust_jester",
  "drizzle_detective",
] as const;
export type GuardianId = (typeof GUARDIAN_ROSTER_IDS)[number];

export type GuardianAttackFamily = "bomb_arc" | "gust_shockwave" | "hand_slam";

export type GuardianSilhouette = {
  /** Compact readable profile for the roster sheet and reduced-motion fallback. */
  profile: string;
  bodyScale: number;
  crown: "lightning" | "tiara" | "none" | "micro" | "jester" | "deerstalker";
  extraMass: "fists" | "coiffure" | "colossus" | "throne" | "cap" | "coat";
};

export type GuardianDefinition = {
  id: GuardianId;
  name: string;
  epithet: string;
  silhouette: GuardianSilhouette;
  personality: string;
  eyeBehavior: string;
  mouthBehavior: string;
  handBehavior: string;
  idleGrammar: string;
  attackGrammar: string;
  signatureGimmick: string;
  signatureAttack: GuardianAttackFamily;
  attackSequence: GuardianAttackFamily[];
  hurtReaction: string;
  victoryReaction: string;
  defeatFlourish: string;
  audioCue: "thunder" | "wind" | "snore" | "chirp_slam" | "jingle" | "drip";
  hapticPattern: "rumble" | "flourish" | "thump" | "double" | "trick" | "tap";
  reducedMotionFallback: string;
  palette: {
    cloud: string;
    storm: string;
    gold: string;
    accent: string;
  };
};

export const GUARDIAN_ROSTER: Record<GuardianId, GuardianDefinition> = {
  thunder_king: {
    id: "thunder_king",
    name: "Thunder King",
    epithet: "The Storm Showboat",
    silhouette: {
      profile: "broad thunderhead with a lightning crown and giant fists",
      bodyScale: 1.15,
      crown: "lightning",
      extraMass: "fists",
    },
    personality: "Loud, competitive, impatient, convinced every entrance needs thunder.",
    eyeBehavior: "Wide glare that tracks the player, brows sparking when ignored.",
    mouthBehavior: "Laughs too early; jaw drops into a roar on overcharge.",
    handBehavior: "Giant cloud fists point, then lob thundercloud bombs.",
    idleGrammar: "Overcharges himself, sheds puff debris, strikes a pose, then does it louder.",
    attackGrammar: "Fast bomb arcs, occasional fizzle, occasional absurdly huge bomb.",
    signatureGimmick: "Thundercloud bombs with a gold fuse.",
    signatureAttack: "bomb_arc",
    attackSequence: ["bomb_arc", "bomb_arc", "hand_slam", "bomb_arc"],
    hurtReaction: "Offended spark burst. 'That was a WARM-UP.'",
    victoryReaction: "Bows as if the street asked for an encore.",
    defeatFlourish: "Crown short-circuits; the thunderhead pops into gold weather.",
    audioCue: "thunder",
    hapticPattern: "rumble",
    reducedMotionFallback: "Thunder King holds a lightning crown and a storm bomb. Name and tell remain readable.",
    palette: { cloud: "#f7fbff", storm: "#5b4a9a", gold: "#e8c15a", accent: "#ff7a18" },
  },
  cloud_duchess: {
    id: "cloud_duchess",
    name: "Cloud Duchess",
    epithet: "The Imperial Gust",
    silhouette: {
      profile: "tall coiffure, elongated face, parasol, dress of wisps",
      bodyScale: 1.2,
      crown: "tiara",
      extraMass: "coiffure",
    },
    personality: "Imperious, fashionable, judgmental, easily scandalized, never merely pretty.",
    eyeBehavior: "Inspects the player down the nose; recoils if they get too close.",
    mouthBehavior: "A thin scandalized O, then a hissed verdict.",
    handBehavior: "Fan and parasol work: elegant sweeps that shove the player around.",
    idleGrammar: "Adjusts the coiffure, flicks the parasol, judges the street.",
    attackGrammar: "Gust fans and parasol cyclones that control space.",
    signatureGimmick: "Parasol cyclones and gold petal debris.",
    signatureAttack: "gust_shockwave",
    attackSequence: ["gust_shockwave", "gust_shockwave", "bomb_arc", "gust_shockwave"],
    hurtReaction: "Hair silhouette disrupted. Absolute fury.",
    victoryReaction: "A curt nod, as if the city has been corrected.",
    defeatFlourish: "Parasol inverts; the coiffure avalanches into pale gold dust.",
    audioCue: "wind",
    hapticPattern: "flourish",
    reducedMotionFallback: "Cloud Duchess holds a gold parasol. Gust tells are labelled as wind.",
    palette: { cloud: "#fff7fb", storm: "#c9a7d4", gold: "#e8c15a", accent: "#f2d6e8" },
  },
  sleepy_one_eye: {
    id: "sleepy_one_eye",
    name: "Sleepy One-Eye",
    epithet: "The Snore Colossus",
    silhouette: {
      profile: "huge sagging cloud with one enormous lid and perched birds",
      bodyScale: 1.45,
      crown: "none",
      extraMass: "colossus",
    },
    personality: "Massive, drowsy, apathetic, accidentally dangerous, terrifying for three seconds.",
    eyeBehavior: "One lid droops; it opens fully only on a serious beat.",
    mouthBehavior: "Open snore, then a sudden sneeze.",
    handBehavior: "A drooping hand that forgets it is an attack until it lands.",
    idleGrammar: "Collapses, reforms, falls asleep mid-taunt, birds rearrange.",
    attackGrammar: "Slow snore shockwaves, then a violent wake-up sneeze.",
    signatureGimmick: "Snore shockwaves.",
    signatureAttack: "gust_shockwave",
    attackSequence: ["gust_shockwave", "hand_slam", "gust_shockwave", "bomb_arc"],
    hurtReaction: "The eye snaps open. The street goes quiet.",
    victoryReaction: "Goes back to sleep on the newly visible roofs.",
    defeatFlourish: "The colossus sighs into a low gold fog; the birds take the sky.",
    audioCue: "snore",
    hapticPattern: "thump",
    reducedMotionFallback: "Sleepy One-Eye is a huge one-eyed cloud. Shockwaves are announced as snores.",
    palette: { cloud: "#eef4ff", storm: "#6d7ea3", gold: "#d7c48a", accent: "#7ec8ff" },
  },
  tiny_emperor: {
    id: "tiny_emperor",
    name: "Tiny Emperor",
    epithet: "The Micro Tyrant",
    silhouette: {
      profile: "microscopic crowned body on an oversized gold throne with giant hands",
      bodyScale: 0.55,
      crown: "micro",
      extraMass: "throne",
    },
    personality: "Absurdly small, enormous ego, furious that nobody respects scale.",
    eyeBehavior: "Beady and commanding; always looking slightly up at the insult of your height.",
    mouthBehavior: "Tiny shouts that the throne amplifies.",
    handBehavior: "Summons hands far larger than himself to point, slam, and order weather.",
    idleGrammar: "Tantrums on the throne; the throne spins a degree whenever he is ignored.",
    attackGrammar: "Giant command hands and delayed area slams.",
    signatureGimmick: "Giant command hands.",
    signatureAttack: "hand_slam",
    attackSequence: ["hand_slam", "hand_slam", "bomb_arc", "hand_slam"],
    hurtReaction: "Throne spins. He screams at the furniture.",
    victoryReaction: "Demands a parade. Receives weather.",
    defeatFlourish: "The giant hands applaud him by accident and clap him into glitter.",
    audioCue: "chirp_slam",
    hapticPattern: "double",
    reducedMotionFallback: "Tiny Emperor sits on a huge gold throne. Slams are labelled as command hands.",
    palette: { cloud: "#fffaf0", storm: "#8a6a3a", gold: "#f0c44c", accent: "#c23a3a" },
  },
  gust_jester: {
    id: "gust_jester",
    name: "Gust Jester",
    epithet: "The Wind Prankster",
    silhouette: {
      profile: "slender crouching cloud in a purple-gold jester cap with a toothy grin",
      bodyScale: 0.95,
      crown: "jester",
      extraMass: "cap",
    },
    personality: "Acrobatic, mischievous, allergic to dignity, laughs at his own tricks first.",
    eyeBehavior: "Cross-eyed wink that still tracks the player.",
    mouthBehavior: "Permanent grin that splits wider when a trap lands.",
    handBehavior: "Juggles gust traps — little laughing whirlwinds — then kicks them.",
    idleGrammar: "Cartwheels on nothing, rings his own bells, hides behind a wisp.",
    attackGrammar: "Gust traps that shove, then a bomb that was a joke until it wasn't.",
    signatureGimmick: "Laughing gust traps.",
    signatureAttack: "gust_shockwave",
    attackSequence: ["gust_shockwave", "bomb_arc", "gust_shockwave", "hand_slam"],
    hurtReaction: "Bells tangle. He finds this even funnier.",
    victoryReaction: "Takes a bow that becomes a flip.",
    defeatFlourish: "The cap deflates; laughing vortices pop into gold confetti.",
    audioCue: "jingle",
    hapticPattern: "trick",
    reducedMotionFallback: "Gust Jester wears a purple-gold cap. Traps are labelled as wind jokes.",
    palette: { cloud: "#f3f0ff", storm: "#6b4aa8", gold: "#e8c15a", accent: "#7a5cff" },
  },
  drizzle_detective: {
    id: "drizzle_detective",
    name: "Drizzle Detective",
    epithet: "The Precipitation Sleuth",
    silhouette: {
      profile: "deerstalker and trench-coat cloud with magnifying glass and hanging raindrops",
      bodyScale: 1.05,
      crown: "deerstalker",
      extraMass: "coat",
    },
    personality: "Grave, squinting, certain the street is hiding something, slightly damp.",
    eyeBehavior: "Squints through the glass; the glass tracks independently of the face.",
    mouthBehavior: "Pipe-clenched mutter, then a sudden 'AHA' that is an attack.",
    handBehavior: "Points the magnifying glass; raindrop clues fall as delayed strikes.",
    idleGrammar: "Circles the territory, tapping raindrops as if they were evidence.",
    attackGrammar: "Raindrop clues and glass-beamed area marks.",
    signatureGimmick: "Raindrop clues.",
    signatureAttack: "bomb_arc",
    attackSequence: ["bomb_arc", "hand_slam", "bomb_arc", "gust_shockwave"],
    hurtReaction: "Drops the pipe. Recovers it with wounded professionalism.",
    victoryReaction: "Closes the case. The rain stops, which he finds suspicious.",
    defeatFlourish: "The coat unbuttons into weather; the glass remains, empty, flashing gold.",
    audioCue: "drip",
    hapticPattern: "tap",
    reducedMotionFallback: "Drizzle Detective holds a gold magnifying glass. Drops are labelled as clues.",
    palette: { cloud: "#e8eef6", storm: "#3d4a63", gold: "#d7b25a", accent: "#5aa0d6" },
  },
};

export function guardianById(id: string): GuardianDefinition {
  if ((GUARDIAN_ROSTER_IDS as readonly string[]).includes(id)) {
    return GUARDIAN_ROSTER[id as GuardianId];
  }
  return GUARDIAN_ROSTER.thunder_king;
}

export function guardianIdForStableKey(stableKey: string): GuardianId {
  return GUARDIAN_ROSTER_IDS[stableHash(stableKey) % GUARDIAN_ROSTER_IDS.length]!;
}

export function allGuardians(): GuardianDefinition[] {
  return GUARDIAN_ROSTER_IDS.map(id => GUARDIAN_ROSTER[id]);
}
