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
          "For create: fill name, category, serviceType, standardPriceCents, costCents (null if unknown), slug null (we derive). " +
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
  return parsed;
}
