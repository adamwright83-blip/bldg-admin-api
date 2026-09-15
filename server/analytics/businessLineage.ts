import { normalizePropertyTower } from "../../shared/propertyTowers";
import { identityKeysFor } from "./customerIdentityResolution";
import type { LaundryFarmServiceClass } from "./cleancloudServiceClass";

/**
 * Where a paid order came from, in Adam's business language.
 *
 * These distinctions are derived from evidence in the records, not asserted:
 * - Business line. Native Goldline orders are Laundry Butler's own order flow
 *   (the ledger has always keyed them `laundry_butler`). A CleanCloud order is
 *   Laundry Farm only when the tenant's GUMBALL store binding is the store
 *   labelled "Laundry Farm" — CleanCloud is that store's register. Without
 *   that binding a CleanCloud order stays unattributed rather than guessed.
 * - Processor. Native orders count only with a Stripe PaymentIntent. CleanCloud
 *   records the card processor itself ("Clearent Saved Card", "Clearent
 *   Terminal") or cash. Clearent's own processor exports are reconciliation
 *   evidence for those same orders, never additional revenue.
 * - Building. Resolved from the order's building slug or its address through
 *   the shared property-tower rules; a CleanCloud order for an OPUS LA or
 *   Century Park East resident is still a Laundry Farm register sale.
 */

export type LedgerSource = "laundry_butler" | "cleancloud";
export type BusinessLine = "laundry_butler" | "laundry_farm";
export type PaymentProcessor = "stripe" | "clearent" | "cash" | "other_or_unknown";
export type BuildingKey = "opusla" | "centuryparkeast";

export const BUSINESS_LINES: readonly BusinessLine[] = ["laundry_butler", "laundry_farm"];
export const PAYMENT_PROCESSORS: readonly PaymentProcessor[] = ["stripe", "clearent", "cash", "other_or_unknown"];
export const BUILDING_KEYS: readonly BuildingKey[] = ["opusla", "centuryparkeast"];

export const BUSINESS_LINE_LABEL: Record<BusinessLine, string> = {
  laundry_butler: "Laundry Butler",
  laundry_farm: "Laundry Farm",
};

export const SOURCE_LABEL: Record<LedgerSource, string> = {
  laundry_butler: "Goldline's own orders",
  cleancloud: "CleanCloud",
};

export const PROCESSOR_LABEL: Record<PaymentProcessor, string> = {
  stripe: "Stripe",
  clearent: "Clearent",
  cash: "cash",
  other_or_unknown: "an unrecorded payment method",
};

export const BUILDING_LABEL: Record<BuildingKey, string> = {
  opusla: "OPUS LA",
  centuryparkeast: "Century Park East",
};

export type OrderLineage = {
  businessLine: BusinessLine | null;
  processor: PaymentProcessor;
  building: BuildingKey | null;
};

export function cleanCloudBusinessLine(storeLabel: string | null | undefined): BusinessLine | null {
  return storeLabel && /\blaundry\s*farm\b/i.test(storeLabel) ? "laundry_farm" : null;
}

export function cleanCloudProcessor(
  paymentType: string | null | undefined,
  cardPaymentType: string | null | undefined
): PaymentProcessor {
  if (/clearent/i.test(cardPaymentType ?? "")) return "clearent";
  if (/^\s*cash\s*$/i.test(paymentType ?? "")) return "cash";
  return "other_or_unknown";
}

