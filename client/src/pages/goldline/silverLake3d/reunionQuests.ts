import type { VillagerVariant } from "@shared/cozyVillagerOutreach";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";

/**
 * Silver Lake reunion quests: authored fiction in front of a real decision. Design and guardrails:
 * docs/goldline/silver-lake-3d-slice/REUNION_QUESTS.md (change the doc first, then this file).
 *
 * Everything here is pure. A quest never changes a customer's communication state; it only reads the state the server
 * already projects. The only customer facts a line may show are the slots below, and a reunion beat whose real number
 * is missing is dropped, never guessed. The customer never speaks and is never given a pronoun.
 */

export type QuestItemKind =
  | "garden_hose"
  | "kite"
  | "watering_can"
  | "rubber_duck"
  | "acorn_jar"
  | "scarf"
  | "spectacles"
  | "teacup";

export type QuestSpot = {
  id: string;
  hint: string;
  x: number; // Blender coordinates, like the rest of courtyard.json
  y: number;
  z: number;
  reach: "ground" | "hop";
};

export type ReunionBeat = { speaker: "giver" | "narrator"; text: string };

export type ReunionQuestTemplate = {
  id: string;
  giver: { variant: VillagerVariant; name: string };
  item: { kind: QuestItemKind; name: string };
  spotId: string;
  lines: { locked: string; need: string; carrying: string; waiting: string; thanks: string };
  reunion: ReunionBeat[];
};

/**
 * One authored template per villager animal, so every customer in the courtyard can get an errand. Cleo's comes first
 * and is the most polished. Cats invent their own instruments from whatever they find, so Cleo's "flute" is an old
 * garden hose, never an actual instrument.
 */
