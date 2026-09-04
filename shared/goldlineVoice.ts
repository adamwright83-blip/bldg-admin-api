/**
 * Goldline's voice for the moments the city creates.
 *
 * WHY THIS EXTENDS THE GUARDIAN PATTERN INSTEAD OF REPLACING IT
 *
 * `goldlineGuardianDialogue.ts` already establishes how this world speaks:
 * authored line banks, no runtime model call, deterministic selection by hash
 * so a line can be asserted in a test. That is the right architecture and this
 * follows it exactly. What it adds is the set of moments the guardian system has
 * no vocabulary for — the ones the real business generates.
 *
 * IT ALSO FIXES THE GAP IN THAT PATTERN
 *
 * `speakGuardian` selects purely by hashing a salt, so the same salt always
 * returns the same line. That is fine where the salt moves with progress, but a
 * moment like "a lantern went quiet" fires repeatedly with identical inputs, and
 * hearing the same sentence four mornings running is how a world stops feeling
 * alive. So this takes the recently-spoken lines and refuses to repeat them
 * until the pool is exhausted — deterministic still, but not repetitive.
 *
 * DATA SLOTS ARE MANDATORY, NOT DECORATIVE
 *
 * "Nine weeks of silence from the Wilshire tower" lands. "The darkness grows"
 * is dead by its third reading. So a line declares the slots it needs and is not
 * selectable without them — a line can never render with an empty hole in it,
 * and the generic fallbacks exist only for when there is genuinely no data.
 *
 * THE FIREWALL APPLIES TO SPEECH TOO
 *
 * No line in an outreach moment may suggest a customer came back. The visual
 * layer is careful about this and the writing must be equally careful, because a
 * cheerful sentence is exactly as much of a lie as a lit window.
 */

/** The moments the city can speak to. */
export const VOICE_MOMENTS = [
  /** Clockhead attacks; the pressure behind it is real dormancy. */
  "clockhead_attack",
  /** The overnight report — what changed while you slept. */
  "morning_report",
  /** Something new found in the world. */
  "discovery",
  /** A customer has gone quiet. */
  "lantern_dormant",
  /** The operator attested sending a reactivation. NOT a win. */
  "outreach_sent",
  /** A verified reorder. The only moment allowed to celebrate. */
  "confirmed_return",
] as const;
export type VoiceMoment = (typeof VOICE_MOMENTS)[number];

/** Facts a line may interpolate. Every one comes from real evidence. */
export type VoiceSlots = {
  buildingName?: string;
  customerName?: string;
  /** Days since the customer last ordered. */
  days?: number;
  /** How many customers this line is about. */
  count?: number;
  /** The denominator, where there is one. */
  total?: number;
};

type SlotName = keyof VoiceSlots;

export type VoiceLine = {
  /** Stable id, used for repetition tracking and for tests. */
  id: string;
  /** Template text. `{building}`, `{days}`, `{count}`, `{total}`, `{customer}`. */
  text: string;
  /** Slots this line cannot render without. */
  requires: SlotName[];
};

/**
 * The banks.
 *
 * Clockhead's lines come from the World Bible: his obsession is that nothing may
 * happen before the correct time, and his clocks read SOON, PENDING, AFTER
 * REVIEW, NEXT WEEK, NOT YET. That is not decoration here — a dormant customer
 * is precisely someone for whom the correct time never arrives, which is why he
 * is the right voice for churn pressure.
 */
