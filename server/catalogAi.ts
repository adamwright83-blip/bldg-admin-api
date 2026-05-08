import { invokeLLM, type InvokeResult } from "./_core/llm";

const MENU_JSON_SCHEMA = {
  name: "menu_parse",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            serviceType: {
              type: "string",
              enum: ["dry_clean", "wash_fold", "alteration", "other"],
            },
            standardPriceCents: { type: "integer" },
            pricingUnit: { type: "string", enum: ["each", "per_lb"] },
            expressPriceCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
            costCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
          },
          required: [
            "name",
            "category",
            "serviceType",
            "standardPriceCents",
            "pricingUnit",
            "expressPriceCents",
            "costCents",
          ],
        },
      },
    },
    required: ["items"],
  },
} as const;

const COMMAND_JSON_SCHEMA = {
  name: "catalog_command",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: ["create", "update_price", "archive", "toggle_online"],
      },
      slug: { anyOf: [{ type: "string" }, { type: "null" }] },
      name: { anyOf: [{ type: "string" }, { type: "null" }] },
      category: { anyOf: [{ type: "string" }, { type: "null" }] },
      serviceType: {
        anyOf: [
          { type: "string", enum: ["dry_clean", "wash_fold", "alteration", "other"] },
          { type: "null" },
        ],
      },
      standardPriceCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
      expressPriceCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
      costCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
      isOnline: { anyOf: [{ type: "boolean" }, { type: "null" }] },
      notes: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: [
      "intent",
      "slug",
      "name",
      "category",
      "serviceType",
      "standardPriceCents",
      "expressPriceCents",
      "costCents",
      "isOnline",
      "notes",
    ],
  },
} as const;

export type ParsedMenuItem = {
  name: string;
  category: string;
  serviceType: "dry_clean" | "wash_fold" | "alteration" | "other";
  standardPriceCents: number;
  pricingUnit: "each" | "per_lb";
  expressPriceCents: number | null;
  costCents: number | null;
};

export type ParsedCommandDraft = {
  intent: "create" | "update_price" | "archive" | "toggle_online";
  slug: string | null;
  name: string | null;
  category: string | null;
  serviceType: "dry_clean" | "wash_fold" | "alteration" | "other" | null;
  standardPriceCents: number | null;
  expressPriceCents: number | null;
  costCents: number | null;
  isOnline: boolean | null;
  notes: string | null;
};

export type DerivedPartnerCost = {
  percent: number;
  costCents: number;
};

function getMessageText(result: InvokeResult): string {
  const raw = result.choices[0]?.message?.content;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: string }).text) : ""))
      .join("");
  }
  return "";
}

/** URL-safe slug: lowercase, underscores */
export function slugifyCatalogName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "item";
}

export function normalizeCatalogCategory(category: string | null | undefined): string | null {
  const raw = category?.trim();
  if (!raw) return null;

  const key = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  const aliases: Record<string, string> = {
    accessory: "Accessories",
    accessories: "Accessories",
    alteration: "Alterations",
    alterations: "Alterations",
    bedding: "Bedding",
    "bed linens": "Bedding",
    dress: "Dresses",
    dresses: "Dresses",
    garment: "Garments",
    garments: "Garments",
    outerwear: "Outerwear",
    coats: "Outerwear",
    jackets: "Outerwear",
    pants: "Pants",
    bottoms: "Pants",
    shirt: "Tops",
    shirts: "Tops",
    "shirts and tops": "Tops",
    "tops and shirts": "Tops",
    "shirts tops": "Tops",
    top: "Tops",
    tops: "Tops",
    blouse: "Tops",
    blouses: "Tops",
    skirt: "Skirts",
    skirts: "Skirts",
    suit: "Suits",
    suits: "Suits",
    uniform: "Uniforms",
    uniforms: "Uniforms",
    "other textiles": "Other Textiles",
    textiles: "Other Textiles",
  };

  return aliases[key] ?? raw;
}

function inferCatalogCategory(name: string | null): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  if (/\b(suit|tuxedo)\b/.test(lower)) return "Suits";
  if (/\b(pants|jeans|shorts|trousers?)\b/.test(lower)) return "Pants";
  if (/\b(dress|gown)\b/.test(lower)) return "Dresses";
  if (/\b(skirt)\b/.test(lower)) return "Skirts";
  if (/\b(shirt|blouse|cardigan|sweater|top|vest|jersey|turtleneck)\b/.test(lower)) return "Tops";
  if (/\b(coat|jacket|outerwear)\b/.test(lower)) return "Outerwear";
  if (/\b(comforter|duvet|blanket|sheet|pillow|bedspread)\b/.test(lower)) return "Bedding";
  if (/\b(hem|zipper|alteration|repair|tailor)\b/.test(lower)) return "Alterations";
  return null;
}

export function derivePartnerCostFromCommand(
  command: string,
  standardPriceCents: number | null | undefined
): DerivedPartnerCost | null {
  if (standardPriceCents == null || standardPriceCents <= 0) return null;

  const percentRe = /(\d+(?:\.\d+)?)\s*(?:%|percent\b|per\s*cent\b)/gi;
  let match: RegExpExecArray | null;
  while ((match = percentRe.exec(command)) !== null) {
    const rawPercent = Number(match[1]);
    if (!Number.isFinite(rawPercent) || rawPercent < 0 || rawPercent > 100) continue;

    const start = Math.max(0, match.index - 80);
    const end = Math.min(command.length, match.index + match[0].length + 80);
    const nearby = command.slice(start, end).toLowerCase();
    const mentionsPartnerCost =
      /\b(pay|paid|pays|payout|cost|owed|give|gets?|receives?|keeps?)\b/.test(nearby) &&
      /\b(dry\s*clean(?:er|ing)?|cleaner|partner|vendor|provider|wholesale)\b/.test(nearby);

    if (!mentionsPartnerCost) continue;

    return {
      percent: rawPercent,
      costCents: Math.round(standardPriceCents * (rawPercent / 100)),
    };
  }

  return null;
}

