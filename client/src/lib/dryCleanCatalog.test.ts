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

  it("uses tenant-specific garment pricing when configured", () => {
    expect(
      resolveDryCleanCatalogRows([
        {
          slug: "custom_suit",
          name: "Custom Suit",
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
      ])
    ).toEqual([
      {
        slug: "custom_suit",
        name: "Custom Suit",
        category: "Suits",
        standardPriceCents: 4200,
      },
    ]);
  });
});
