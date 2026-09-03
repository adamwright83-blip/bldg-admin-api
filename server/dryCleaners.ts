import { and, asc, eq } from "drizzle-orm";
import {
  catalogItems,
  dryCleaners,
  dryCleanerItemPrices,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  COAST_CLEANER_NAME,
  COAST_CLEANER_SLUG,
  COAST_DEFAULT_PARTNER_DISCOUNT_PCT,
  PARAGON_CLEANER_NAME,
  PARAGON_CLEANER_SLUG,
  PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT,
  computeDryCleanEconomics,
  type DryCleanerRow,
} from "@shared/dryCleaners";

/** Menu row as the counter sees it: one garment offered by one cleaner. */
export type DryCleanerCatalogRow = {
  cleanerSlug: string;
  cleanerId: number;
  catalogItemId: number;
  slug: string;
  name: string;
  category: string;
  /** Customer-facing price — the only number order entry needs. */
  customerPriceCents: number;
  /** Cleaner economics. Null for COAST base-catalog rows, whose per-item
   * retail is not tracked separately from the shared catalog. */
  cleanerRetailPriceCents: number | null;
  partnerDiscountPct: number | null;
  actualCleanerCostCents: number | null;
};

function toPct(value: string | number | null): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The partners for a tenant. Falls back to the two known partners when the
 * table has not been seeded yet (fresh dev DB), so New Order is never empty.
 */
export async function listDryCleanersForTenant(
  tenantId: string
): Promise<DryCleanerRow[]> {
  const db = await getDb();
  const fallback: DryCleanerRow[] = [
    {
      id: -1,
      slug: COAST_CLEANER_SLUG,
      displayName: COAST_CLEANER_NAME,
      defaultPartnerDiscountPct: COAST_DEFAULT_PARTNER_DISCOUNT_PCT,
      usesBaseCatalog: true,
      sortOrder: 0,
      isActive: true,
    },
    {
      id: -2,
      slug: PARAGON_CLEANER_SLUG,
      displayName: PARAGON_CLEANER_NAME,
      defaultPartnerDiscountPct: PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT,
      usesBaseCatalog: false,
      sortOrder: 1,
      isActive: true,
    },
  ];
  if (!db) return fallback;

  const rows = await db
    .select()
    .from(dryCleaners)
    .where(
      and(eq(dryCleaners.tenantId, tenantId), eq(dryCleaners.isActive, true))
    )
    .orderBy(asc(dryCleaners.sortOrder), asc(dryCleaners.id));

  if (rows.length === 0) return fallback;

  return rows.map(r => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    defaultPartnerDiscountPct: toPct(r.defaultPartnerDiscountPct) ?? 0,
    usesBaseCatalog: Boolean(r.usesBaseCatalog),
    sortOrder: r.sortOrder,
    isActive: Boolean(r.isActive),
  }));
}

export async function getDryCleanerBySlug(
  tenantId: string,
  slug: string
): Promise<DryCleanerRow | null> {
  const all = await listDryCleanersForTenant(tenantId);
  return all.find(c => c.slug === slug) ?? null;
}

/**
 * Explicit per-cleaner price rows (i.e. every cleaner except the base-catalog
 * one). A garment with no row here is not offered by that cleaner — it is NOT
 * priced at $0.
 */
export async function listDryCleanerItemPricesForTenant(
  tenantId: string
): Promise<DryCleanerCatalogRow[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select({
      cleanerSlug: dryCleaners.slug,
      cleanerId: dryCleaners.id,
      defaultPartnerDiscountPct: dryCleaners.defaultPartnerDiscountPct,
      catalogItemId: catalogItems.id,
      slug: catalogItems.slug,
      name: catalogItems.name,
      category: catalogItems.category,
      cleanerRetailPriceCents: dryCleanerItemPrices.cleanerRetailPriceCents,
      partnerDiscountPct: dryCleanerItemPrices.partnerDiscountPct,
      customerPriceCents: dryCleanerItemPrices.customerPriceCents,
    })
    .from(dryCleanerItemPrices)
    .innerJoin(
      dryCleaners,
      eq(dryCleaners.id, dryCleanerItemPrices.dryCleanerId)
    )
    .innerJoin(
      catalogItems,
      eq(catalogItems.id, dryCleanerItemPrices.catalogItemId)
    )
    .where(
      and(
        eq(dryCleanerItemPrices.tenantId, tenantId),
        eq(dryCleanerItemPrices.isActive, true),
        eq(dryCleaners.isActive, true),
        eq(catalogItems.archived, false)
      )
    )
    .orderBy(asc(dryCleaners.sortOrder), asc(catalogItems.sortOrder));

  return rows.map(r => {
    const discount =
      toPct(r.partnerDiscountPct) ?? toPct(r.defaultPartnerDiscountPct) ?? 0;
    const econ = computeDryCleanEconomics({
      cleanerRetailPriceCents: r.cleanerRetailPriceCents,
      partnerDiscountPct: discount,
      customerPriceCents: r.customerPriceCents,
    });
    return {
      cleanerSlug: r.cleanerSlug,
      cleanerId: r.cleanerId,
      catalogItemId: r.catalogItemId,
      slug: r.slug,
      name: r.name,
      category: r.category,
      customerPriceCents: r.customerPriceCents,
      cleanerRetailPriceCents: r.cleanerRetailPriceCents,
      partnerDiscountPct: discount,
      actualCleanerCostCents: econ.actualCleanerCostCents,
    };
  });
}

