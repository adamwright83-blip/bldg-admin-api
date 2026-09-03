/**
 * Dry-cleaning partners (cleaners) and their per-item economics.
 *
 * Laundry Farm sends garments to more than one cleaner, and a single customer
 * order may be split across cleaners. The cleaner is therefore a property of an
 * ORDER LINE, never of the order.
 *
 * COAST 1hr CLEANERS is the historical/base partner: every `catalog_items` row
 * is Coast's price list, which is why Coast lines keep the legacy line key
 * (the bare catalog slug) and no Coast pricing has to be migrated anywhere.
 * Additional cleaners (PARAGON CLEANERS today) carry their own explicit price
 * rows; a garment with no row for a cleaner is NOT $0 — it is not offered.
 */

export const COAST_CLEANER_SLUG = "coast_1hr";
export const PARAGON_CLEANER_SLUG = "paragon";

export const COAST_CLEANER_NAME = "COAST 1hr CLEANERS";
export const PARAGON_CLEANER_NAME = "PARAGON CLEANERS";

/** Coast has historically given us 40% off retail (see shared/pricing.ts). */
export const COAST_DEFAULT_PARTNER_DISCOUNT_PCT = 40;
/** Paragon's stated partnership discount. A DEFAULT only — overridable per item. */
export const PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT = 15;

export type DryCleanerRow = {
  id: number;
  slug: string;
  displayName: string;
  defaultPartnerDiscountPct: number;
  /** True for COAST: its catalog is `catalog_items` itself. */
  usesBaseCatalog: boolean;
  sortOrder: number;
  isActive: boolean;
};

/* ===== Line keys =====
 * Coast lines keep the bare catalog slug so every historical order (and every
 * downstream consumer that reads `drycleanItemsJson`) keeps working untouched.
 * Other cleaners are namespaced. */

const KEY_SEPARATOR = "::";

export function dryCleanLineKey(cleanerSlug: string, itemSlug: string): string {
  return cleanerSlug === COAST_CLEANER_SLUG
    ? itemSlug
    : `${cleanerSlug}${KEY_SEPARATOR}${itemSlug}`;
}

export function parseDryCleanLineKey(key: string): {
  cleanerSlug: string;
  itemSlug: string;
} {
  const idx = key.indexOf(KEY_SEPARATOR);
  if (idx === -1) return { cleanerSlug: COAST_CLEANER_SLUG, itemSlug: key };
  return {
    cleanerSlug: key.slice(0, idx),
    itemSlug: key.slice(idx + KEY_SEPARATOR.length),
  };
}

/* ===== Economics =====
 * Every value below is derived at call time from the numbers actually recorded
 * for a transaction. No margin is a constant anywhere in this file. */

/** What Laundry Farm actually pays the cleaner, after the discount actually received. */
export function cleanerCostCents(
  cleanerRetailPriceCents: number,
  partnerDiscountPct: number
): number {
  const pct = Math.min(Math.max(partnerDiscountPct, 0), 100);
  return Math.round(cleanerRetailPriceCents * (1 - pct / 100));
}

export function grossProfitCents(
  customerPriceCents: number,
  actualCostCents: number
): number {
  return customerPriceCents - actualCostCents;
}

/** Gross margin as a percentage of the customer price. Null when there is no revenue. */
export function grossMarginPct(
  customerPriceCents: number,
  actualCostCents: number
): number | null {
  if (customerPriceCents <= 0) return null;
  return (
    (grossProfitCents(customerPriceCents, actualCostCents) /
      customerPriceCents) *
    100
  );
}

export type DryCleanEconomics = {
  cleanerRetailPriceCents: number;
  partnerDiscountPct: number;
  actualCleanerCostCents: number;
  customerPriceCents: number;
  grossProfitCents: number;
  grossMarginPct: number | null;
};

export function computeDryCleanEconomics(input: {
  cleanerRetailPriceCents: number;
  partnerDiscountPct: number;
  customerPriceCents: number;
}): DryCleanEconomics {
  const actual = cleanerCostCents(
    input.cleanerRetailPriceCents,
    input.partnerDiscountPct
  );
  return {
    cleanerRetailPriceCents: input.cleanerRetailPriceCents,
    partnerDiscountPct: input.partnerDiscountPct,
    actualCleanerCostCents: actual,
    customerPriceCents: input.customerPriceCents,
    grossProfitCents: grossProfitCents(input.customerPriceCents, actual),
    grossMarginPct: grossMarginPct(input.customerPriceCents, actual),
  };
}
