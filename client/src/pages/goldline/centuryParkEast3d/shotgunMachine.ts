/**
 * The chipping shotgun: four decisions, then fire. None of them is "approve a draft".
 *
 *  1. Clean the barrel — what you remember about them: one true fact from their record to open with.
 *  2. Load the chip — why they went quiet: your diagnosis, recorded as a prediction and scored later.
 *  3. Chamber the shell — the offer, which costs money and comes out of tonight's shells.
 *  4. Aim — when: the weekday and hour the text goes, defaulting to when this person last ordered.
 *
 * Fire schedules the text for that time through the same rails as Silver Lake. The text is in the operator's own
 * voice, built from those choices and the record; none of the fiction (chips, zombies, shotguns) is ever in it.
 * Pure: the desk renders it, the tests walk it, the ledger below keeps the predictions.
 */
export type Opening = { id: string; label: string; line: string };
export type Hypothesis = "moved" | "seasonal" | "price" | "bad_experience" | "forgot";
export type Shell = "none" | "free_pickup" | "credit_10";
export type Aim = { weekday: number; hour: number };

export type Record = {
  customerId: string;
  displayName: string;
  daysSinceLastOrder: number;
  paidOrders: number;
  lifetimeCents: number;
  lastOrderDate: string | null;
  lastOrderSummary: string | null;
};

export const HYPOTHESES: { id: Hypothesis; label: string; tell: string }[] = [
  { id: "forgot", label: "Life got busy", tell: "Regular orders, then a clean stop. Nothing went wrong; the habit just lapsed." },
  { id: "seasonal", label: "Seasonal", tell: "They order in bursts. Summer travel, a term, a project; the pile will be back." },
  { id: "price", label: "Price", tell: "Fewer orders over time, smaller ones. Something cheaper or a washer in the unit." },
  { id: "bad_experience", label: "Something went wrong", tell: "A good run, then silence right after an order. Worth owning it, even blind." },
  { id: "moved", label: "Moved away", tell: "A long run, then nothing, in a building people leave. Say so, and that you cover most of LA." },
];

export const SHELLS: { id: Shell; label: string; costCents: number; line: string }[] = [
  { id: "none", label: "No offer", costCents: 0, line: "" },
  { id: "free_pickup", label: "Free pickup", costCents: 1200, line: "Pickup's on me this time." },
  { id: "credit_10", label: "$10 credit", costCents: 1000, line: "There's a $10 credit on your account whenever you're ready." },
];
export const SHELLS_PER_NIGHT = 3;
export const FUSE_SECONDS = 30;
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const first = (name: string) => name.split(" ")[0] || name;
const dollars = (cents: number) => `$${Math.round(cents / 100)}`;

/** the facts worth opening with, from the record only */
export function openings(r: Record): Opening[] {
  const out: Opening[] = [];
  const f = first(r.displayName);
  if (r.lastOrderSummary) out.push({ id: "last", label: `Their last order: ${r.lastOrderSummary}`, line: `Hi ${f}, it's Adam from {brand}. I was looking at your last order (${r.lastOrderSummary}) and realised it's been a while.` });
  if (r.paidOrders >= 4) out.push({ id: "regular", label: `${r.paidOrders} orders with you`, line: `Hi ${f}, it's Adam from {brand}. You were one of our regulars (${r.paidOrders} pickups) and I noticed we haven't seen you in ${r.daysSinceLastOrder} days.` });
  if (r.lastOrderDate) {
    const d = new Date(r.lastOrderDate);
    if (!Number.isNaN(d.getTime())) {
      const when = d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
      out.push({ id: "date", label: `Last pickup on ${when}`, line: `Hi ${f}, it's Adam from {brand}. Your last pickup with us was ${when}, which is longer ago than I'd like.` });
    }
  }
  if (r.lifetimeCents >= 10000) out.push({ id: "value", label: `${dollars(r.lifetimeCents)} of laundry over time`, line: `Hi ${f}, it's Adam from {brand}. You've trusted us with a lot of laundry over the years and I'd hate to lose that.` });
  if (!out.length) out.push({ id: "plain", label: "Just that it's been a while", line: `Hi ${f}, it's Adam from {brand}. It's been ${r.daysSinceLastOrder} days since your last pickup.` });
  return out;
}

