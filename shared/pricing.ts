/**
 * Hardcoded pricing for Laundry Butler v1.
 * All prices in cents to avoid floating-point issues.
 */

export const WF_RATE_PER_LB_CENTS = 250; // $2.50/lb
export const WF_MINIMUM_SUBTOTAL_CENTS = 4500; // $45.00 minimum

/* Wash & Fold upcharges */
export const WF_UPCHARGES = [
  { id: "bleach", label: "Bleach For Whites", priceCents: 200 },
  { id: "detergent_gain", label: "Detergent - Gain", priceCents: 50 },
  { id: "detergent_tide", label: "Detergent - Tide", priceCents: 50 },
  { id: "dryer_sheets_gain", label: "Dryer Sheets - Gain", priceCents: 50 },
  { id: "dryer_sheets_suavitel", label: "Dryer Sheets - Suavitel", priceCents: 50 },
  { id: "fabric_softener_gain", label: "Fabric Softener - Gain", priceCents: 50 },
  { id: "fabric_softener_suavitel", label: "Fabric Softener - Suavitel", priceCents: 50 },
  { id: "hot_wash", label: "Hot Wash", priceCents: 75 },
  { id: "regular_unscented", label: "Regular Unscented", priceCents: 0 },
] as const;

/* Wash & Fold flat-rate textiles */
export const WF_FLAT_RATE_TEXTILES = [
  { id: "rug_small", label: "Rug (W&F) - Small", priceCents: 1500 },
  { id: "rug_large", label: "Rug (W&F) - Large", priceCents: 2000 },
  { id: "rug_xl", label: "Rug (W&F) - Extra Large", priceCents: 3500 },
  { id: "sheets_set", label: "Sheets (W&F) - Set (1)", priceCents: 500 },
  { id: "sleeping_bag_wf", label: "Sleeping Bag (W&F)", priceCents: 1500 },
  { id: "comforter_wf", label: "Comforter (W&F) - Flat Rate", priceCents: 3500 },
] as const;

/* Dry cleaning items grouped by category */
export interface DryCleanItem {
  id: string;
  label: string;
  priceCents: number;
  category: string;
}

/**
 * Legacy snapshot used by `pnpm seed:catalog` to populate `catalog_items` (slug = id).
 * Runtime source of truth for menus and admin intake is the DB catalog — not this array.
 */
