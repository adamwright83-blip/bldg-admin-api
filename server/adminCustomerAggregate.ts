import { matchBuilding } from "@shared/buildings";

export type AdminCustomerAggregateDbRow = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug: string | null;
  totalOrders: number;
  lifetimeSpend: number;
  paidOrderCount: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  lastOrderId: number;
  ordersLast30Days: number;
  ordersLast90Days: number;
};

/** Composite fallback when phone is missing or too short to trust as identity. */
export function computeAdminCustomerKey(order: {
  phone: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  unit: string | null | undefined;
  buildingSlug: string | null | undefined;
  address: string | null | undefined;
}): string {
  const t = (v: unknown) =>
    typeof v === "string" ? v.trim().toLowerCase() : "";
  return [
    `p:${t(order.phone)}`,
    `fn:${t(order.firstName)}`,
    `ln:${t(order.lastName)}`,
    `u:${t(order.unit)}`,
    `b:${t(order.buildingSlug)}`,
    `a:${t(order.address)}`,
  ].join("|");
}

function digitCount(phone: string): number {
  return phone.replace(/\D/g, "").length;
}

/**
 * One row per real customer for the leaderboard: group by normalized digits when
 * phone has enough digits; otherwise composite key (guest / bad phone rows).
 */
export function computeCustomerGroupKey(order: {
  phone: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  unit: string | null | undefined;
  buildingSlug: string | null | undefined;
  address: string | null | undefined;
}): string {
  const raw = typeof order.phone === "string" ? order.phone.trim() : "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 7) {
    return `phone:${digits}`;
  }
  return `composite:${computeAdminCustomerKey(order)}`;
}

type OrderAggRow = {
  id: number;
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug: string | null;
  createdAt: Date;
  paid: boolean;
  total: string | null;
};

function normAddr(s: string | null | undefined): string {
  if (s == null || typeof s !== "string") return "";
  return s.trim().toLowerCase();
}

/** Higher = better candidate for display / identity. */
function displayTier(o: OrderAggRow): number {
  if (o.buildingSlug?.trim()) return 4;
  if (matchBuilding(normAddr(o.address))) return 3;
  if (
    o.firstName?.trim() ||
    o.lastName?.trim() ||
    (o.unit != null && String(o.unit).trim())
  ) {
    return 2;
  }
  return 1;
}

/** Among same tier, prefer newer order (more current), then higher id. */
function compareDisplayCandidates(a: OrderAggRow, b: OrderAggRow): number {
  const ta = displayTier(a);
  const tb = displayTier(b);
  if (tb !== ta) return tb - ta;
  const da = new Date(a.createdAt).getTime();
  const db = new Date(b.createdAt).getTime();
  if (db !== da) return db > da ? 1 : db < da ? -1 : 0;
  return b.id - a.id;
}

function pickBestDisplayRow(group: OrderAggRow[]): OrderAggRow {
  let best = group[0];
  for (let i = 1; i < group.length; i++) {
    // compareDisplayCandidates(a,b) > 0 means b is better than a
    if (compareDisplayCandidates(best, group[i]) > 0) best = group[i];
  }
  return best;
}

/** True chronological latest (for lastOrderId). */
function pickLatestRow(group: OrderAggRow[]): OrderAggRow {
  let best = group[0];
  for (let i = 1; i < group.length; i++) {
    const a = best;
    const b = group[i];
    const da = new Date(a.createdAt).getTime();
    const db = new Date(b.createdAt).getTime();
    if (db > da || (db === da && b.id > a.id)) best = b;
  }
  return best;
}

function resolveDisplayBuildingSlug(row: OrderAggRow): string | null {
  const s = row.buildingSlug?.trim();
  if (s) return s;
  return matchBuilding(normAddr(row.address))?.slug ?? null;
}

const MS_PER_DAY = 86400000;

function isWithinLastDaysUtc(createdAt: Date, days: number): boolean {
  const t = new Date(createdAt).getTime();
  const cutoff = Date.now() - days * MS_PER_DAY;
  return t >= cutoff;
}

/**
 * Build customer aggregate rows: metrics from full order history per key;
 * identity/location from best display row; lastOrderId from true latest order.
 */
export function buildAdminCustomerAggregatesInMemory(
  rows: OrderAggRow[]
): AdminCustomerAggregateDbRow[] {
  const byKey = new Map<string, OrderAggRow[]>();
  for (const o of rows) {
    const key = computeCustomerGroupKey(o);
    const arr = byKey.get(key);
    if (arr) arr.push(o);
    else byKey.set(key, [o]);
  }

  const out: AdminCustomerAggregateDbRow[] = [];

  for (const group of byKey.values()) {
    if (group.length === 0) continue;

    let totalOrders = 0;
    let lifetimeSpend = 0;
    let paidOrderCount = 0;
    let firstOrderAt = group[0].createdAt;
    let lastOrderAt = group[0].createdAt;
    let ordersLast30Days = 0;
    let ordersLast90Days = 0;

    for (const o of group) {
      totalOrders += 1;
      const ct = new Date(o.createdAt).getTime();
      if (new Date(firstOrderAt).getTime() > ct) firstOrderAt = o.createdAt;
      if (new Date(lastOrderAt).getTime() < ct) lastOrderAt = o.createdAt;

      if (o.paid) {
        paidOrderCount += 1;
        const amt = parseFloat(String(o.total ?? "0"));
        if (Number.isFinite(amt)) lifetimeSpend += amt;
      }
      if (isWithinLastDaysUtc(o.createdAt, 30)) ordersLast30Days += 1;
      if (isWithinLastDaysUtc(o.createdAt, 90)) ordersLast90Days += 1;
    }

    lifetimeSpend = Math.round(lifetimeSpend * 100) / 100;

    const best = pickBestDisplayRow(group);
    const latest = pickLatestRow(group);
    const displaySlug = resolveDisplayBuildingSlug(best);

    out.push({
      phone: typeof best.phone === "string" ? best.phone : "",
      firstName: typeof best.firstName === "string" ? best.firstName : "",
      lastName: typeof best.lastName === "string" ? best.lastName : "",
      email: best.email ?? null,
      unit: best.unit ?? null,
      address: typeof best.address === "string" ? best.address : "",
      buildingSlug: displaySlug,
      totalOrders,
      lifetimeSpend,
      paidOrderCount,
      firstOrderAt,
      lastOrderAt,
      lastOrderId: latest.id,
      ordersLast30Days,
      ordersLast90Days,
    });
  }

  return out;
}
