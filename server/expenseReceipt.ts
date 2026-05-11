import { invokeLLM } from "./_core/llm";

export type ParsedExpenseReceipt = {
  category: "gas" | "parking" | "vehicle" | "supplies" | "food" | "other" | "unknown";
  vendorName: string | null;
  receiptDate: string | null;
  totalCents: number;
  confidence: number;
  warnings: string[];
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
    },
    required: ["category", "vendorName", "receiptDate", "totalCents", "confidence", "warnings"],
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

function normalizeCategory(value: unknown): ParsedExpenseReceipt["category"] {
  const s = typeof value === "string" ? value.toLowerCase().trim() : "";
  if (s === "gas" || s === "parking" || s === "vehicle" || s === "supplies" || s === "food" || s === "other") {
    return s;
  }
  return "unknown";
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
          "Return JSON only. Parse a driver expense receipt photo. Classify the receipt category. Use category gas only for gasoline/fuel station receipts or EV charging. Extract the merchant/vendor name, visible receipt date if present, and the final paid total in cents. Do not invent missing data. If multiple totals appear, use the final amount paid. Include warnings for ambiguous or low-confidence reads.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "Classify this driver receipt and extract vendorName, receiptDate, totalCents, confidence 0-1, and warnings. If it is not gas/fuel, classify it accurately and still extract the total.",
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
  return {
    category: normalizeCategory(json.category),
    vendorName: typeof json.vendorName === "string" && json.vendorName.trim() ? json.vendorName.trim() : null,
    receiptDate: typeof json.receiptDate === "string" && json.receiptDate.trim() ? json.receiptDate.trim() : null,
    totalCents: cents(json.totalCents),
    confidence: clampConfidence(json.confidence),
    warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : [],
  };
}