export const DC_ITEMS: DryCleanItem[] = [
  // SUITS
  { id: "2pc_suit", label: "2pc Suit", priceCents: 2500, category: "Suits" },
  { id: "3pc_suit", label: "3pc Suit", priceCents: 3000, category: "Suits" },
  { id: "sweat_suit", label: "Sweat Suit", priceCents: 2200, category: "Suits" },
  { id: "tuxedo", label: "Tuxedo", priceCents: 2400, category: "Suits" },

  // TOPS
  { id: "2pc_sweater", label: "2PC Sweater", priceCents: 1700, category: "Tops" },
  { id: "blouse", label: "Blouse", priceCents: 1000, category: "Tops" },
  { id: "cardigan", label: "Cardigan", priceCents: 1400, category: "Tops" },
  { id: "dress_shirt", label: "Dress Shirt", priceCents: 600, category: "Tops" },
  { id: "jersey", label: "Jersey", priceCents: 800, category: "Tops" },
  { id: "l_shirt_hs", label: "L-Shirt (H/S)", priceCents: 600, category: "Tops" },
  { id: "l_shirt_ls", label: "L-Shirt (L/S)", priceCents: 600, category: "Tops" },
  { id: "l_shirt_ms", label: "L-Shirt (M/S)", priceCents: 600, category: "Tops" },
  { id: "l_shirt_ns", label: "L-Shirt (N/S)", priceCents: 600, category: "Tops" },
  { id: "sweater", label: "Sweater", priceCents: 1100, category: "Tops" },
  { id: "top", label: "Top", priceCents: 700, category: "Tops" },
  { id: "turtleneck", label: "TurtleNeck", priceCents: 500, category: "Tops" },
  { id: "vest", label: "Vest", priceCents: 800, category: "Tops" },

  // PANTS
  { id: "jeans", label: "Jeans", priceCents: 1000, category: "Pants" },
  { id: "pants", label: "Pants", priceCents: 1000, category: "Pants" },
  { id: "shorts", label: "Shorts", priceCents: 800, category: "Pants" },

  // DRESSES
  { id: "2pc_dress", label: "2PC Dress", priceCents: 2200, category: "Dresses" },
  { id: "dress", label: "Dress", priceCents: 1200, category: "Dresses" },
  { id: "gown", label: "Gown", priceCents: 4200, category: "Dresses" },
  { id: "kid_dress", label: "Kid Dress", priceCents: 800, category: "Dresses" },

  // SKIRTS
  { id: "skirt", label: "Skirt", priceCents: 1100, category: "Skirts" },

  // UNIFORMS
  { id: "apron", label: "Apron", priceCents: 600, category: "Uniforms" },
  { id: "battle_dress_uniform", label: "Battle Dress Uniform", priceCents: 1400, category: "Uniforms" },
  { id: "lab_coat", label: "Lab Coat", priceCents: 1000, category: "Uniforms" },
  { id: "overall", label: "OverAll", priceCents: 1400, category: "Uniforms" },
  { id: "uniform", label: "Uniform", priceCents: 1400, category: "Uniforms" },

  // ACCESSORIES
  { id: "cummerbund", label: "CummerBund", priceCents: 500, category: "Accessories" },
  { id: "glove", label: "Glove", priceCents: 400, category: "Accessories" },
  { id: "gloves_pair", label: "Gloves (pair)", priceCents: 600, category: "Accessories" },
  { id: "handkerchief", label: "Hankerchief", priceCents: 200, category: "Accessories" },
  { id: "hat", label: "Hat", priceCents: 600, category: "Accessories" },
  { id: "scarf", label: "Scarf", priceCents: 700, category: "Accessories" },
  { id: "tie", label: "Tie", priceCents: 500, category: "Accessories" },

  // BEDDING
  { id: "bed_skirt", label: "Bed Skirt", priceCents: 1700, category: "Bedding" },
  { id: "bedspread_double", label: "BedSpread Double", priceCents: 2600, category: "Bedding" },
  { id: "bedspread_king", label: "BedSpread King", priceCents: 3400, category: "Bedding" },
  { id: "bedspread_queen", label: "BedSpread Queen", priceCents: 2900, category: "Bedding" },
  { id: "bedspread_twin", label: "BedSpread Twin", priceCents: 2400, category: "Bedding" },
  { id: "blanket_large", label: "Blanket Large", priceCents: 2200, category: "Bedding" },
  { id: "comforter_double", label: "Comforter Double", priceCents: 3600, category: "Bedding" },
  { id: "comforter_king", label: "Comforter King", priceCents: 4600, category: "Bedding" },
  { id: "comforter_queen", label: "Comforter Queen", priceCents: 3800, category: "Bedding" },
  { id: "comforter_twin", label: "Comforter Twin", priceCents: 3400, category: "Bedding" },
  { id: "down_comforter", label: "Down Comforter", priceCents: 4200, category: "Bedding" },
  { id: "duvet_cover", label: "Duvet Cover", priceCents: 1900, category: "Bedding" },
  { id: "pillow", label: "Pillow", priceCents: 1700, category: "Bedding" },
  { id: "pillowcase", label: "Pillowcase", priceCents: 700, category: "Bedding" },
  { id: "sheet_dc", label: "Sheet", priceCents: 1400, category: "Bedding" },

  // OTHER TEXTILES
  { id: "tablecloth_large", label: "Tablecloth Large", priceCents: 1900, category: "Other Textiles" },
  { id: "tablecloth_mid", label: "Tablecloth Mid", priceCents: 1700, category: "Other Textiles" },
  { id: "tablecloth_small", label: "Tablecloth Small", priceCents: 1400, category: "Other Textiles" },

  // OUTERWEAR
  { id: "3_4_coat", label: "3/4 Coat", priceCents: 2200, category: "Outerwear" },
  { id: "hood_jacket", label: "Hood Jacket", priceCents: 1200, category: "Outerwear" },
  { id: "over_coat", label: "Over Coat", priceCents: 2600, category: "Outerwear" },
  { id: "rain_coat", label: "Rain Coat", priceCents: 2900, category: "Outerwear" },
  { id: "reg_jacket", label: "Reg. Jacket", priceCents: 1400, category: "Outerwear" },

  // SLEEPWEAR
  { id: "jump_suit", label: "Jump Suit", priceCents: 1400, category: "Sleepwear" },
  { id: "robe", label: "Robe", priceCents: 1200, category: "Sleepwear" },
  { id: "short_all", label: "Short All", priceCents: 600, category: "Sleepwear" },
  { id: "sleeping_bag_dc", label: "Sleeping Bag (Dry Clean)", priceCents: 2400, category: "Sleepwear" },
];

/* ===== Pricing calculation helpers ===== */

export type UpchargeEntry = {
  label: string;
  unit_price_cents: number;
  qty: number;
  total_cents: number;
};

export type DryCleanEntry = {
  label: string;
  category: string;
  unit_price_cents: number;
  qty: number;
  total_cents: number;
};

/**
 * Calculate wash & fold total.
 * Returns { subtotalCents, totalCents } where subtotal is before discount
 * and total is after discount. $45 minimum enforced BEFORE discount.
 */
export function calcWashFoldTotal(
  weightLbs: number,
  upcharges: Record<string, UpchargeEntry>,
  flatRateItems: Record<string, UpchargeEntry>,
  discountPercent: number
): { subtotalCents: number; totalCents: number } {
  const baseCents = Math.round(weightLbs * WF_RATE_PER_LB_CENTS);
  const upchargeCents = Object.values(upcharges).reduce((sum, u) => sum + u.total_cents, 0);
  const flatRateCents = Object.values(flatRateItems).reduce((sum, f) => sum + f.total_cents, 0);

  // Enforce $45 minimum before discount
  const subtotalCents = Math.max(baseCents + upchargeCents + flatRateCents, WF_MINIMUM_SUBTOTAL_CENTS);

  // Apply discount after minimum enforcement
  const discountMultiplier = 1 - (discountPercent / 100);
  const totalCents = Math.round(subtotalCents * discountMultiplier);

  return { subtotalCents, totalCents };
}

/**
 * Calculate dry cleaning total.
 */
export function calcDryCleanTotal(
  items: Record<string, DryCleanEntry>,
  discountPercent: number
): { subtotalCents: number; totalCents: number } {
  const subtotalCents = Object.values(items).reduce((sum, i) => sum + i.total_cents, 0);
  const discountMultiplier = 1 - (discountPercent / 100);
  const totalCents = Math.round(subtotalCents * discountMultiplier);

  return { subtotalCents, totalCents };
}

/** Convert cents to dollars string */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
