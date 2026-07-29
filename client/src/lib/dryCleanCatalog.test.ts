import { describe, expect, it } from "vitest";
import { DC_ITEMS } from "@shared/pricing";
import { resolveDryCleanCatalogRows } from "./dryCleanCatalog";

describe("dry-clean counter catalog safety net", () => {
  it("shows the standard garment menu when a tenant catalog is empty", () => {
    const rows = resolveDryCleanCatalogRows([]);

    expect(rows).toHaveLength(DC_ITEMS.length);
    expect(rows[0]).toEqual({
      slug: DC_ITEMS[0].id,
      name: DC_ITEMS[0].label,
      category: DC_ITEMS[0].category,
      standardPriceCents: DC_ITEMS[0].priceCents,
    });
  });

  it("also protects intake when the catalog request has no data", () => {
    expect(resolveDryCleanCatalogRows(undefined)).toHaveLength(DC_ITEMS.length);
  });

  it("keeps the full standard menu when a tenant adds one custom garment", () => {
    const rows = resolveDryCleanCatalogRows([
      {
        slug: "blanket_medium",
        name: "Blanket Medium",
        category: "Blankets",
        serviceType: "dry_clean",
        standardPriceCents: 10000,
      },
    ]);

    expect(rows).toHaveLength(DC_ITEMS.length + 1);
    expect(rows).toContainEqual({
      slug: "blanket_medium",
      name: "Blanket Medium",
      category: "Blankets",
      standardPriceCents: 10000,
    });
    expect(rows).toContainEqual({
      slug: DC_ITEMS[0].id,
      name: DC_ITEMS[0].label,
      category: DC_ITEMS[0].category,
      standardPriceCents: DC_ITEMS[0].priceCents,
    });
  });

  it("uses tenant-specific pricing for a matching standard garment", () => {
    const rows = resolveDryCleanCatalogRows([
        {
          slug: DC_ITEMS[0].id,
          name: DC_ITEMS[0].label,
          category: "Suits",
          serviceType: "dry_clean",
          standardPriceCents: 4200,
        },
        {
          slug: "wash_fold",
          name: "Wash & Fold",
          category: "Laundry",
          serviceType: "wash_fold",
          standardPriceCents: 250,
        },
      ]);

    expect(rows).toHaveLength(DC_ITEMS.length);
    expect(rows[0]).toEqual({
      slug: DC_ITEMS[0].id,
      name: DC_ITEMS[0].label,
      category: "Suits",
      standardPriceCents: 4200,
    });
    expect(rows.some(row => row.slug === "wash_fold")).toBe(false);
  });
});
