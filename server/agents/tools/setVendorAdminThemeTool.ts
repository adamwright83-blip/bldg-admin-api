import { updateVendorAdminConfig } from "../../db";
import type { AgentTool } from "../toolRegistry";

export const setVendorAdminThemeTool: AgentTool<Record<string, any>> = {
  name: "setVendorAdminThemeTool",
  description: "Change a vendor admin theme without changing bookings, services, payments, permissions, or workflows.",
  async execute(input, ctx) {
    const vendorId = Number(input.vendorId);
    const themeKey = input.themeKey ?? "standard";
    await updateVendorAdminConfig(ctx.tenantId, vendorId, { themeKey });
    return {
      entityType: "vendor_admin_theme",
      entityId: vendorId,
      output: {
        vendorId,
        themeKey,
        dataChanged: false,
        bookingsChanged: false,
        workflowsChanged: false,
        paymentsChanged: false,
      },
    };
  },
};