/**
 * Record what a cleaner charges for a garment and what we charge the customer.
 * Creates the garment in `catalog_items` when it is new, but never touches an
 * existing garment's shared (Coast) price — learning Paragon's price for a
 * garment must not reprice Coast's.
 */
export async function saveDryCleanerItemPrice(input: {
  tenantId: string;
  cleanerSlug: string;
  /** Existing garment, when the operator picked one. */
  catalogItemId?: number;
  /** New garment fields, used only when catalogItemId is absent. */
  name?: string;
  category?: string;
  cleanerRetailPriceCents: number;
  /** Discount actually agreed for this item. Null = inherit cleaner default. */
  partnerDiscountPct: number | null;
  customerPriceCents: number;
}): Promise<{ catalogItemId: number; slug: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [cleaner] = await db
    .select()
    .from(dryCleaners)
    .where(
      and(
        eq(dryCleaners.tenantId, input.tenantId),
        eq(dryCleaners.slug, input.cleanerSlug)
      )
    )
    .limit(1);
  if (!cleaner) throw new Error(`Unknown dry cleaner: ${input.cleanerSlug}`);
  if (cleaner.usesBaseCatalog) {
    throw new Error(
      `${cleaner.displayName} pricing is managed in Catalog, not per-cleaner.`
    );
  }

  let catalogItemId = input.catalogItemId ?? null;
  let slug: string;

  if (catalogItemId != null) {
    const [existing] = await db
      .select({ slug: catalogItems.slug })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.id, catalogItemId),
          eq(catalogItems.tenantId, input.tenantId)
        )
      )
      .limit(1);
    if (!existing) throw new Error("Garment not found for this tenant");
    slug = existing.slug;
  } else {
    const name = (input.name ?? "").trim();
    if (!name) throw new Error("Garment name is required");
    slug = slugifyGarment(name);
    const [existing] = await db
      .select({ id: catalogItems.id })
      .from(catalogItems)
      .where(
        and(
          eq(catalogItems.tenantId, input.tenantId),
          eq(catalogItems.slug, slug)
        )
      )
      .limit(1);
    if (existing) {
      /* Garment already exists (likely a Coast garment). Reuse it — a Paragon
       * price is an additional row, never a duplicate garment. */
      catalogItemId = existing.id;
    } else {
      const inserted = await db.insert(catalogItems).values({
        tenantId: input.tenantId,
        slug,
        name,
        category: (input.category ?? "Other").trim() || "Other",
        serviceType: "dry_clean",
        /* Not offered by the base-catalog cleaner until someone prices it there. */
        standardPriceCents: input.customerPriceCents,
        isActive: true,
        isOnline: false,
      });
      catalogItemId = Number(
        (inserted as unknown as { insertId: number }).insertId ??
          (inserted as unknown as [{ insertId: number }])[0]?.insertId
      );
    }
  }

  const discountValue =
    input.partnerDiscountPct === null
      ? null
      : String(input.partnerDiscountPct.toFixed(2));

  await db
    .insert(dryCleanerItemPrices)
    .values({
      tenantId: input.tenantId,
      dryCleanerId: cleaner.id,
      catalogItemId: catalogItemId!,
      cleanerRetailPriceCents: input.cleanerRetailPriceCents,
      partnerDiscountPct: discountValue,
      customerPriceCents: input.customerPriceCents,
      isActive: true,
    })
    .onDuplicateKeyUpdate({
      set: {
        cleanerRetailPriceCents: input.cleanerRetailPriceCents,
        partnerDiscountPct: discountValue,
        customerPriceCents: input.customerPriceCents,
        isActive: true,
      },
    });

  return { catalogItemId: catalogItemId!, slug };
}

export function slugifyGarment(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 128) || "garment"
  );
}
