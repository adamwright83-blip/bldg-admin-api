import { getVendorCategoryPreset } from "../vendorCategoryPresets";
import type { AgentTool } from "../toolRegistry";

export const createVendorAdminCommandTool: AgentTool<Record<string, any>> = {
  name: "createVendorAdminCommandTool",
  description: "Translate vendor admin chat/voice intent into a safe config-driven admin command.",
  async execute(input) {
    const commandText = String(input.command ?? input.text ?? "");
    const preset = getVendorCategoryPreset(input.categoryPresetKey ?? input.vendorCategory);
    const requestedSurface: string = commandText.toLowerCase().includes("inventory") ? "inventory"
      : commandText.toLowerCase().includes("supplies") ? "supplies"
      : commandText.toLowerCase().includes("payment") ? "payments"
      : commandText.toLowerCase().includes("setting") ? "settings"
      : commandText.toLowerCase().includes("service") ? "services"
      : commandText.toLowerCase().includes("availability") ? "availability"
      : "messages";
    const enabled = preset.enabledAdminSurfaces.includes(requestedSurface);
    return {
      entityType: "vendor_admin_command",
      entityId: input.vendorId ?? null,
      output: {
        vendorId: input.vendorId ?? null,
        requestedSurface,
        enabled,
        progressiveDisclosure: !enabled ? "Agent may suggest enabling this surface if the vendor explicitly needs it." : "Surface already enabled by preset.",
        requiresHumanApproval: requestedSurface === "payments" || requestedSurface === "settings",
      },
    };
  },
};
