import { describe, expect, it } from "vitest";
import { calcDryCleanTotal, type DryCleanEntry } from "@shared/pricing";
import {
  COAST_CLEANER_NAME,
  COAST_CLEANER_SLUG,
  PARAGON_CLEANER_NAME,
  PARAGON_CLEANER_SLUG,
  PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT,
  cleanerCostCents,
} from "@shared/dryCleaners";
import {
  buildCleanerLineItems,
  cleanerSlugForLine,
  resolveCleanerMenus,
  type CleanerItemPriceRow,
} from "./dryCleanCatalog";

const CLEANERS = [
  {
    id: 1,
    slug: COAST_CLEANER_SLUG,
    displayName: COAST_CLEANER_NAME,
    defaultPartnerDiscountPct: 40,
    usesBaseCatalog: true,
    sortOrder: 0,
    isActive: true,
  },
  {
    id: 2,
    slug: PARAGON_CLEANER_SLUG,
    displayName: PARAGON_CLEANER_NAME,
    defaultPartnerDiscountPct: PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT,
    usesBaseCatalog: false,
    sortOrder: 1,
    isActive: true,
  },
];

const BASE_CATALOG = [
  { slug: "pants", name: "Pants", category: "Pants", standardPriceCents: 1000 },
  {
    slug: "blouse",
    name: "Blouse",
    category: "Tops",
    standardPriceCents: 1000,
  },
  {
    slug: "dress_shirt",
    name: "Dress Shirt",
    category: "Tops",
    standardPriceCents: 600,
  },
  {
    slug: "dress",
    name: "Dress",
    category: "Dresses",
    standardPriceCents: 1200,
  },
];

/** Paragon knows exactly one garment today: Carol's Dress. */
const PARAGON_PRICES: CleanerItemPriceRow[] = [
  {
    cleanerSlug: PARAGON_CLEANER_SLUG,
    cleanerId: 2,
    catalogItemId: 40,
    slug: "dress",
    name: "Dress",
    category: "Dresses",
    customerPriceCents: 1900,
    cleanerRetailPriceCents: 1479,
    partnerDiscountPct: 0,
    actualCleanerCostCents: cleanerCostCents(1479, 0),
  },
];

const menus = resolveCleanerMenus({
  cleaners: CLEANERS,
  baseCatalogRows: BASE_CATALOG,
  itemPrices: PARAGON_PRICES,
});

describe("per-cleaner menus", () => {
  it("keeps the whole COAST catalog on the COAST tab", () => {
    const coast = menus[0];
    expect(coast.cleaner.displayName).toBe("COAST 1hr CLEANERS");
    expect(coast.rows.map(r => r.itemSlug)).toEqual(
      BASE_CATALOG.map(r => r.slug)
    );
  });

  it("does not duplicate the COAST catalog under PARAGON", () => {
    const paragon = menus[1];
    expect(paragon.cleaner.displayName).toBe("PARAGON CLEANERS");
    expect(paragon.rows).toHaveLength(1);
    expect(paragon.rows[0].itemSlug).toBe("dress");
    expect(paragon.rows[0].customerPriceCents).toBe(1900);
  });

  it("treats an unpriced PARAGON garment as unavailable, not $0", () => {
    const paragon = menus[1];
    expect(paragon.rows.find(r => r.itemSlug === "pants")).toBeUndefined();
    const lines = buildCleanerLineItems(menus, { "paragon::pants": 1 }, null);
    expect(lines["paragon::pants"]).toBeUndefined();
  });
});

