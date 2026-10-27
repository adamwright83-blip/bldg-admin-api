/**
 * The front desk under a tower: Century Park East's numbers, read like a building at night.
 *
 * Six monitors, every figure real or plainly marked as not wired:
 * - THEN → NOW replays the windows lighting up, from each resident's own order dates.
 * - WHERE IT NEEDS TO BE is a light on every floor; one more home is priced at today's average.
 * - The revenue elevator climbs the building's paid orders in the last 30 days toward Adam's goal.
 * - MONEY GONE DIM is what quiet residents used to spend a month (an estimate, and labelled one).
 * - The doorman's log lists only our own events here: orders, first orders, residents going quiet.
 *   Never the concierge's packages or visitors; we don't see them.
 * - WHO'S BRINGING NEIGHBORS IN reads the referral copy, with how old it is.
 *
 * Money comes only from the canonical paid-order ledger, matched to residents by identity key. When the
 * ledger can't be read the money monitors say so; they never show $0 for "unknown".
 */
import type { ReferralActivityRow, ReferralSyncFreshness } from "./referralProgram";

export const TOWER_DESK_BUILDINGS = ["century_park_east", "opus_la"] as const;
export type TowerDeskBuildingId = (typeof TOWER_DESK_BUILDINGS)[number];

/**
 * The fallback monthly goal, in cents, used only until the operator saves one from the elevator
 * (tower_desk_goals). Null reads "Goal needed", never a number we picked for them. CPE's $800 is Adam's.
 */
export const TOWER_DESK_MONTHLY_GOAL_CENTS: Record<TowerDeskBuildingId, number | null> = {
  century_park_east: 80_000, // Adam, 2026-10-27: $800/month
  opus_la: null,
};

/** each tower's street address; the client's tower drawing and the server's resident match read the same patterns */
export const TOWER_ADDRESS_PATTERNS: Record<TowerDeskBuildingId, Record<string, RegExp>> = {
  opus_la: { south: /\b3545\s+wilshire\b/i, north: /\b3650\s+(?:w\.?|west)?\s*6th\b/i },
  century_park_east: { "2160": /\b2160\s+century\s+(?:park|pk)\b/i, "2170": /\b2170\s+century\s+(?:park|pk)\b/i },
};

export function isTowerAddress(buildingId: TowerDeskBuildingId, address: string | null | undefined): boolean {
  return Object.values(TOWER_ADDRESS_PATTERNS[buildingId]).some(re => re.test(address ?? ""));
}

/**
 * OPUS also has the gym-towel building contract. No ledger records it yet (the paid-order ledger holds residents'
 * laundry orders), so its lane says so instead of folding into, or hiding behind, resident revenue.
 */
const CONTRACT_LANE: Record<TowerDeskBuildingId, TowerDesk["contract"]> = {
  century_park_east: null,
  opus_la: { status: "not_wired", label: "Gym towel contract" },
};

/** what the elevator's goal field accepts: $1 to $1,000,000 a month */
export const GOAL_MIN_CENTS = 100;
export const GOAL_MAX_CENTS = 100_000_000;

export const QUIET_DAYS = 45;
export const RUN_RATE_DAYS = 30;
export const LEDGER_LOOKBACK_DAYS = 365;
const DAY_MS = 86_400_000;
const LOG_LIMIT = 10;

