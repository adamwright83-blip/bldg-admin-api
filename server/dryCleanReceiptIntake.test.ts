import { describe, expect, it } from "vitest";
import {
  buildDraftMath,
  buildDrycleanItemsJsonFromReviewed,
  calculatePartnerCostCents,
  matchReceiptLinesToCatalog,
  type ReceiptCatalogMatch,
} from "./dryCleanReceiptIntake";
import type { CatalogItem } from "../drizzle/schema";

function catalog(overrides: Partial<CatalogItem>): CatalogItem {
  return {
    id: 1,
    tenantId: "default",
    slug: "pants",
    name: "Pants",
    category: "Bottoms",
    serviceType: "dry_clean",
    standardPriceCents: 1400,
    expressPriceCents: null,
    costCents: null,
    isActive: true,
    isOnline: true,
    archived: false,
    sortOrder: 0,
    iconUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("dry clean receipt intake", () => {
  it("calculates partner cost as 60% of dry-cleaner retail", () => {
    expect(calculatePartnerCostCents(10_000)).toBe(6_000);
  });

  it("does not apply customer discount during draft math", () => {
    expect(buildDraftMath({
      dryCleanerRetailTotalCents: 10_000,
      laundryButlerRetailSubtotalCents: 12_500,
    })).toMatchObject({
      partnerCostCents: 6_000,
      customerDiscountPercentAtDraft: 0,
      customerTotalCentsAtDraft: 12_500,
      estimatedGrossMarginCents: 6_500,
    });
  });

  it("uses Laundry Butler catalog prices in drycleanItemsJson, not dry-cleaner retail", () => {
    const items = buildDrycleanItemsJsonFromReviewed([
      {
        rawLabel: "Pants",
        matchedCatalogSlug: "pants",
        matchedCatalogName: "Pants",
        category: "Bottoms",
        qty: 2,
        dryCleanerRetailLineTotalCents: 900,
        laundryButlerUnitPriceCents: 1400,
        laundryButlerLineTotalCents: 2800,
        confidence: 1,
        warning: null,
      },
    ]);
    expect(items.pants.unit_price_cents).toBe(1400);
    expect(items.pants.total_cents).toBe(2800);
  });

  it("matches receipt lines to active dry-clean catalog rows and warns on low confidence", () => {
    const result = matchReceiptLinesToCatalog(
      [
        { rawLabel: "Pants", qty: 1, unitPriceCents: null, lineTotalCents: 900 },
        { rawLabel: "Mystery handwritten item", qty: 1, unitPriceCents: null, lineTotalCents: 1200 },
      ],
      [catalog({ slug: "pants", name: "Pants", standardPriceCents: 1400 })],
      2100
    );
    expect(result.matches[0].matchedCatalogSlug).toBe("pants");
    expect(result.matches[1].matchedCatalogSlug).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("create draft helper has no charge-card side effect surface", () => {
    const reviewed: ReceiptCatalogMatch[] = [{
      rawLabel: "Dress",
      matchedCatalogSlug: "dress",
      matchedCatalogName: "Dress",
      category: "Dresses",
      qty: 1,
      dryCleanerRetailLineTotalCents: 1000,
      laundryButlerUnitPriceCents: 2200,
      laundryButlerLineTotalCents: 2200,
      confidence: 1,
      warning: null,
    }];
    expect(buildDrycleanItemsJsonFromReviewed(reviewed).dress.total_cents).toBe(2200);
  });
});