export const REUNION_QUEST_TEMPLATES: readonly ReunionQuestTemplate[] = [
  {
    id: "cat_hose_flute",
    giver: { variant: "cat", name: "Cleo" },
    item: { kind: "garden_hose", name: "old garden hose" },
    spotId: "tree_hollow",
    lines: {
      locked: "Shh. I'm tuning a stick. Come back in a bit?",
      need: "I've got a song stuck in my whiskers and nothing to play it on. I need a flute. Something long, hollow and a bit bendy. I'm sure I saw an {item} {hint}.",
      carrying: "Long. Hollow. A bit bendy. That's the finest flute I've ever seen. Give it here.",
      waiting: "{customerFirst} is still here. Write when you're ready. I'll play something soothing.",
      thanks: "Thank you for the flute. I've written a whole symphony. It's mostly one note.",
    },
    reunion: [
      { speaker: "narrator", text: "Cleo lifts the old garden hose like a flute and plays three wobbly notes. Then a fourth, much worse one." },
      { speaker: "narrator", text: "Somewhere behind the cottages, a dog howls along." },
      { speaker: "narrator", text: "{customerName} follows the tune into the courtyard." },
      {
        speaker: "giver",
        text: "{customerFirst}! I'd know that walk anywhere. It's been {daysSinceLastOrder} days since your last order. The washing line has been sulking.",
      },
      { speaker: "giver", text: "{paidOrders} {orderWord} with us, and then the courtyard went quiet." },
      { speaker: "giver", text: "You should write to {customerFirst}. Go on. I'm going to keep practising." },
    ],
  },
  {
    id: "bunny_kite",
    giver: { variant: "bunny", name: "Bella" },
    item: { kind: "kite", name: "kite" },
    spotId: "tree_branch",
    lines: {
      locked: "Busy, busy! Come back in a bit?",
      need: "My {item} went on an adventure without me. Last seen {hint}. I can't jump that high. Can you?",
      carrying: "My {item}! You actually got it down!",
      waiting: "{customerFirst} is by the fountain. Write when you're ready.",
      thanks: "The {item} hasn't escaped since. Thank you!",
    },
    reunion: [
      { speaker: "narrator", text: "Bella runs one lap of the fountain with the kite bouncing behind." },
      { speaker: "narrator", text: "{customerName} looks up to watch it." },
      { speaker: "giver", text: "{customerFirst}! {daysSinceLastOrder} days! The sky's been very boring without you." },
      { speaker: "giver", text: "You should write to {customerFirst}." },
    ],
  },
  {
    id: "bear_watering_can",
    giver: { variant: "bear", name: "Bruno" },
    item: { kind: "watering_can", name: "watering can" },
    spotId: "behind_crate",
    lines: {
      locked: "Mm. Pumpkin business. Later, friend.",
      need: "The pumpkins are thirsty and I've misplaced my {item}. Try {hint}.",
      carrying: "My {item}! The pumpkins thank you. Quietly.",
      waiting: "{customerFirst} is by the pumpkins. Write when you're ready.",
      thanks: "Biggest pumpkins in Silver Lake. Thanks to you.",
    },
    reunion: [
      { speaker: "narrator", text: "Bruno waters one pumpkin, very seriously." },
      { speaker: "narrator", text: "{customerName} stops by the patch." },
      { speaker: "giver", text: "{customerFirst}! Back after {daysSinceLastOrder} days." },
      { speaker: "giver", text: "{paidOrders} {orderWord}. A proper regular." },
      { speaker: "giver", text: "You should write to {customerFirst}." },
    ],
  },
  {
    id: "otter_duck",
    giver: { variant: "otter", name: "Oliver" },
    item: { kind: "rubber_duck", name: "rubber duck" },
    spotId: "fountain_rim",
    lines: {
      locked: "Can't talk, I'm floating. Later?",
      need: "My {item} has gone for a swim without telling me. I think it's {hint}.",
      carrying: "There you are, you rascal. Thank you!",
      waiting: "{customerFirst} is by the fountain. Write when you're ready.",
      thanks: "The duck sends its regards.",
    },
    reunion: [
      { speaker: "narrator", text: "Oliver floats the duck across the fountain. It spins, gloriously." },
      { speaker: "narrator", text: "{customerName} pauses at the edge of the fountain." },
      { speaker: "giver", text: "{customerFirst}! {daysSinceLastOrder} days, and the duck kept asking." },
      { speaker: "giver", text: "You should write to {customerFirst}." },
    ],
  },
  {
    id: "squirrel_acorn_jar",
    giver: { variant: "squirrel", name: "Sammy" },
    item: { kind: "acorn_jar", name: "acorn jar" },
    spotId: "pumpkin_patch",
    lines: {
      locked: "Counting. Don't make me lose count. Later!",
      need: "I hid my {item} so well I can't find it. Possibly {hint}. Possibly not.",
      carrying: "My {item}! Every acorn accounted for. Probably.",
      waiting: "{customerFirst} is here. I'm counting. Write when you're ready.",
      thanks: "Still counting. Still grateful.",
    },
    reunion: [
      { speaker: "narrator", text: "Sammy counts the acorns, and loses count." },
      { speaker: "narrator", text: "{customerName} wanders over." },
      { speaker: "giver", text: "{customerFirst}! {paidOrders} {orderWord}, I counted. Then nothing for {daysSinceLastOrder} days." },
      { speaker: "giver", text: "You should write to {customerFirst}." },
    ],
  },
  {
    id: "fox_lucky_scarf",
    giver: { variant: "fox", name: "Fennel" },
    item: { kind: "scarf", name: "lucky scarf" },
    spotId: "washing_line",
    lines: {
      locked: "Can't stop, looking for something lucky. Later?",
      need: "The wind stole my {item}. It's {hint}, flapping at me. Rude. You'll have to hop for it.",
      carrying: "My {item}! My luck is back. I can feel it in my tail.",
      waiting: "{customerFirst} is here. Write when you're ready. I'm feeling lucky.",
      thanks: "Still wearing the {item}. Still lucky.",
    },
    reunion: [
      { speaker: "narrator", text: "Fennel wraps the scarf on twice and strikes a pose." },
      { speaker: "narrator", text: "{customerName} walks in, right on cue." },
      { speaker: "giver", text: "{customerFirst}! See? Lucky. {daysSinceLastOrder} days since your last order, and here you are." },
      { speaker: "giver", text: "You should write to {customerFirst}." },
    ],
  },
  {
    id: "badger_spectacles",
    giver: { variant: "badger", name: "Bramble" },
    item: { kind: "spectacles", name: "reading glasses" },
    spotId: "mailbox",
    lines: {
      locked: "Reading. Well, trying to. Later.",
      need: "I can't read a thing without my {item}. Last seen {hint}. Probably.",
      carrying: "Ah. Words again. Thank you.",
      waiting: "{customerFirst} is here. Write when you're ready. Short is fine.",
      thanks: "Read three letters today. All short. Excellent.",
    },
    reunion: [
      { speaker: "narrator", text: "Bramble puts the glasses on and squints across the courtyard." },
      { speaker: "narrator", text: "{customerName} comes into focus." },
      { speaker: "giver", text: "{customerFirst}. {paidOrders} {orderWord}, then {daysSinceLastOrder} days of nothing. I keep records." },
      { speaker: "giver", text: "You should write to {customerFirst}. Keep it short." },
    ],
  },
  {
    id: "hedgehog_teacup",
    giver: { variant: "hedgehog", name: "Henry" },
    item: { kind: "teacup", name: "favourite teacup" },
    spotId: "under_bench",
    lines: {
      locked: "The kettle's nearly on. Come back in a bit?",
      need: "The tea's brewing and my {item} has wandered off. I think it's {hint}.",
      carrying: "My {item}! Just in time. The tea was getting nervous.",
      waiting: "{customerFirst} is here. Write when you're ready. Tea's poured.",
      thanks: "Best cup of tea in Silver Lake. Thank you.",
    },
    reunion: [
      { speaker: "narrator", text: "Henry pours a cup of tea. Then, after some thought, a second one." },
      { speaker: "narrator", text: "{customerName} arrives just as the kettle whistles." },
      { speaker: "giver", text: "{customerFirst}! {daysSinceLastOrder} days. I kept the kettle warm." },
      { speaker: "giver", text: "You should write to {customerFirst}." },
    ],
  },
];