export const MIDDLE: globalThis.Record<Hypothesis, string> = {
  forgot: "No pressure at all; I just wanted to make it easy to pick back up.",
  seasonal: "If the pile is building up again, we're here whenever it suits.",
  price: "If the price stopped making sense, tell me straight and I'll see what I can do.",
  bad_experience: "If something went sideways last time, I'd genuinely like to know and make it right.",
  moved: "If you've moved, no worries at all; we cover most of LA now, so we may still be able to help.",
};

/** the default aim: when this person last ordered, or a sensible morning */
export function defaultAim(r: Record, now = new Date()): Aim {
  const d = r.lastOrderDate ? new Date(r.lastOrderDate) : null;
  if (d && !Number.isNaN(d.getTime())) {
    const hour = d.getHours();
    return { weekday: d.getDay(), hour: hour === 0 && d.getMinutes() === 0 ? 10 : Math.min(19, Math.max(8, hour)) };
  }
  return { weekday: (now.getDay() + 1) % 7, hour: 10 };
}

/** the next date for an aim, in the browser's clock, always in the future */
export function aimToDate(aim: Aim, now = new Date()): Date {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setHours(aim.hour, 0, 0, 0);
  let delta = (aim.weekday - d.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() <= now.getTime() + 5 * 60_000) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}

export type Loadout = { opening: Opening; hypothesis: Hypothesis; shell: Shell; aim: Aim };

/** the text, in the operator's voice, from the four choices and the record; the brand is filled in by the caller */
export function assemble(l: Loadout, brand: string): string {
  const shell = SHELLS.find(s => s.id === l.shell)!;
  const ask = `Want me to grab a pickup ${WEEKDAYS[l.aim.weekday]} around ${hourLabel(l.aim.hour)}? Just reply yes and we'll be there.`;
  return [l.opening.line.replace("{brand}", brand), MIDDLE[l.hypothesis], shell.line, ask].filter(Boolean).join(" ");
}

export const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

// ------------------------------------------------------------------ the chip ledger: predictions, scored later
export type Chip = { customerId: string; hypothesis: Hypothesis; shell: Shell; firedAt: string; aimedAt: string };
export type ChipOutcome = "took" | "open" | "missed";

/** a chip took when the record moved after it was fired: a reply, or a paid order newer than the shot */
export function chipOutcome(chip: Chip, now: { replied: boolean; lastOrderDate: string | null }, today = new Date()): ChipOutcome {
  const fired = new Date(chip.firedAt).getTime();
  if (now.replied) return "took";
  if (now.lastOrderDate && new Date(now.lastOrderDate).getTime() > fired) return "took";
  return today.getTime() - fired > 14 * 86400_000 ? "missed" : "open";
}

export function accuracy(chips: Chip[], outcomes: ChipOutcome[]): { took: number; missed: number; open: number } {
  const n = { took: 0, missed: 0, open: 0 };
  chips.forEach((_, i) => {
    n[outcomes[i] ?? "open"] += 1;
  });
  return n;
}

/** how many shells are left tonight: three a night, the night being the local date */
export function shellsLeft(chips: Chip[], today = new Date()): number {
  const day = today.toDateString();
  const used = chips.filter(c => c.shell !== "none" && new Date(c.firedAt).toDateString() === day).length;
  return Math.max(0, SHELLS_PER_NIGHT - used);
}

/** the fuse: seconds left, from when the zombie was tazed */
export const fuseLeft = (tazedAtMs: number, nowMs: number) => Math.max(0, FUSE_SECONDS - (nowMs - tazedAtMs) / 1000);

/** nothing from the game may enter the text */
export const FORBIDDEN_IN_TEXT = /zombie|chip|shotgun|taze|taser|brain|microchip|wreck|washer|undead/i;
export const textIsClean = (text: string) => !FORBIDDEN_IN_TEXT.test(text);
