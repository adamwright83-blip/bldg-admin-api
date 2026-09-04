/**
 * Guardian dialogue grammar.
 *
 * Lines are authored, not generated. No runtime language-model call is
 * required to play a territory. A line may reference derived challenge state
 * ("three doors still sleep") but must not invent a person, a rejection, or a
 * commercial outcome.
 */

import type { TerritoryDerivedState, TerritoryGrammar } from "./goldlineTerritories";
import type { GuardianId } from "./goldlineGuardians";

export const DIALOGUE_CLASSES = [
  "FIRST_NOTICE",
  "REENTER",
  "ZERO_PROGRESS",
  "FIRST_REAL_ACTION",
  "MID_PROGRESS",
  "ALMOST_READY",
  "OBLIGATION_PRESENT",
  "CONFRONTATION_READY",
  "PLAYER_HIT",
  "GUARDIAN_HIT",
  "PLAYER_FAIL",
  "GUARDIAN_DEFEATED",
  "RETURN_TO_CLEARED_TERRITORY",
  "IDLE_TAUNT",
] as const;
export type GuardianDialogueClass = (typeof DIALOGUE_CLASSES)[number];

export type DialogueContext = {
  grammar: TerritoryGrammar;
  remaining: number;
  completed: number;
  total: number;
  obligationPresent: boolean;
};

type LineBank = Record<GuardianDialogueClass, string[]>;

const SHARED_FALLBACK: LineBank = {
  FIRST_NOTICE: ["You are on my street now."],
  REENTER: ["Back already."],
  ZERO_PROGRESS: ["The street is still sleeping."],
  FIRST_REAL_ACTION: ["One entrance cracked."],
  MID_PROGRESS: ["The veil is thinning."],
  ALMOST_READY: ["Almost. Almost."],
  OBLIGATION_PRESENT: ["One promise still hangs from this street."],
  CONFRONTATION_READY: ["Fine. Come and finish it."],
  PLAYER_HIT: ["Ha!"],
  GUARDIAN_HIT: ["How dare you."],
  PLAYER_FAIL: ["Try again. I am not going anywhere."],
  GUARDIAN_DEFEATED: ["The street was here the whole time."],
  RETURN_TO_CLEARED_TERRITORY: ["Look at it. It was always this city."],
  IDLE_TAUNT: ["Boo."],
};

