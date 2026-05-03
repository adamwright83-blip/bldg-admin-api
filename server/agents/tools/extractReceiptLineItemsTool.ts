import type { AgentTool } from "../toolRegistry";

function centsFromPrice(raw: string): number | null {
  const match = raw.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  return Math.round(Number(match[1]) * 100);
}

export const extractReceiptLineItemsTool: AgentTool<Record<string, any>> = {
  name: "extractReceiptLineItemsTool",
  description: "Parse dry-cleaning receipt text into garment line items without charging a card.",
  async execute(input) {
    const text = String(input.receiptText ?? "");
    const lineItems = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const priceCents = centsFromPrice(line);
        const garmentType = line.replace(/\$?\s*\d+(?:\.\d{1,2})?/g, "").replace(/\s+/g, " ").trim();
        return { garmentType: garmentType || "garment", quantity: 1, partnerCostCents: priceCents, rawText: line };
      })
      .filter((item) => item.partnerCostCents != null || item.garmentType !== "garment");

    const partnerCostCents = lineItems.reduce((sum, item) => sum + (item.partnerCostCents ?? 0), 0);
    return {
      entityType: "receipt",
      entityId: input.orderId ?? null,
      output: {
        orderId: input.orderId ?? null,
        lineItems,
        partnerCostCents,
        requiresOperatorCorrection: lineItems.length === 0,
      },
    };
  },
};