export function buildingFor(input: { buildingSlug?: string | null; address?: string | null }): BuildingKey | null {
  const slug = String(input.buildingSlug ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (slug === "opusla" || slug === "opus" || slug === "3650" || slug === "3545") return "opusla";
  if (slug === "centuryparkeast" || slug === "cpe" || slug === "2170" || slug === "2160") return "centuryparkeast";
  const tower = normalizePropertyTower(input.address ?? null);
  if (tower.propertyGroup === "opus_la") return "opusla";
  if (tower.propertyGroup === "century_park_east") return "centuryparkeast";
  return null;
}

export function serviceTypeFromCleanCloudClass(value: LaundryFarmServiceClass): "wash_fold" | "dry_cleaning" | null {
  if (value === "laundry") return "wash_fold";
  if (value === "dry_cleaning") return "dry_cleaning";
  return null;
}

// ── Filters ─────────────────────────────────────────────────────────────────

/** Minimal event shape the lineage filters need (PaidOrderEvent satisfies it). */
export type LineageEvent = {
  source: LedgerSource;
  cents: number;
  eventKey: string;
  businessLine?: BusinessLine | null;
  processor?: PaymentProcessor;
  building?: BuildingKey | null;
  address?: string | null;
  serviceClass?: LaundryFarmServiceClass | "native";
  identity: { phone?: string | null; email?: string | null; cleancloudCustomerId?: string | null; bldgUserId?: number | null };
};

export type LedgerFilters = {
  businessLines?: BusinessLine[] | null;
  /** Includes null = orders whose business line cannot be attributed. */
  processors?: PaymentProcessor[] | null;
  sources?: LedgerSource[] | null;
  includeBuildings?: BuildingKey[] | null;
  excludeBuildings?: BuildingKey[] | null;
  /** Every term must appear in the order's recorded address (case-insensitive). */
  addressTerms?: string[] | null;
  /** At least one of these whole words must appear in the address (e.g. neighborhood ZIP codes). */
  addressAny?: string[] | null;
  /** Spoken description of the address scope ("in Los Feliz"). Metadata only. */
  addressLabel?: string | null;
  /** Spoken name of the customer scope. Metadata only. */
  customerLabel?: string | null;
  /** Identity keys (phone:/email:/cleancloud:/bldg-user:); matching is by key overlap. */
  customerKeys?: string[] | null;
};

export function hasLineageFilters(filters: LedgerFilters | null | undefined): boolean {
  if (!filters) return false;
  return Boolean(
    filters.businessLines?.length ||
      filters.processors?.length ||
      filters.sources?.length ||
      filters.includeBuildings?.length ||
      filters.excludeBuildings?.length ||
      filters.addressTerms?.length ||
      filters.addressAny?.length ||
      filters.customerKeys?.length
  );
}

export function matchesLineageFilters(event: LineageEvent, filters: LedgerFilters | null | undefined): boolean {
  if (!filters) return true;
  if (filters.businessLines?.length && !(event.businessLine && filters.businessLines.includes(event.businessLine))) {
    return false;
  }
  if (filters.processors?.length && !filters.processors.includes(event.processor ?? "other_or_unknown")) return false;
  if (filters.sources?.length && !filters.sources.includes(event.source)) return false;
  if (filters.includeBuildings?.length && !(event.building && filters.includeBuildings.includes(event.building))) {
    return false;
  }
  if (filters.excludeBuildings?.length && event.building && filters.excludeBuildings.includes(event.building)) {
    return false;
  }
  if (filters.addressTerms?.length) {
    const address = String(event.address ?? "").toLowerCase();
    if (!filters.addressTerms.every(term => address.includes(term.toLowerCase()))) return false;
  }
  if (filters.addressAny?.length) {
    const address = String(event.address ?? "");
    const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!filters.addressAny.some(term => new RegExp(`\\b${escape(term)}\\b`, "i").test(address))) return false;
  }
  if (filters.customerKeys?.length) {
    const keys = identityKeysFor(event.identity);
    if (!keys.some(key => filters.customerKeys!.includes(key))) return false;
  }
  return true;
}

export function applyLineageFilters<T extends LineageEvent>(events: readonly T[], filters: LedgerFilters | null | undefined): T[] {
  if (!hasLineageFilters(filters)) return [...events];
  return events.filter(event => matchesLineageFilters(event, filters));
}

// ── Composition ─────────────────────────────────────────────────────────────

export type LineageSlice<K extends string> = { key: K; label: string; cents: number; orders: number };