// ------------------------------------------------------------------ slots

export type QuestSlots = {
  giver: string;
  item: string;
  hint: string;
  customerName: string;
  customerFirst: string;
  daysSinceLastOrder: number | null;
  paidOrders: number | null;
};

const SLOT_RE = /\{(\w+)\}/g;
const KNOWN_SLOTS = new Set(["giver", "item", "hint", "customerName", "customerFirst", "daysSinceLastOrder", "paidOrders", "orderWord"]);

const realNumber = (n: unknown): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null);

export function questSlotsFor(template: ReunionQuestTemplate, spot: QuestSpot | null, target: CozyProjectedTarget): QuestSlots {
  const name = target.displayName.trim();
  return {
    giver: template.giver.name,
    item: template.item.name,
    hint: spot?.hint ?? "somewhere in the courtyard",
    customerName: name,
    customerFirst: name.split(/\s+/)[0] || name,
    daysSinceLastOrder: realNumber(target.daysSinceLastOrder),
    paidOrders: realNumber(target.paidOrders),
  };
}

/**
 * Fills a line. Returns null when the line needs a real number the customer's record does not have, so the caller
 * drops it. An unknown slot is a programming error.
 */
export function fillLine(text: string, slots: QuestSlots): string | null {
  let missing = false;
  const out = text.replace(SLOT_RE, (_, key: string) => {
    if (!KNOWN_SLOTS.has(key)) throw new Error(`reunion quest: unknown slot {${key}}`);
    if (key === "orderWord") return slots.paidOrders === 1 ? "order" : "orders";
    const v = slots[key as keyof QuestSlots];
    if (v === null || v === undefined) {
      missing = true;
      return "";
    }
    return String(v);
  });
  return missing ? null : out;
}

export function reunionBeats(template: ReunionQuestTemplate, slots: QuestSlots): ReunionBeat[] {
  const beats: ReunionBeat[] = [];
  for (const b of template.reunion) {
    const text = fillLine(b.text, slots);
    if (text !== null) beats.push({ speaker: b.speaker, text });
  }
  return beats;
}

// ------------------------------------------------------------------ the unlock rule

const DECIDED_MESSAGE_STATES = new Set(["scheduled", "compose_handoff_opened", "operator_reported_sent", "independently_verified_sent"]);
const DECIDED_COMMUNICATION_STATES = new Set(["scheduled", "claimed", "send_observed"]);