const BANKS: Record<GuardianId, LineBank> = {
  thunder_king: {
    FIRST_NOTICE: [
      "THUNDER! ...you were supposed to flinch.",
      "A challenger? Finally. I have been warming up since Tuesday.",
    ],
    REENTER: [
      "You came back. Good. My bombs missed you on purpose.",
      "The encore is louder. That is the rule.",
    ],
    ZERO_PROGRESS: [
      "These doors still sleep. Walk them. I will wait. Loudly.",
      "Zero progress. My fuse is already lit out of boredom.",
    ],
    FIRST_REAL_ACTION: [
      "ONE entrance cracked! I meant to allow that.",
      "The street noticed you. I noticed first.",
    ],
    MID_PROGRESS: [
      "The gold is showing. Do not get cocky.",
      "More doors. More thunder. This is a lifestyle.",
    ],
    ALMOST_READY: [
      "One left. I can already hear my victory laugh.",
      "Almost ready? I was born ready. You are catching up.",
    ],
    OBLIGATION_PRESENT: [
      "One promise still hangs from this street. I did not put it there.",
      "That tether is not mine. Do not ask a cloud to file paperwork.",
    ],
    CONFRONTATION_READY: [
      "NOW we fight. For real. My bombs have been practicing.",
      "The street is awake. I am bigger. Come here.",
    ],
    PLAYER_HIT: [
      "YOU DODGED? That bomb had a SPEECH ready.",
      "Stand still! Thunder is a visual medium!",
    ],
    GUARDIAN_HIT: [
      "A scratch. A dramatic scratch.",
      "My crown felt that. Rude.",
    ],
    PLAYER_FAIL: [
      "Get up. That was not even my big bomb.",
      "I win? Already? I had a second act.",
    ],
    GUARDIAN_DEFEATED: [
      "The fuse... the fuse went the wrong way...",
      "Fine. Take the street. I am going to go be weather somewhere with applause.",
    ],
    RETURN_TO_CLEARED_TERRITORY: [
      "Ghost of thunder here. Harmless. Mostly.",
      "Look at those buildings. They were always that loud.",
    ],
    IDLE_TAUNT: [
      "I could throw a tiny bomb. As a greeting.",
      "Bow. Or don't. I will narrate either way.",
    ],
  },
  cloud_duchess: {
    FIRST_NOTICE: [
      "Oh. You. On my mile. In that.",
      "Do not touch the coiffure. Do not even look like you might.",
    ],
    REENTER: [
      "You return. How provincial. How persistent.",
      "Still dressed like a person who walks.",
    ],
    ZERO_PROGRESS: [
      "These bells have not been rung. Scandalous.",
      "The street is unfinished. Like your entrance.",
    ],
    FIRST_REAL_ACTION: [
      "One seal stirred. I allowed it because it was tasteful.",
      "A crack. At last, a conversation.",
    ],
    MID_PROGRESS: [
      "The plaster is peeling. I prefer it that way.",
      "Progress. Not style. But progress.",
    ],
    ALMOST_READY: [
      "One remaining. Do not gloat. Gloating is a winter color.",
      "Almost. Hold your face still.",
    ],
    OBLIGATION_PRESENT: [
      "A promise still hangs here. Unfinished things offend me.",
      "That gold line is not a necklace. Resolve it.",
    ],
    CONFRONTATION_READY: [
      "Very well. Fan protocol. Try not to wrinkle.",
      "The mile is ready. I am overdressed for this, which is correct.",
    ],
    PLAYER_HIT: [
      "You ducked. Rude AND athletic.",
      "My cyclone had choreography.",
    ],
    GUARDIAN_HIT: [
      "My HAIR.",
      "That gust was couture. You vandal.",
    ],
    PLAYER_FAIL: [
      "Swept aside. As forecast.",
      "Do get up. The street is watching and I have a reputation.",
    ],
    GUARDIAN_DEFEATED: [
      "The parasol... inverts... this is a STATEMENT...",
      "Fine. Excavate. I shall haunt the nicer cornices.",
    ],
    RETURN_TO_CLEARED_TERRITORY: [
      "It looks better without me. I hate that.",
      "A ghost of a duchess remains. Harmless. Judgmental.",
    ],
    IDLE_TAUNT: [
      "I could fan you into next week.",
      "Stand up straight. The buildings are doing it.",
    ],
  },
  sleepy_one_eye: {
    FIRST_NOTICE: [
      "Nnnh. You are... a person. Loud.",
      "I was having a very important nap.",
    ],
    REENTER: [
      "You again. Still moving. Exhausting.",
      "If you are going to exist, exist quieter.",
    ],
    ZERO_PROGRESS: [
      "The doors sleep. Relatable.",
      "Wake them if you must. I am already back asleep.",
    ],
    FIRST_REAL_ACTION: [
      "A crack. Hm. Interesting. Zzz.",
      "One entrance opened. I drooled on the other five.",
    ],
    MID_PROGRESS: [
      "The street is... less of a pillow now.",
      "Gold light. Bright. Rude.",
    ],
    ALMOST_READY: [
      "Almost done. I might open the eye for that.",
      "One left. Do not slam it.",
    ],
    OBLIGATION_PRESENT: [
      "A promise is still hanging. It hummed me a lullaby.",
      "That tether stays. Even I know that.",
    ],
    CONFRONTATION_READY: [
      "The eye is open. For three seconds. Do not waste them.",
      "I am awake. This is everyone's problem.",
    ],
    PLAYER_HIT: [
      "You moved. I snored at the old you.",
      "Dodge... noted... continuing nap...",
    ],
    GUARDIAN_HIT: [
      "Ow. That was my good cloud.",
      "The birds are laughing. I feel it.",
    ],
    PLAYER_FAIL: [
      "Went down. Like a pillow. Nice.",
      "Get up when you want. I will still be here. Horizontal.",
    ],
    GUARDIAN_DEFEATED: [
      "Ahhhhh. Fine. The street can have itself.",
      "I am becoming weather. That is a kind of sleep.",
    ],
    RETURN_TO_CLEARED_TERRITORY: [
      "Ghost snores only. The roofs are showing. Good for them.",
      "The city was under me. I knew. I just did not care.",
    ],
    IDLE_TAUNT: [
      "Hhhrrk. That was a snore. Or an attack. Same shape.",
      "The birds are judging you. I trained them.",
    ],
  },
  tiny_emperor: {
    FIRST_NOTICE: [
      "KNEEL. You are enormous and it is rude.",
      "I AM the skyline. The throne agrees.",
    ],
    REENTER: [
      "You return without tribute. Typical giant.",
      "My hands missed you. They will not miss twice.",
    ],
    ZERO_PROGRESS: [
      "These doors ignore me. ME.",
      "Wake the street. That is an order from a very small place.",
    ],
    FIRST_REAL_ACTION: [
      "One door obeyed. See? Scale is a mindset.",
      "A crack. I commanded it with my mind. And also you did a visit.",
    ],
    MID_PROGRESS: [
      "The empire expands. Slightly.",
      "More gold. More throne. This is governance.",
    ],
    ALMOST_READY: [
      "One remains. Bring it to me. I cannot reach.",
      "Almost. Do not tower over the moment.",
    ],
    OBLIGATION_PRESENT: [
      "A promise hangs here. I did not authorize it. It stays anyway.",
      "That tether outranks me. I hate that sentence.",
    ],
    CONFRONTATION_READY: [
      "THE HANDS ARE IN SESSION.",
      "Fight me. Fight the furniture. Fight the weather I borrowed.",
    ],
    PLAYER_HIT: [
      "You dodged a HAND. A HAND, giant.",
      "Insolence of height!",
    ],
    GUARDIAN_HIT: [
      "THE THRONE FELT THAT.",
      "I am unharmed. The upholstery is in shambles.",
    ],
    PLAYER_FAIL: [
      "Flattened by policy.",
      "Rise when you are ready to respect millimetres.",
    ],
    GUARDIAN_DEFEATED: [
      "The hands... they clapped... treason...",
      "I remain emperor of a very small puff. Remember me.",
    ],
    RETURN_TO_CLEARED_TERRITORY: [
      "A ghost on a tiny cloud. Harmless. Still in charge.",
      "The buildings kept their real jobs. I respect a work ethic.",
    ],
    IDLE_TAUNT: [
      "I could summon a bigger hand. I am choosing mercy.",
      "You are standing on my province.",
    ],
  },
  gust_jester: {
    FIRST_NOTICE: [
      "Surprise! It is weather with a punchline.",
      "If you flinch I win. If you don't I also win. I'm a system.",
    ],
    REENTER: [
      "The sequel! Same street, new tripwire.",
      "You came back. My traps missed you so hard they filed a complaint.",
    ],
    ZERO_PROGRESS: [
      "Nothing cracked yet. Perfect. I can still lie about the plot.",
      "The doors sleep. I already put whoopee cushions in the veil.",
    ],
    FIRST_REAL_ACTION: [
      "A real crack! I was going to fake one. You ruined my bit.",
      "One entrance opened. I take full comedic credit.",
    ],
    MID_PROGRESS: [
      "Halfway to a punchline. Don't rush the rimshot.",
      "The veil is peeling. That's just good staging.",
    ],
    ALMOST_READY: [
      "One left. The audience is leaning in. That's you. Lean.",
      "Almost. I have a trap for the last one. Of course I do.",
    ],
    OBLIGATION_PRESENT: [
      "A real promise is hanging here. I don't touch those. Too honest.",
      "That tether stays. My jokes are optional. That isn't.",
    ],
    CONFRONTATION_READY: [
      "Okay okay the funny part is over. The other funny part is starting.",
      "Ready? I already started. That's the joke.",
    ],
    PLAYER_HIT: [
      "You dodged the laughing wind. Rude to the writers.",
      "That trap had a FACE.",
    ],
    GUARDIAN_HIT: [
      "Ow! That's... actually a good bit.",
      "The bells! The bells are suing.",
    ],
    PLAYER_FAIL: [
      "Gotcha. Harmless. Emotionally? Devastating.",
      "Retry accepted. I have more hats.",
    ],
    GUARDIAN_DEFEATED: [
      "Confetti clause activated. I planned this. I did not.",
      "The cap deflates. That's the real ending. Take the street.",
    ],
    RETURN_TO_CLEARED_TERRITORY: [
      "Ghost jester. One harmless trap a day. Union rules.",
      "The city looks great without the gag. I hate sequels that mature.",
    ],
    IDLE_TAUNT: [
      "I could trip you with a breeze. Consider it a handshake.",
      "Boo but make it wind.",
    ],
  },
  drizzle_detective: {
    FIRST_NOTICE: [
      "The street was already a case. You are a new footprint.",
      "Don't drip on the evidence. I am the evidence.",
    ],
    REENTER: [
      "You return to the scene. Suspicious. I respect it.",
      "Same coat. Same case. Wetter.",
    ],
    ZERO_PROGRESS: [
      "No visits. No clues. The rain is doing all the work.",
      "These doors still sleep. I have questions for each of them.",
    ],
    FIRST_REAL_ACTION: [
      "A clue. A real one. I did not plant it. I considered it.",
      "One entrance cracked. The plot thickens. The plaster too.",
    ],
    MID_PROGRESS: [
      "Pattern emerging. Gold under white. I knew it.",
      "Halfway excavated. The city was never missing. Only unread.",
    ],
    ALMOST_READY: [
      "One clue left. Do not contaminate it with enthusiasm.",
      "Almost closed. I hate almost. Almost is weather.",
    ],
    OBLIGATION_PRESENT: [
      "A promise still hangs. Not a metaphor. A tether. Leave it.",
      "That gold line is evidence of a real obligation. Hands off.",
    ],
    CONFRONTATION_READY: [
      "The case is ready. I am the final exhibit. Unfortunate.",
      "All clues gathered. Now we do the unscientific part.",
    ],
    PLAYER_HIT: [
      "You dodged a raindrop with a name. Impressive. Irritating.",
      "The glass had you in focus.",
    ],
    GUARDIAN_HIT: [
      "My pipe! That was vintage damp.",
      "A hit. Logged. Resented.",
    ],
    PLAYER_FAIL: [
      "Case paused. You fell. Happens to the best footprints.",
      "Retry. The rain will wait. It is very patient.",
    ],
    GUARDIAN_DEFEATED: [
      "Coat unbuttons. Case closed. The city was the culprit all along.",
      "The glass stays. Empty. That is the reveal. You may look now.",
    ],
    RETURN_TO_CLEARED_TERRITORY: [
      "Ghost of a detective. Harmless drizzle. Still taking notes.",
      "The buildings kept their real stages. Good. I don't rewrite files.",
    ],
    IDLE_TAUNT: [
      "I know what you did last visit. Nothing. That's a clue too.",
      "The raindrop is watching you. So am I. We are a team.",
    ],
  },
};