export type LineageBreakdown = {
  total: { cents: number; orders: number };
  byBusinessLine: Array<LineageSlice<BusinessLine | "unattributed">>;
  bySource: Array<LineageSlice<LedgerSource>>;
  byProcessor: Array<LineageSlice<PaymentProcessor>>;
  byBuilding: Array<LineageSlice<BuildingKey>>;
  /** Laundry Farm register sales for OPUS LA / Century Park East residents. */
  laundryFarmBuildingResidents: { cents: number; orders: number };
  cleancloudUnclassifiedService: { cents: number; orders: number };
};

function slices<K extends string>(
  events: readonly LineageEvent[],
  keyOf: (event: LineageEvent) => K | null,
  label: (key: K) => string
): Array<LineageSlice<K>> {
  const map = new Map<K, LineageSlice<K>>();
  for (const event of events) {
    const key = keyOf(event);
    if (key === null) continue;
    const slice = map.get(key) ?? { key, label: label(key), cents: 0, orders: 0 };
    slice.cents += event.cents;
    slice.orders += 1;
    map.set(key, slice);
  }
  return Array.from(map.values()).sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key));
}

export function lineageBreakdown(events: readonly LineageEvent[]): LineageBreakdown {
  const sum = (list: readonly LineageEvent[]) => ({
    cents: list.reduce((total, event) => total + event.cents, 0),
    orders: list.length,
  });
  return {
    total: sum(events),
    byBusinessLine: slices<BusinessLine | "unattributed">(
      events,
      event => event.businessLine ?? "unattributed",
      key => (key === "unattributed" ? "unattributed" : BUSINESS_LINE_LABEL[key])
    ),
    bySource: slices<LedgerSource>(events, event => event.source, key => SOURCE_LABEL[key]),
    byProcessor: slices<PaymentProcessor>(
      events,
      event => event.processor ?? "other_or_unknown",
      key => PROCESSOR_LABEL[key]
    ),
    byBuilding: slices<BuildingKey>(events, event => event.building ?? null, key => BUILDING_LABEL[key]),
    laundryFarmBuildingResidents: sum(
      events.filter(event => event.businessLine === "laundry_farm" && event.building)
    ),
    cleancloudUnclassifiedService: sum(
      events.filter(
        event =>
          event.source === "cleancloud" &&
          (event.serviceClass === "mixed_needs_review" || event.serviceClass === "unknown_needs_review" || !event.serviceClass)
      )
    ),
  };
}

export type SliceDescriptor = { filters: LedgerFilters; label: string };

/**
 * Combining slices (e.g. "Stripe" + "Clearent", or "Laundry Farm" + "CleanCloud")
 * without double counting: an order counts once if it matches any slice.
 */
export function unionOfSlices<T extends LineageEvent>(events: readonly T[], slicesToCombine: readonly SliceDescriptor[]): {
  events: T[];
  overlapOrders: number;
  overlapCents: number;
} {
  let overlapOrders = 0;
  let overlapCents = 0;
  const matched: T[] = [];
  for (const event of events) {
    const hits = slicesToCombine.filter(slice => matchesLineageFilters(event, slice.filters)).length;
    if (hits === 0) continue;
    matched.push(event);
    if (hits > 1) {
      overlapOrders += 1;
      overlapCents += event.cents;
    }
  }
  return { events: matched, overlapOrders, overlapCents };
}

/** Human-readable basis for the lineage rules — spoken when asked "how do you know". */
export const LINEAGE_BASIS = {
  laundryButler: "Laundry Butler is Goldline's own order flow, counted only with a Stripe payment record.",
  laundryFarm: "Laundry Farm is the CleanCloud store GUMBALL is paired with; CleanCloud is that store's register.",
  clearent:
    "Clearent amounts come from CleanCloud's record of Clearent card payments. Clearent's own processor reports are reconciliation evidence, not extra revenue.",
} as const;