export function normalizeParsedCatalogCommand(
  command: string,
  draft: ParsedCommandDraft
): ParsedCommandDraft {
  const next: ParsedCommandDraft = { ...draft };

  if (next.intent === "create") {
    next.serviceType = next.serviceType ?? "dry_clean";
    next.category = normalizeCatalogCategory(next.category) ?? inferCatalogCategory(next.name) ?? "Garments";
  }

  const derivedPartnerCost = derivePartnerCostFromCommand(command, next.standardPriceCents);
  if (derivedPartnerCost) {
    next.costCents = derivedPartnerCost.costCents;
    const dollars = (derivedPartnerCost.costCents / 100).toFixed(2);
    const summary = `Partner cost set to ${derivedPartnerCost.percent}% of sell price ($${dollars}) before customer discounts.`;
    next.notes = next.notes?.trim() ? `${next.notes.trim()} ${summary}` : summary;
  }

  return next;
}

export async function parseMenuFileWithLLM(params: {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  base64Data: string;
}): Promise<ParsedMenuItem[]> {
  const { mimeType, base64Data } = params;
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
    | { type: "file_url"; file_url: { url: string; mime_type: "application/pdf" } }
  > = [
    {
      type: "text",
      text:
        "Extract every priced line item from this laundry / dry cleaning menu. " +
        "Return JSON only per schema. Rules: " +
        "standardPriceCents is an integer (e.g. $6.00 -> 600). " +
        "If price is per pound, set pricingUnit to per_lb and standardPriceCents to cents per pound (e.g. $2.50/lb -> 250). " +
        "Otherwise pricingUnit is each. " +
        "serviceType: dry_clean for dry cleaning garments, wash_fold for wash & fold / fluff & fold by weight, alteration for repairs/hems/zippers, other if unclear. " +
        "Infer sensible category labels (e.g. Shirts, Pants, Suits, Alterations). " +
        "If cost is not on the menu, set costCents to null. " +
        "If express price not listed, expressPriceCents null. " +
        "Do not invent prices.",
    },
  ];

  if (mimeType === "application/pdf") {
    userContent.push({
      type: "file_url",
      file_url: { url: dataUrl, mime_type: "application/pdf" },
    });
  } else {
    userContent.push({
      type: "image_url",
      image_url: { url: dataUrl },
    });
  }

  const result = await invokeLLM({
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
    outputSchema: MENU_JSON_SCHEMA,
  });

  const text = getMessageText(result);
  if (!text.trim()) {
    throw new Error("Menu parse: empty model output after Anthropic tool_use.");
  }
  let parsed: { items: ParsedMenuItem[] };
  try {
    parsed = JSON.parse(text) as { items: ParsedMenuItem[] };
  } catch {
    throw new Error(
      `Menu parse returned invalid JSON (first 240 chars): ${text.slice(0, 240)}`
    );
  }
  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error("Menu parse missing items array");
  }
  return parsed.items.map((it) => ({
    ...it,
    category: normalizeCatalogCategory(it.category) ?? inferCatalogCategory(it.name) ?? "Garments",
    expressPriceCents: it.expressPriceCents ?? null,
    costCents: it.costCents ?? null,
  }));
}

export async function parseCatalogCommandWithLLM(params: {
  command: string;
  existingCatalogSummary: string;
}): Promise<ParsedCommandDraft> {
  const result = await invokeLLM({
    messages: [
      {
        role: "user",
        content:
          "You help admins edit a laundry catalog. Existing rows (slug | name | price cents):\n" +
          params.existingCatalogSummary +
          "\n\nCommand:\n" +
          params.command +
          "\n\nParse into one intent: create | update_price | archive | toggle_online. " +
          "If a command names a garment/item and gives a sell price but does not say add/create, infer create unless it clearly matches one existing row. " +
          "New dry-cleaning garments default to serviceType dry_clean. " +
          "For create: fill name, category, serviceType, standardPriceCents, costCents (null if unknown), slug null (we derive). " +
          "standardPriceCents is the customer sell price before discounts. costCents is what we pay the dry-clean partner/vendor before any customer discount. " +
          "If the admin says they pay the dry cleaner/partner/vendor N%, compute costCents as N% of standardPriceCents; e.g. sell $9 and pay dry cleaner 30% means standardPriceCents 900 and costCents 270. " +
          "Do not treat partner cost percentage as customer discount or margin. " +
          "For update_price: set slug to match an existing slug from the list, standardPriceCents new value. " +
          "For archive: set slug to the item to archive. " +
          "For toggle_online: slug and isOnline true/false. " +
          "Use notes for short human summary of what will happen.",
      },
    ],
    outputSchema: COMMAND_JSON_SCHEMA,
  });

  const text = getMessageText(result);
  if (!text.trim()) {
    throw new Error("Command parse: empty model output after Anthropic tool_use.");
  }
  let parsed: ParsedCommandDraft;
  try {
    parsed = JSON.parse(text) as ParsedCommandDraft;
  } catch {
    throw new Error(
      `Command parse returned invalid JSON (first 240 chars): ${text.slice(0, 240)}`
    );
  }
  return normalizeParsedCatalogCommand(params.command, parsed);
}
