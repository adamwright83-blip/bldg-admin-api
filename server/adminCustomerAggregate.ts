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

export type OrderAggRow = {
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

/** Coerce Drizzle/MySQL shapes so aggregation never sees silent null/number bugs. */
export function normalizeOrderRowFromDb(r: {
  id: number;
  phone: string | null | undefined;
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  email: string | null | undefined;
  unit: string | null | undefined;
  address: string | null | undefined;
  buildingSlug: string | null | undefined;
  createdAt: Date;
  paid: boolean | number | null | undefined;
  total: string | null | undefined;
}): OrderAggRow {
  return {
    id: r.id,
    phone: r.phone != null ? String(r.phone) : "",
    firstName: r.firstName != null ? String(r.firstName) : "",
    lastName: r.lastName != null ? String(r.lastName) : "",
    email:
      r.email != null && String(r.email).trim() !== ""
        ? String(r.email).trim()
        : null,
    unit:
      r.unit != null && String(r.unit).trim() !== ""
        ? String(r.unit).trim()
        : null,
    address: r.address != null ? String(r.address) : "",
    buildingSlug:
      r.buildingSlug != null && String(r.buildingSlug).trim() !== ""
        ? String(r.buildingSlug).trim()
        : null,
    createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    paid: r.paid === true || r.paid === 1,
    total: r.total != null ? String(r.total) : null,
  };
}

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

/**
 * Merge identity/location across every order in the group (best rows first),
 * so name on one order + address on another + slug on a third still produce
 * one complete leaderboard row.
 */
function mergeDisplayFields(group: OrderAggRow[]): {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug: string | null;
} {
  const sorted = [...group].sort((a, b) => compareDisplayCandidates(b, a));

  let phone = "";
  let firstName = "";
  let lastName = "";
  let email: string | null = null;
  let unit: string | null = null;
  let address = "";
  let explicitSlug: string | null = null;

  for (const o of sorted) {
    if (!phone && o.phone.trim()) phone = o.phone.trim();
    if (!firstName && o.firstName.trim()) firstName = o.firstName.trim();
    if (!lastName && o.lastName.trim()) lastName = o.lastName.trim();
    if (email == null && o.email?.trim()) email = o.email.trim();
    if (!unit && o.unit != null && String(o.unit).trim())
      unit = String(o.unit).trim();
    if (!address && o.address.trim()) address = o.address.trim();
    if (!explicitSlug && o.buildingSlug?.trim())
      explicitSlug = o.buildingSlug.trim();
  }

  let inferredSlug: string | null = null;
  for (const o of group) {
    const hit = matchBuilding(normAddr(o.address));
    if (hit) {
      inferredSlug = hit.slug;
      break;
    }
  }

  const buildingSlug = explicitSlug ?? inferredSlug ?? null;

  return {
    phone,
    firstName,
    lastName,
    email,
    unit,
    address,
    buildingSlug,
  };
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

const MS_PER_DAY = 86400000;

function isWithinLastDaysUtc(createdAt: Date, days: number): boolean {
  const t = new Date(createdAt).getTime();
  const cutoff = Date.now() - days * MS_PER_DAY;
  return t >= cutoff;
}

/**
 * Build customer aggregate rows: metrics from full order history per key;
 * identity/location merged across all orders in the group (best rows first);
 * lastOrderId from true latest order.
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

    const display = mergeDisplayFields(group);
    const latest = pickLatestRow(group);

    out.push({
      phone: display.phone,
      firstName: display.firstName,
      lastName: display.lastName,
      email: display.email,
      unit: display.unit,
      address: display.address,
      buildingSlug: display.buildingSlug,
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
