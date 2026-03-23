import { matchBuilding } from "@shared/buildings";
import {
  computeCustomerTier,
  computeRecencyStatus,
  daysSince,
  STATUS_COLOR_BY_RECENCY,
  type CustomerRecencyStatus,
  type CustomerTier,
  type StatusColorToken,
} from "@shared/customerStatus";
import type { Order } from "../drizzle/schema";

export function deriveBuildingSlug(order: Pick<Order, "buildingSlug" | "address">): string | null {
  const s = order.buildingSlug?.trim();
  if (s) return s;
  return matchBuilding(order.address)?.slug ?? null;
}

/**
 * Floor derivation from unit strings.
 * Example: "1205" -> 12. Falls back to null if non-numeric/insufficient signal.
 */
export function deriveFloorNumber(unit: string | null | undefined): number | null {
  if (!unit) return null;
  const digits = unit.replace(/\D/g, "");
  if (digits.length < 3) return null;
  const floor = parseInt(digits.slice(0, -2), 10);
  if (!Number.isFinite(floor) || floor <= 0) return null;
  return floor;
}

function sortOrdersNewestFirst(rows: Order[]): Order[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (tb !== ta) return tb - ta;
    return b.id - a.id;
  });
}

/** Sum of total for paid orders only (documented product rule). */
export function lifetimeSpendPaidOnly(rows: Order[]): number {
  let sum = 0;
  for (const o of rows) {
    if (!o.paid) continue;
    const t = parseFloat(String(o.total ?? "0"));
    if (Number.isFinite(t)) sum += t;
  }
  return Math.round(sum * 100) / 100;
}

export type CustomerOrderLine = {
  id: number;
  createdAt: Date;
  serviceType: Order["serviceType"];
  total: string | null;
  paid: boolean;
  status: Order["status"];
  adminReceiptHref: string;
  externalReceiptUrl: string | null;
};

export type CustomerProfilePayload = {
  phone: string;
  overview: {
    firstName: string;
    lastName: string;
    email: string | null;
    unit: string | null;
    buildingSlug: string | null;
    address: string;
    lifetimeSpend: number;
    totalOrders: number;
    firstOrderAt: Date | null;
    lastOrderAt: Date | null;
    lastOrderId: number | null;
    avgOrderValue: number | null;
    daysSinceLastOrder: number;
    ordersLast30Days: number;
    ordersLast90Days: number;
    recencyStatus: CustomerRecencyStatus;
    tier: CustomerTier;
    statusColor: StatusColorToken;
    bldgUserIds: number[];
  };
  orders: CustomerOrderLine[];
};

export function buildCustomerProfile(phone: string, rows: Order[]): CustomerProfilePayload | null {
  if (rows.length === 0) return null;

  const sorted = sortOrdersNewestFirst(rows);
  const latest = sorted[0];
  const spend = lifetimeSpendPaidOnly(sorted);
  const paidOrders = sorted.filter((o) => o.paid);
  const avgOrderValue =
    paidOrders.length > 0 ? Math.round((spend / paidOrders.length) * 100) / 100 : null;
  const firstOrderAt = sorted[sorted.length - 1].createdAt;
  const lastOrderAt = latest.createdAt;
  const ordersLast30Days = sorted.filter((o) => daysSince(o.createdAt) <= 30).length;
  const ordersLast90Days = sorted.filter((o) => daysSince(o.createdAt) <= 90).length;
  const recencyStatus = computeRecencyStatus({
    totalOrders: sorted.length,
    firstOrderAt,
    lastOrderAt,
  });
  const tier = computeCustomerTier({ lifetimeSpend: spend, totalOrders: sorted.length });
  const statusColor = STATUS_COLOR_BY_RECENCY[recencyStatus];

  const bldgUserIds = [
    ...new Set(
      sorted.map((o) => o.bldgUserId).filter((id): id is number => id != null && id > 0)
    ),
  ];

  const orders: CustomerOrderLine[] = sorted.map((o) => {
    let external: string | null = null;
    if (o.portalJwt) {
      const j = o.portalJwt.trim();
      if (j.startsWith("http://") || j.startsWith("https://")) external = j;
    }
    return {
      id: o.id,
      createdAt: o.createdAt,
      serviceType: o.serviceType,
      total: o.total != null ? String(o.total) : null,
      paid: o.paid,
      status: o.status,
      adminReceiptHref: `/receipt/${o.id}`,
      externalReceiptUrl: external,
    };
  });

  return {
    phone,
    overview: {
      firstName: latest.firstName,
      lastName: latest.lastName,
      email: latest.email ?? null,
      unit: latest.unit ?? null,
      buildingSlug: deriveBuildingSlug(latest),
      address: latest.address,
      lifetimeSpend: spend,
      totalOrders: sorted.length,
      firstOrderAt,
      lastOrderAt,
      lastOrderId: latest.id,
      avgOrderValue,
      daysSinceLastOrder: daysSince(lastOrderAt),
      ordersLast30Days,
      ordersLast90Days,
      recencyStatus,
      tier,
      statusColor,
      bldgUserIds,
    },
    orders,
  };
}

export type CustomerAggregateRow = {
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  buildingSlug: string | null;
  floorNumber: number | null;
  address: string;
  totalOrders: number;
  lifetimeSpend: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  lastOrderId: number;
  avgOrderValue: number | null;
  daysSinceLastOrder: number;
  ordersLast30Days: number;
  ordersLast90Days: number;
  recencyStatus: CustomerRecencyStatus;
  tier: CustomerTier;
  statusColor: StatusColorToken;
  bldgUserIds: number[];
};

export type CustomerAggregateDbRow = {
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

export function hydrateCustomerAggregates(rows: CustomerAggregateDbRow[]): CustomerAggregateRow[] {
  return rows.map((r) => {
    const lifetimeSpend = Math.round(Number(r.lifetimeSpend || 0) * 100) / 100;
    const paidOrderCount = Number(r.paidOrderCount || 0);
    const avgOrderValue =
      paidOrderCount > 0 ? Math.round((lifetimeSpend / paidOrderCount) * 100) / 100 : null;
    const recencyStatus = computeRecencyStatus({
      totalOrders: Number(r.totalOrders || 0),
      firstOrderAt: r.firstOrderAt,
      lastOrderAt: r.lastOrderAt,
    });
    const tier = computeCustomerTier({
      lifetimeSpend,
      totalOrders: Number(r.totalOrders || 0),
    });

    return {
      phone: r.phone,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email ?? null,
      unit: r.unit ?? null,
      buildingSlug: r.buildingSlug?.trim() || matchBuilding(r.address)?.slug || null,
      floorNumber: deriveFloorNumber(r.unit),
      address: r.address,
      totalOrders: Number(r.totalOrders || 0),
      lifetimeSpend,
      firstOrderAt: r.firstOrderAt,
      lastOrderAt: r.lastOrderAt,
      lastOrderId: Number(r.lastOrderId || 0),
      avgOrderValue,
      daysSinceLastOrder: daysSince(r.lastOrderAt),
      ordersLast30Days: Number(r.ordersLast30Days || 0),
      ordersLast90Days: Number(r.ordersLast90Days || 0),
      recencyStatus,
      tier,
      statusColor: STATUS_COLOR_BY_RECENCY[recencyStatus],
      bldgUserIds: [],
    };
  });
}
