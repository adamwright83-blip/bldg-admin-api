import { DC_ITEMS, type DryCleanEntry } from "@shared/pricing";
import {
  dryCleanLineKey,
  parseDryCleanLineKey,
  type DryCleanerRow,
} from "@shared/dryCleaners";

export type DryCleanCatalogRow = {
  slug: string;
  name: string;
  category: string;
  standardPriceCents: number;
};

type CatalogRow = DryCleanCatalogRow & {
  serviceType?: string | null;
};

const STANDARD_DRY_CLEAN_CATALOG: DryCleanCatalogRow[] = DC_ITEMS.map(item => ({
  slug: item.id,
  name: item.label,
  category: item.category,
  standardPriceCents: item.priceCents,
}));

/**
 * Keep the complete standard counter menu available for every tenant. Custom
 * tenant rows override matching standard slugs and are appended when they are
 * new garment types, so adding one custom SKU can never hide every other item.
 */
export function resolveDryCleanCatalogRows(
  rows: CatalogRow[] | undefined
): DryCleanCatalogRow[] {
  const tenantRows = (rows ?? [])
    .filter(row => {
      const serviceType = row.serviceType ?? "dry_clean";
      return serviceType === "dry_clean" || serviceType === "alteration";
    })
    .map(({ slug, name, category, standardPriceCents }) => ({
      slug,
      name,
      category,
      standardPriceCents,
    }));

  const tenantBySlug = new Map(tenantRows.map(row => [row.slug, row]));
  const standardSlugs = new Set(
    STANDARD_DRY_CLEAN_CATALOG.map(row => row.slug)
  );

  return [
    ...STANDARD_DRY_CLEAN_CATALOG.map(
      standardRow => tenantBySlug.get(standardRow.slug) ?? standardRow
    ),
    ...tenantRows.filter(row => !standardSlugs.has(row.slug)),
  ];
}

/* ===== Per-cleaner menus =====
 * COAST 1hr CLEANERS is the base-catalog partner, so its menu is the tenant
 * catalog exactly as before. Every other partner shows only the garments we
 * have actually priced with them — an empty menu is the honest state, not a
 * reason to copy Coast's list across. */

export type CleanerMenuRow = {
  /** Key used in dcQtys and in drycleanItemsJson. */
  lineKey: string;
  itemSlug: string;
  name: string;
  category: string;
  /** Customer-facing price — the only figure order entry shows. */
  customerPriceCents: number;
  cleanerRetailPriceCents: number | null;
  partnerDiscountPct: number | null;
  cleanerCostCents: number | null;
};

export type CleanerMenu = {
  cleaner: DryCleanerRow;
  rows: CleanerMenuRow[];
};

export type CleanerItemPriceRow = {
  cleanerSlug: string;
  cleanerId: number;
  catalogItemId: number;
  slug: string;
  name: string;
  category: string;
  customerPriceCents: number;
  cleanerRetailPriceCents: number | null;
  partnerDiscountPct: number | null;
  actualCleanerCostCents: number | null;
};

export function resolveCleanerMenus(input: {
  cleaners: DryCleanerRow[];
  baseCatalogRows: DryCleanCatalogRow[];
  itemPrices: CleanerItemPriceRow[];
}): CleanerMenu[] {
  const { cleaners, baseCatalogRows, itemPrices } = input;
  return cleaners.map(cleaner => {
    if (cleaner.usesBaseCatalog) {
      return {
        cleaner,
        rows: baseCatalogRows.map(row => ({
          lineKey: dryCleanLineKey(cleaner.slug, row.slug),
          itemSlug: row.slug,
          name: row.name,
          category: row.category,
          customerPriceCents: row.standardPriceCents,
          cleanerRetailPriceCents: null,
          partnerDiscountPct: null,
          cleanerCostCents: null,
        })),
      };
    }
    return {
      cleaner,
      rows: itemPrices
        .filter(p => p.cleanerSlug === cleaner.slug)
        .map(p => ({
          lineKey: dryCleanLineKey(cleaner.slug, p.slug),
          itemSlug: p.slug,
          name: p.name,
          category: p.category,
          customerPriceCents: p.customerPriceCents,
          cleanerRetailPriceCents: p.cleanerRetailPriceCents,
          partnerDiscountPct: p.partnerDiscountPct,
          cleanerCostCents: p.actualCleanerCostCents,
        })),
    };
  });
}

/**
 * Build `drycleanItemsJson` from the quantities picked across every cleaner tab.
 *
 * Each line snapshots the cleaner and the economics in force at the moment of
 * sale, so later catalog edits can never rewrite a past order. Quantities whose
 * garment has since left a cleaner's menu fall back to the values already saved
 * on the order — again, never to $0.
 */
export function buildCleanerLineItems(
  menus: CleanerMenu[],
  qtys: Record<string, number>,
  savedJson: Record<string, DryCleanEntry> | null | undefined
): Record<string, DryCleanEntry> {
  const byKey = new Map<string, { menu: CleanerMenu; row: CleanerMenuRow }>();
  for (const menu of menus) {
    for (const row of menu.rows) byKey.set(row.lineKey, { menu, row });
  }

  const out: Record<string, DryCleanEntry> = {};
  for (const [lineKey, qty] of Object.entries(qtys)) {
    if (!qty || qty <= 0) continue;
    const hit = byKey.get(lineKey);
    if (hit) {
      const { menu, row } = hit;
      const entry: DryCleanEntry = {
        label: row.name,
        category: row.category,
        unit_price_cents: row.customerPriceCents,
        qty,
        total_cents: row.customerPriceCents * qty,
        cleaner_slug: menu.cleaner.slug,
        cleaner_name: menu.cleaner.displayName,
      };
      if (menu.cleaner.id > 0) entry.cleaner_id = menu.cleaner.id;
      if (row.cleanerRetailPriceCents != null) {
        entry.cleaner_retail_price_cents = row.cleanerRetailPriceCents;
      }
      if (row.partnerDiscountPct != null) {
        entry.partner_discount_pct = row.partnerDiscountPct;
      }
      if (row.cleanerCostCents != null) {
        entry.cleaner_cost_cents = row.cleanerCostCents;
      }
      out[lineKey] = entry;
    } else if (savedJson && savedJson[lineKey]) {
      const saved = savedJson[lineKey];
      out[lineKey] = {
        ...saved,
        qty,
        total_cents: saved.unit_price_cents * qty,
      };
    }
  }
  return out;
}

/** Cleaner a saved line belongs to. Pre-multi-cleaner lines are Coast. */
export function cleanerSlugForLine(
  lineKey: string,
  entry: DryCleanEntry | undefined
): string {
  return entry?.cleaner_slug ?? parseDryCleanLineKey(lineKey).cleanerSlug;
}
