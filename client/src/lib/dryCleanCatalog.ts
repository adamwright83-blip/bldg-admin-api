import { DC_ITEMS } from "@shared/pricing";

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
 * Keep counter intake operational even when a tenant's catalog was not seeded.
 * Tenant catalog pricing remains authoritative whenever at least one applicable
 * row exists; the standard menu is only the empty/error-state safety net.
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

  return tenantRows.length > 0 ? tenantRows : STANDARD_DRY_CLEAN_CATALOG;
}