const BANKS: Record<VoiceMoment, VoiceLine[]> = {
  clockhead_attack: [
    { id: "ca_not_yet", text: "Not yet. Not yet. Not yet.", requires: [] },
    { id: "ca_pending", text: "{count} still pending. As they should be.", requires: ["count"] },
    { id: "ca_review", text: "{building} remains under review.", requires: ["buildingName"] },
    { id: "ca_conditions", text: "{customer} may order when conditions improve. They will not.", requires: ["customerName"] },
    { id: "ca_days", text: "{days} days deferred. Correctly deferred.", requires: ["days"] },
    { id: "ca_provisional", text: "Provisionally, you are winning.", requires: [] },
    { id: "ca_next_week", text: "Next week. I have written it down.", requires: [] },
    { id: "ca_soon", text: "Soon is a complete answer.", requires: [] },
  ],
  morning_report: [
    { id: "mr_quiet_n", text: "{count} lanterns went quiet overnight.", requires: ["count"] },
    { id: "mr_building", text: "{building} was quieter this morning than last.", requires: ["buildingName"] },
    { id: "mr_ratio", text: "{count} of {total} still burning.", requires: ["count", "total"] },
    { id: "mr_nothing", text: "Nothing moved in the night.", requires: [] },
    { id: "mr_one", text: "One light went out while you slept.", requires: [] },
  ],
  discovery: [
    { id: "dc_building", text: "{building} is on the map now.", requires: ["buildingName"] },
    { id: "dc_generic", text: "Something here was not here yesterday.", requires: [] },
    { id: "dc_count", text: "{count} new doors, none of them opened yet.", requires: ["count"] },
  ],
  lantern_dormant: [
    { id: "ld_days", text: "{customer} has been dark {days} days.", requires: ["customerName", "days"] },
    { id: "ld_days_only", text: "{days} days of silence.", requires: ["days"] },
    { id: "ld_building", text: "A window went out at {building}.", requires: ["buildingName"] },
    { id: "ld_generic", text: "Someone stopped calling.", requires: [] },
  ],
  /*
    The hard bank. Every line has to carry the send AND the fact that nothing was
    won by it. Anything triumphant here would be the same untruth as a window
    lighting on outreach alone.
  */
  outreach_sent: [
    { id: "os_sent", text: "Sent. {customer} is still dark.", requires: ["customerName"] },
    { id: "os_signal", text: "Signal sent. The lantern has not moved.", requires: [] },
    { id: "os_waiting", text: "{days} days, and now a message. Still {days} days.", requires: ["days"] },
    { id: "os_building", text: "One message into {building}. Nothing lit.", requires: ["buildingName"] },
  ],
  confirmed_return: [
    { id: "cr_customer", text: "{customer} came back. That one is real.", requires: ["customerName"] },
    { id: "cr_days", text: "After {days} days — an order.", requires: ["days"] },
    { id: "cr_building", text: "A light came back on at {building}.", requires: ["buildingName"] },
    { id: "cr_generic", text: "Someone came back.", requires: [] },
  ],
};

/** Words that would claim a recovery. Asserted against the outreach bank. */
export const RECOVERY_CLAIM_WORDS = [
  "recovered",
  "came back",
  "won back",
  "returned",
  "reactivated",
  "success",
];

export function linesFor(moment: VoiceMoment): readonly VoiceLine[] {
  return BANKS[moment];
}

/** A line is renderable only when every slot it declares is actually present. */
export function canRender(line: VoiceLine, slots: VoiceSlots): boolean {
  return line.requires.every(slot => {
    const value = slots[slot];
    if (value === undefined || value === null) return false;
    return typeof value === "string" ? value.trim().length > 0 : Number.isFinite(value);
  });
}

function interpolate(text: string, slots: VoiceSlots): string {
  return text
    .replace(/\{building\}/g, slots.buildingName ?? "")
    .replace(/\{customer\}/g, slots.customerName ?? "")
    .replace(/\{days\}/g, slots.days === undefined ? "" : String(slots.days))
    .replace(/\{count\}/g, slots.count === undefined ? "" : String(slots.count))
    .replace(/\{total\}/g, slots.total === undefined ? "" : String(slots.total));
}

/** FNV-1a, matching `speakGuardian` so selection behaves the same way. */
function hash(salt: string): number {
  let value = 2166136261;
  for (let index = 0; index < salt.length; index += 1) {
    value ^= salt.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export type SpokenLine = { id: string; text: string };

/**
 * Say something about this moment.
 *
 * `recent` carries the ids most recently spoken for this moment. Those are
 * excluded so the world does not repeat itself; when every renderable line has
 * been used the pool resets rather than falling silent, because saying something
 * twice eventually is better than saying nothing.
 *
 * Returns null only when no line can render from the given slots — the caller
 * says nothing rather than emitting a sentence with a hole in it.
 */
export function speak(input: {
  moment: VoiceMoment;
  slots?: VoiceSlots;
  /** Ids spoken recently for this moment, newest last. */
  recent?: readonly string[];
  /** Varies selection for callers that want it to. */
  salt?: string;
}): SpokenLine | null {
  const slots = input.slots ?? {};
  const renderable = BANKS[input.moment].filter(line => canRender(line, slots));
  if (renderable.length === 0) return null;

  const recent = new Set(input.recent ?? []);
  let pool = renderable.filter(line => !recent.has(line.id));
  // Everything has been said recently: start the rotation over.
  if (pool.length === 0) pool = renderable;

  const salt = `${input.moment}:${input.salt ?? ""}:${recent.size}`;
  const chosen = pool[hash(salt) % pool.length]!;
  return { id: chosen.id, text: interpolate(chosen.text, slots).trim() };
}

/**
 * How many distinct things the world can say about a moment given these facts.
 * Surfaces a bank that has quietly become too thin to avoid repetition.
 */
export function renderableCount(moment: VoiceMoment, slots: VoiceSlots = {}): number {
  return BANKS[moment].filter(line => canRender(line, slots)).length;
}