/**
 * A real decision on this customer: scheduled, handed off to the phone, reported or verified sent (all from the
 * server's projection), or an explicit pass. Finding the item, watching the reunion, opening the desk, editing or
 * approving the text do not count.
 */
export function hasRealDecision(target: CozyProjectedTarget, passes: ReadonlySet<string>): boolean {
  if (passes.has(target.customerId)) return true;
  if (DECIDED_MESSAGE_STATES.has(target.silverLakeStatus?.message ?? "")) return true;
  if (DECIDED_COMMUNICATION_STATES.has(target.communicationState)) return true;
  return target.status === "scheduled" || target.status === "accepted";
}

/**
 * Waiting on a decision the operator can make: consent present, not consent-blocked, nothing decided yet. A customer
 * who cannot be contacted never gets an errand that ends at a letter.
 */
export function isQuestEligible(target: CozyProjectedTarget, passes: ReadonlySet<string>): boolean {
  return target.hasConsent && target.communicationState !== "consent_blocked" && !hasRealDecision(target, passes);
}

export type QuestAssignment = { template: ReunionQuestTemplate; customerId: string };

/**
 * Who gets which errand, in slot order. A customer with saved progress keeps that errand, even once decided (the
 * giver then just says thanks, with the customer beside them). Otherwise each takes the
 * next free template whose giver is a different animal, or the next free one if only same-animal givers are left.
 * Templates are not reused within a visit. Assignment is made once per visit, so a decision later in the visit
 * completes a quest instead of reshuffling the chain.
 */
export function assignReunionQuests(
  targets: readonly CozyProjectedTarget[],
  passes: ReadonlySet<string> = new Set(),
  templates: readonly ReunionQuestTemplate[] = REUNION_QUEST_TEMPLATES,
  kept: ReadonlyMap<string, string> = new Map()
): QuestAssignment[] {
  // a customer with saved progress keeps their giver even once decided, so the world remembers the reunion
  const reachable = (t: CozyProjectedTarget) => t.hasConsent && t.communicationState !== "consent_blocked";
  const ordered = [...targets]
    .sort((a, b) => a.slotId.localeCompare(b.slotId))
    .filter(t => isQuestEligible(t, passes) || (kept.has(t.customerId) && reachable(t)));
  const free = [...templates];
  const chosen = new Map<string, ReunionQuestTemplate>();
  for (const t of ordered) {
    const i = free.findIndex(tpl => tpl.id === kept.get(t.customerId));
    if (i >= 0) chosen.set(t.customerId, free.splice(i, 1)[0]);
  }
  for (const t of ordered) {
    if (chosen.has(t.customerId) || free.length === 0) continue;
    const different = free.findIndex(tpl => tpl.giver.variant !== t.villagerVariant);
    chosen.set(t.customerId, free.splice(different >= 0 ? different : 0, 1)[0]);
  }
  return ordered.filter(t => chosen.has(t.customerId)).map(t => ({ template: chosen.get(t.customerId)!, customerId: t.customerId }));
}

export type QuestPhase =
  | "locked" // another customer earlier in the chain still waits on a decision
  | "need" // active; the item is still out in the world
  | "carrying" // active; the player has the item
  | "waiting" // active; reunited, no decision yet
  | "done"; // a real decision exists

export type QuestProgress = { found: ReadonlySet<string>; reunited: ReadonlySet<string> };

/** The phase of every assigned quest. Only the first undecided quest in the chain is ever unlocked. */
export function questPhases(
  chain: readonly QuestAssignment[],
  targetsById: ReadonlyMap<string, CozyProjectedTarget>,
  passes: ReadonlySet<string>,
  progress: QuestProgress
): Map<string, QuestPhase> {
  const phases = new Map<string, QuestPhase>();
  let activeTaken = false;
  for (const q of chain) {
    const t = targetsById.get(q.customerId);
    if (!t || hasRealDecision(t, passes)) {
      phases.set(q.customerId, "done");
      continue;
    }
    if (activeTaken) {
      phases.set(q.customerId, "locked");
      continue;
    }
    activeTaken = true;
    phases.set(
      q.customerId,
      progress.reunited.has(q.customerId) ? "waiting" : progress.found.has(q.customerId) ? "carrying" : "need"
    );
  }
  return phases;
}
