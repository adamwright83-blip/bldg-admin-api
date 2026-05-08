import { describe, expect, it } from "vitest";
import {
  derivePartnerCostFromCommand,
  normalizeCatalogCategory,
  normalizeParsedCatalogCommand,
  type ParsedCommandDraft,
} from "./catalogAi";

const baseDraft: ParsedCommandDraft = {
  intent: "create",
  slug: null,
  name: "Cotton Pants",
  category: null,
  serviceType: null,
  standardPriceCents: 900,
  expressPriceCents: null,
  costCents: null,
  isOnline: null,
  notes: null,
};

describe("catalog AI command normalization", () => {
  it("derives dry cleaner partner cost from a percent of customer sell price", () => {
    expect(
      derivePartnerCostFromCommand(
        "cotton pants sell for $9, i pay dry cleaner 30% before any customer discount",
        900
      )
    ).toEqual({ percent: 30, costCents: 270 });
  });

  it("supports percent written as a word", () => {
    expect(
      derivePartnerCostFromCommand("Add silk blouse. sell $12. pay partner 25 percent", 1200)
    ).toEqual({ percent: 25, costCents: 300 });
  });

  it("does not confuse customer discounts with partner cost", () => {
    expect(
      derivePartnerCostFromCommand("cotton pants sell for $9 with 30% customer discount", 900)
    ).toBeNull();
  });

  it("fills create defaults and partner cost for garment commands", () => {
    const normalized = normalizeParsedCatalogCommand(
      "cotton pants sell for $9, i pay dry cleaner 30% before discounts",
      baseDraft
    );

    expect(normalized).toMatchObject({
      intent: "create",
      name: "Cotton Pants",
      category: "Pants",
      serviceType: "dry_clean",
      standardPriceCents: 900,
      costCents: 270,
    });
    expect(normalized.notes).toContain("before customer discounts");
  });

  it("canonicalizes shirts and tops aliases to the existing Tops category", () => {
    expect(normalizeCatalogCategory("SHIRTS & TOPS")).toBe("Tops");

    const normalized = normalizeParsedCatalogCommand(
      "Add blouse - press only. sell $5. pay partner $3",
      {
        ...baseDraft,
        name: "Blouse - Press Only",
        category: "Shirts & Tops",
        standardPriceCents: 500,
        costCents: 300,
      }
    );

    expect(normalized.category).toBe("Tops");
  });
});
