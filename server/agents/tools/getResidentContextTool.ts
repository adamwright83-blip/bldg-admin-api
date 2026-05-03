import { getOrdersByPhoneExact, searchOrdersForReceipt } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const getResidentContextTool: AgentTool<Record<string, any>> = {
  name: "getResidentContextTool",
  description: "Read resident context from existing order/customer records.",
  async execute(input) {
    const phone = typeof input.phone === "string" ? input.phone.trim() : "";
    const orders = phone ? await getOrdersByPhoneExact(phone) : [];
    const searchHits = !orders.length && input.query ? await searchOrdersForReceipt(String(input.query)) : [];
    return {
      entityType: "resident",
      entityId: phone || input.query || null,
      output: {
        phone: phone || null,
        orderCount: orders.length,
        latestOrder: orders[0] ?? null,
        searchHits,
      },
    };
  },
};
