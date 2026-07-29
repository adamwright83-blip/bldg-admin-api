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
  const standardSlugs = new Set(STANDARD_DRY_CLEAN_CATALOG.map(row => row.slug));

  return [
    ...STANDARD_DRY_CLEAN_CATALOG.map(
      standardRow => tenantBySlug.get(standardRow.slug) ?? standardRow
    ),
    ...tenantRows.filter(row => !standardSlugs.has(row.slug)),
  ];
}