/** the unit a customer gave: the unit field, or failing that the apartment written into the address ("3545 Wilshire Blvd Apt#1607") */
export function unitOf(unit: string | null | undefined, address: string): string | null {
  if (unit && unit.trim()) return unit.trim();
  const m = /(?:\b(?:apt|apartment|unit|ste|suite)\.?\s*#?\s*|#\s*)([a-z0-9-]+)\b/i.exec(address);
  return m ? m[1] : null;
}

export type DeskResidentInput = {
  key: string;
  name: string;
  unit: string | null;
  /** every order this resident placed here, any order */
  orderedAt: Date[];
  identityKeys: string[];
};

export type DeskPaidEvent = { occurredAt: Date; cents: number; identityKeys: string[] };

export type DeskLedgerInput =
  | { status: "ok" | "partial"; events: DeskPaidEvent[]; startUtc: Date }
  | { status: "unavailable" };

export type DeskReferralInput =
  | { status: "ok"; source: "cleancloud" | "joystick"; rows: ReferralActivityRow[]; freshness: ReferralSyncFreshness | null }
  | { status: "unavailable" };

export type DeskResident = {
  key: string;
  name: string;
  unit: string | null;
  /** yyyy-mm-dd UTC, oldest first: the scrubber replays these */
  orderDays: string[];
};

export type DeskLogKind = "first_order" | "order" | "went_quiet";
export type DeskLogLine = { at: string; kind: DeskLogKind; unit: string | null; name: string };

export type TowerDesk = {
  buildingId: TowerDeskBuildingId;
  generatedAt: string;
  residents: DeskResident[];
  firstOrderDay: string | null;
  revenue: {
    /** "partial": a ledger source failed to load, so the figure may be low */
    status: "ok" | "partial" | "unavailable";
    last30Cents: number | null;
    payingResidents30: number | null;
    /** last30Cents ÷ paying residents: what one more lit home is worth at today's average */
    perHomeMonthlyCents: number | null;
  };
  goalMonthlyCents: number | null;
  /** "saved": the operator set it in the UI; "default": the fallback above; "none": nobody has */
  goalSource: "saved" | "default" | "none";
  /** a building contract paid apart from residents (OPUS's gym towels); null where there is none */
  contract: null | { status: "not_wired"; label: string };
  dim: {
    quietResidents: number;
    /** the quiet residents' own average month while they were ordering; null when money can't be read */
    estMonthlyCents: number | null;
  };
  log: DeskLogLine[];
  referrals:
    | { status: "unavailable" }
    | {
        status: "ok";
        source: "cleancloud" | "joystick";
        freshness: ReferralSyncFreshness | null;
        /** referrals where the referrer or the new customer is one of this building's residents (matched by name) */
        involving: number;
        converted: number;
        top: { name: string; unit: string | null; sent: number; converted: number }[];
      };
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, " ").trim();

export function buildTowerDesk(input: {
  buildingId: TowerDeskBuildingId;
  now: Date;
  residents: DeskResidentInput[];
  ledger: DeskLedgerInput;
  referrals: DeskReferralInput;
  /** the operator's saved goal; undefined when none is saved (or it couldn't be read) */
  savedGoalCents?: number;
}): TowerDesk {
  const { now } = input;
  const residents = input.residents
    .map(r => ({ ...r, orderedAt: [...r.orderedAt].sort((a, b) => a.getTime() - b.getTime()) }))
    .filter(r => r.orderedAt.length);
  const daysSince = (d: Date) => Math.floor((now.getTime() - d.getTime()) / DAY_MS);
  const quiet = residents.filter(r => daysSince(r.orderedAt.at(-1)!) >= QUIET_DAYS);

  let revenue: TowerDesk["revenue"] = { status: "unavailable", last30Cents: null, payingResidents30: null, perHomeMonthlyCents: null };
  let estMonthlyCents: number | null = null;
  if (input.ledger.status !== "unavailable") {
    const ledger = input.ledger;
    const owner = new Map<string, string>();
    for (const r of residents) for (const k of r.identityKeys) owner.set(k, r.key);
    const since30 = now.getTime() - RUN_RATE_DAYS * DAY_MS;
    let last30 = 0;
    const paying30 = new Set<string>();
    const paidByResident = new Map<string, number>();
    for (const e of ledger.events) {
      const key = e.identityKeys.map(k => owner.get(k)).find(Boolean);
      if (!key) continue;
      paidByResident.set(key, (paidByResident.get(key) ?? 0) + e.cents);
      if (e.occurredAt.getTime() >= since30 && e.occurredAt.getTime() <= now.getTime()) {
        last30 += e.cents;
        paying30.add(key);
      }
    }
    revenue = {
      status: ledger.status,
      last30Cents: last30,
      payingResidents30: paying30.size,
      perHomeMonthlyCents: paying30.size ? Math.round(last30 / paying30.size) : null,
    };
    // each quiet resident's own month: paid in the window ÷ the months they were ordering in it
    estMonthlyCents = Math.round(
      quiet.reduce((sum, r) => {
        const paid = paidByResident.get(r.key) ?? 0;
        if (!paid) return sum;
        const from = Math.max(r.orderedAt[0]!.getTime(), ledger.startUtc.getTime());
        const months = Math.max(1, (r.orderedAt.at(-1)!.getTime() - from) / (30 * DAY_MS));
        return sum + paid / months;
      }, 0)
    );
  }

  const log: DeskLogLine[] = [];
  for (const r of residents) {
    r.orderedAt.forEach((d, i) => log.push({ at: d.toISOString(), kind: i === 0 ? "first_order" : "order", unit: r.unit, name: r.name }));
    const last = r.orderedAt.at(-1)!;
    const quietAt = new Date(last.getTime() + QUIET_DAYS * DAY_MS);
    if (quietAt <= now) log.push({ at: quietAt.toISOString(), kind: "went_quiet", unit: r.unit, name: r.name });
  }
  log.sort((a, b) => b.at.localeCompare(a.at));

  let referrals: TowerDesk["referrals"] = { status: "unavailable" };
  if (input.referrals.status === "ok") {
    const byName = new Map(residents.map(r => [nameKey(r.name), r]));
    const rows = input.referrals.rows.filter(row => byName.has(nameKey(row.from)) || byName.has(nameKey(row.to)));
    const tally = new Map<string, { name: string; unit: string | null; sent: number; converted: number }>();
    for (const row of rows) {
      const from = byName.get(nameKey(row.from));
      if (!from) continue;
      const t = tally.get(from.key) ?? { name: from.name, unit: from.unit, sent: 0, converted: 0 };
      t.sent += 1;
      if (row.newCustomerOrders > 0) t.converted += 1;
      tally.set(from.key, t);
    }
    referrals = {
      status: "ok",
      source: input.referrals.source,
      freshness: input.referrals.freshness,
      involving: rows.length,
      converted: rows.filter(r => r.newCustomerOrders > 0).length,
      top: [...tally.values()].sort((a, b) => b.converted - a.converted || b.sent - a.sent).slice(0, 3),
    };
  }

  const firsts = residents.map(r => r.orderedAt[0]!.getTime());
  return {
    buildingId: input.buildingId,
    generatedAt: now.toISOString(),
    residents: residents.map(r => ({ key: r.key, name: r.name, unit: r.unit, orderDays: r.orderedAt.map(ymd) })),
    firstOrderDay: firsts.length ? ymd(new Date(Math.min(...firsts))) : null,
    revenue,
    goalMonthlyCents: input.savedGoalCents ?? TOWER_DESK_MONTHLY_GOAL_CENTS[input.buildingId],
    goalSource: input.savedGoalCents !== undefined ? "saved" : TOWER_DESK_MONTHLY_GOAL_CENTS[input.buildingId] !== null ? "default" : "none",
    contract: CONTRACT_LANE[input.buildingId],
    dim: { quietResidents: quiet.length, estMonthlyCents },
    log: log.slice(0, LOG_LIMIT),
    referrals,
  };
}

/** who has ordered by a given day, and who had gone quiet by then: the scrubber's frame */
export function residentsAsOf(residents: readonly DeskResident[], day: string): { key: string; quiet: boolean }[] {
  const dayMs = Date.parse(`${day}T00:00:00Z`);
  return residents.flatMap(r => {
    const before = r.orderDays.filter(d => d <= day);
    if (!before.length) return [];
    const last = Date.parse(`${before.at(-1)!}T00:00:00Z`);
    return [{ key: r.key, quiet: (dayMs - last) / DAY_MS >= QUIET_DAYS }];
  });
}
