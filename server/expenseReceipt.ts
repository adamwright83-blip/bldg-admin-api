import { invokeLLM } from "./_core/llm";

export type ParsedExpenseReceipt = {
  category: "gas" | "parking" | "vehicle" | "supplies" | "food" | "other" | "unknown";
  vendorName: string | null;
  receiptDate: string | null;
  totalCents: number;
  confidence: number;
  warnings: string[];
  gasEvidence: {
    pumpNumber: string | null;
    fuelProduct: string | null;
    gallons: number | null;
    pricePerGallonCents: number | null;
    fuelSaleCents: number | null;
  };
};

export const EXPENSE_RECEIPT_PARSE_SCHEMA = {
  name: "driver_expense_receipt_parse",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      category: {
        type: "string",
        enum: ["gas", "parking", "vehicle", "supplies", "food", "other", "unknown"],
      },
      vendorName: { anyOf: [{ type: "string" }, { type: "null" }] },
      receiptDate: { anyOf: [{ type: "string" }, { type: "null" }] },
      totalCents: { type: "integer" },
      confidence: { type: "number" },
      warnings: { type: "array", items: { type: "string" } },
      gasEvidence: {
        type: "object",
        additionalProperties: false,
        properties: {
          pumpNumber: { anyOf: [{ type: "string" }, { type: "null" }] },
          fuelProduct: { anyOf: [{ type: "string" }, { type: "null" }] },
          gallons: { anyOf: [{ type: "number" }, { type: "null" }] },
          pricePerGallonCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
          fuelSaleCents: { anyOf: [{ type: "integer" }, { type: "null" }] },
        },
        required: ["pumpNumber", "fuelProduct", "gallons", "pricePerGallonCents", "fuelSaleCents"],
      },
    },
    required: [
      "category",
      "vendorName",
      "receiptDate",
      "totalCents",
      "confidence",
      "warnings",
      "gasEvidence",
    ],
  },
} as const;

function clampConfidence(n: unknown): number {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, x));
}

function cents(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

function nullableNumber(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function nullableCents(n: unknown): number | null {
  const value = cents(n);
  return value > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCategory(value: unknown): ParsedExpenseReceipt["category"] {
  const s = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (s === "gas" || s === "parking" || s === "vehicle" || s === "supplies" || s === "food" || s === "other") {
    return s;
  }
  return "unknown";
}

function normalizeGasEvidence(value: unknown): ParsedExpenseReceipt["gasEvidence"] {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    pumpNumber: nullableString(record.pumpNumber),
    fuelProduct: nullableString(record.fuelProduct),
    gallons: nullableNumber(record.gallons),
    pricePerGallonCents: nullableCents(record.pricePerGallonCents),
    fuelSaleCents: nullableCents(record.fuelSaleCents),
  };
}

function hasStrongGasEvidence(evidence: ParsedExpenseReceipt["gasEvidence"]): boolean {
  const fuelText = evidence.fuelProduct?.toLowerCase() ?? "";
  const fuelProductLooksLikeGas =
    /\b(unleaded|gasoline|diesel|premium|regular|midgrade|fuel|ev|charging)\b/.test(fuelText);
  const hasMeasuredFuel = evidence.gallons != null && evidence.pricePerGallonCents != null;
  const hasPumpAndFuelAmount =
    evidence.pumpNumber != null && (evidence.fuelSaleCents != null || evidence.gallons != null);
  return hasMeasuredFuel || (fuelProductLooksLikeGas && (hasPumpAndFuelAmount || evidence.fuelSaleCents != null));
}

export function normalizeParsedExpenseReceipt(json: unknown): ParsedExpenseReceipt {
  const record = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const gasEvidence = normalizeGasEvidence(record.gasEvidence);
  let category = normalizeCategory(record.category);
  let confidence = clampConfidence(record.confidence);
  const totalCents = cents(record.totalCents);
  const warnings = Array.isArray(record.warnings) ? record.warnings.map(String) : [];

  if (category !== "gas" && totalCents > 0 && hasStrongGasEvidence(gasEvidence)) {
    category = "gas";
    confidence = Math.max(confidence, 0.78);
    warnings.push("Category corrected to gas because receipt includes fuel-sale evidence.");
  }

  return {
    category,
    vendorName: nullableString(record.vendorName),
    receiptDate: nullableString(record.receiptDate),
    totalCents,
    confidence,
    warnings,
    gasEvidence,
  };
}

export function isGasExpense(parsed: Pick<ParsedExpenseReceipt, "category" | "confidence" | "totalCents">): boolean {
  return parsed.category === "gas" && parsed.totalCents > 0 && parsed.confidence >= 0.55;
}

export async function parseDriverExpenseReceiptPhoto(input: {
  tenantId: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  base64: string;
}): Promise<ParsedExpenseReceipt> {
  const result = await invokeLLM({
    tenantId: input.tenantId,
    temperature: 0,
    maxTokens: 1024,
    outputSchema: EXPENSE_RECEIPT_PARSE_SCHEMA,
    messages: [
      {
        role: "system",
        content:
          "Return JSON only. Parse a driver expense receipt photo. Classify the receipt category. Use category gas for gasoline/fuel station receipts or EV charging. Gas receipts often include PUMP, PRODUCT UNLEADED, GALLONS, PRICE/G, FUEL SALE, CREDIT, or USD total even when the merchant name is faint. Extract the merchant/vendor name, visible receipt date if present, the final paid total in cents, and gasEvidence fields. Do not invent missing data. If multiple totals appear, use the final amount paid. Include warnings for ambiguous or low-confidence reads.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Classify this driver receipt and extract vendorName, receiptDate, totalCents, confidence 0-1, warnings, and gasEvidence. If you see pump number, unleaded/diesel/fuel product, gallons, price per gallon, or fuel sale, classify it as gas.",
          },
          {
            type: "image_url",
            image_url: { url: `data:${input.mimeType};base64,${input.base64}`, detail: "high" },
          },
        ],
      },
    ],
  });
  const raw = result.choices[0]?.message.content;
  const json = typeof raw === "string" ? JSON.parse(raw) : raw;
  return normalizeParsedExpenseReceipt(json);
}
