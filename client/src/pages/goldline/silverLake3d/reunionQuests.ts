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

export type QuestItemKind = "flute" | "kite" | "watering_can" | "rubber_duck" | "acorn_jar";

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

export const REUNION_QUEST_TEMPLATES: readonly ReunionQuestTemplate[] = [
  {
    id: "cat_flute",
    giver: { variant: "cat", name: "Cleo" },
    item: { kind: "flute", name: "flute" },
    spotId: "tree_hollow",
    lines: {
      locked: "Shh. I'm composing. Come back in a bit?",
      need: "I've got a song stuck in my whiskers and nothing to play it on. I'm sure I saw a {item} {hint}.",
      carrying: "Is that... a {item}? For me? Oh, give it here.",
      waiting: "{customerFirst} is still here, humming along. Write when you're ready.",
      thanks: "Thank you for the {item}. I'm nearly good at it now.",
    },
    reunion: [
      { speaker: "narrator", text: "Cleo plays three wobbly notes. Then a fourth, much worse one." },
      { speaker: "narrator", text: "{customerName} follows the tune into the courtyard." },
      {
        speaker: "giver",
        text: "{customerFirst}! I'd know that walk anywhere. It's been {daysSinceLastOrder} days since your last order. The washing line has been sulking.",
      },
      { speaker: "giver", text: "{paidOrders} {orderWord} with us, and then the courtyard went quiet." },
      { speaker: "giver", text: "You should write to {customerFirst}. Go on, I'll keep practising." },
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
      waiting: "{customerFirst} is watching the {item}. Write when you're ready.",
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
      waiting: "{customerFirst} is admiring the pumpkins. Write when you're ready.",
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
      waiting: "{customerFirst} is helping me count. Write when you're ready.",
      thanks: "Still counting. Still grateful.",
    },
    reunion: [
      { speaker: "narrator", text: "Sammy counts the acorns, and loses count." },
      { speaker: "narrator", text: "{customerName} wanders over." },
      { speaker: "giver", text: "{customerFirst}! {paidOrders} {orderWord}, I counted. Then nothing for {daysSinceLastOrder} days." },
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

/** Actionable now and still waiting on a decision: the only customers a quest may introduce. */
export function isQuestEligible(target: CozyProjectedTarget, passes: ReadonlySet<string>): boolean {
  return target.communicationState === "draft_prepared" && target.hasConsent && !hasRealDecision(target, passes);
}

export type QuestAssignment = { template: ReunionQuestTemplate; customerId: string };

/**
 * Who gets a quest, in slot order. Assignment is made once per visit from the targets as first projected, so a
 * decision later in the visit completes a quest instead of reshuffling the chain.
 */
export function assignReunionQuests(
  targets: readonly CozyProjectedTarget[],
  passes: ReadonlySet<string> = new Set(),
  templates: readonly ReunionQuestTemplate[] = REUNION_QUEST_TEMPLATES
): QuestAssignment[] {
  const free = [...templates];
  const out: QuestAssignment[] = [];
  const ordered = [...targets].sort((a, b) => a.slotId.localeCompare(b.slotId));
  for (const t of ordered) {
    if (!isQuestEligible(t, passes)) continue;
    const i = free.findIndex(tpl => tpl.giver.variant !== t.villagerVariant);
    if (i < 0) continue;
    out.push({ template: free[i], customerId: t.customerId });
    free.splice(i, 1);
  }
  return out;
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