describe("order lines carry their own cleaner", () => {
  it("builds a COAST-only order on legacy keys", () => {
    const lines = buildCleanerLineItems(menus, { pants: 1, blouse: 1 }, null);
    expect(Object.keys(lines).sort()).toEqual(["blouse", "pants"]);
    expect(lines.pants.cleaner_name).toBe("COAST 1hr CLEANERS");
    expect(calcDryCleanTotal(lines, 0).totalCents).toBe(2000);
  });

  it("builds a PARAGON-only order", () => {
    const lines = buildCleanerLineItems(menus, { "paragon::dress": 1 }, null);
    expect(lines["paragon::dress"]).toMatchObject({
      label: "Dress",
      cleaner_slug: PARAGON_CLEANER_SLUG,
      cleaner_name: "PARAGON CLEANERS",
      unit_price_cents: 1900,
      cleaner_retail_price_cents: 1479,
      partner_discount_pct: 0,
      cleaner_cost_cents: 1479,
    });
  });

  it("puts Carol's split order in one cart with one combined total", () => {
    const lines = buildCleanerLineItems(
      menus,
      { pants: 1, blouse: 1, dress_shirt: 1, "paragon::dress": 1 },
      null
    );

    const byCleaner = Object.entries(lines).reduce<Record<string, number>>(
      (acc, [key, entry]) => {
        const slug = cleanerSlugForLine(key, entry);
        acc[slug] = (acc[slug] ?? 0) + entry.qty;
        return acc;
      },
      {}
    );
    expect(byCleaner).toEqual({
      [COAST_CLEANER_SLUG]: 3,
      [PARAGON_CLEANER_SLUG]: 1,
    });

    /* Coast $10 + $10 + $6, Paragon $19 → one customer total. */
    expect(calcDryCleanTotal(lines, 0).totalCents).toBe(4500);
  });

  it("adding a garment on the PARAGON tab yields a PARAGON line", () => {
    const lines = buildCleanerLineItems(menus, { "paragon::dress": 2 }, null);
    expect(cleanerSlugForLine("paragon::dress", lines["paragon::dress"])).toBe(
      PARAGON_CLEANER_SLUG
    );
    expect(lines["paragon::dress"].total_cents).toBe(3800);
  });
});

describe("historical truth", () => {
  const carolsSavedOrder: Record<string, DryCleanEntry> = buildCleanerLineItems(
    menus,
    { "paragon::dress": 1 },
    null
  );

  it("survives PARAGON later repricing the dress and granting the 15%", () => {
    const repricedMenus = resolveCleanerMenus({
      cleaners: CLEANERS,
      baseCatalogRows: BASE_CATALOG,
      itemPrices: [
        {
          ...PARAGON_PRICES[0],
          cleanerRetailPriceCents: 2000,
          partnerDiscountPct: PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT,
          actualCleanerCostCents: cleanerCostCents(
            2000,
            PARAGON_DEFAULT_PARTNER_DISCOUNT_PCT
          ),
          customerPriceCents: 2500,
        },
      ],
    });

    /* The saved snapshot is untouched by the new catalog values. */
    expect(carolsSavedOrder["paragon::dress"]).toMatchObject({
      unit_price_cents: 1900,
      cleaner_retail_price_cents: 1479,
      partner_discount_pct: 0,
      cleaner_cost_cents: 1479,
    });

    /* A NEW order picks up the new economics. */
    const newLines = buildCleanerLineItems(
      repricedMenus,
      { "paragon::dress": 1 },
      null
    );
    expect(newLines["paragon::dress"]).toMatchObject({
      unit_price_cents: 2500,
      cleaner_retail_price_cents: 2000,
      partner_discount_pct: 15,
      cleaner_cost_cents: 1700,
    });
  });

  it("keeps a delisted garment at its saved price rather than dropping it to $0", () => {
    const emptyParagon = resolveCleanerMenus({
      cleaners: CLEANERS,
      baseCatalogRows: BASE_CATALOG,
      itemPrices: [],
    });
    const lines = buildCleanerLineItems(
      emptyParagon,
      { "paragon::dress": 1 },
      carolsSavedOrder
    );
    expect(lines["paragon::dress"].unit_price_cents).toBe(1900);
    expect(lines["paragon::dress"].total_cents).toBe(1900);
  });

  it("reads a pre-multi-cleaner saved line as COAST", () => {
    const legacy: DryCleanEntry = {
      label: "Pants",
      category: "Pants",
      unit_price_cents: 1000,
      qty: 1,
      total_cents: 1000,
    };
    expect(cleanerSlugForLine("pants", legacy)).toBe(COAST_CLEANER_SLUG);
  });
});