function remainingPhrase(context: DialogueContext): string {
  if (context.grammar === "visit_hunt") {
    return context.remaining === 1
      ? "One door still sleeps."
      : `${numberWord(context.remaining)} doors still sleep.`;
  }
  if (context.grammar === "break_the_silence") {
    return context.remaining === 1
      ? "One signal still waits."
      : `${numberWord(context.remaining)} signals still wait.`;
  }
  return context.remaining === 1
    ? "One standard still furled."
    : `${numberWord(context.remaining)} standards still furled.`;
}

function numberWord(value: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
  return words[value] ?? String(value);
}

export function dialogueContextFromState(input: {
  grammar: TerritoryGrammar;
  state: TerritoryDerivedState;
  obligationPresent?: boolean;
}): DialogueContext {
  const total = input.state.members.length;
  return {
    grammar: input.grammar,
    remaining: input.state.remainingMemberIds.length,
    completed: input.state.completedMemberIds.length,
    total,
    obligationPresent: Boolean(input.obligationPresent),
  };
}

export function selectDialogueClass(input: {
  noticedBefore: boolean;
  context: DialogueContext;
  kind?: GuardianDialogueClass;
}): GuardianDialogueClass {
  if (input.kind) return input.kind;
  if (input.context.obligationPresent && input.context.completed === 0)
    return "OBLIGATION_PRESENT";
  if (!input.noticedBefore) return "FIRST_NOTICE";
  if (input.context.completed === 0) return "ZERO_PROGRESS";
  if (input.context.completed === 1) return "FIRST_REAL_ACTION";
  if (input.context.remaining === 1) return "ALMOST_READY";
  if (input.context.remaining === 0) return "CONFRONTATION_READY";
  return "MID_PROGRESS";
}

export function speakGuardian(input: {
  guardianId: GuardianId;
  lineClass: GuardianDialogueClass;
  context: DialogueContext;
  salt?: string;
}): string {
  const bank = BANKS[input.guardianId] ?? SHARED_FALLBACK;
  const lines = bank[input.lineClass] ?? SHARED_FALLBACK[input.lineClass];
  const salt = `${input.guardianId}:${input.lineClass}:${input.salt ?? input.context.remaining}`;
  let hash = 2166136261;
  for (let index = 0; index < salt.length; index += 1) {
    hash ^= salt.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const chosen = lines[(hash >>> 0) % lines.length] ?? SHARED_FALLBACK[input.lineClass][0]!;
  if (
    input.lineClass === "ZERO_PROGRESS" ||
    input.lineClass === "MID_PROGRESS" ||
    input.lineClass === "ALMOST_READY"
  ) {
    return `${chosen} ${remainingPhrase(input.context)}`.trim();
  }
  return chosen;
}

export function lineCountForGuardian(guardianId: GuardianId): number {
  return Object.values(BANKS[guardianId]).reduce((sum, lines) => sum + lines.length, 0);
}
