import type { AgentTool } from "../toolRegistry";
import { importCleanCloudLegacyOrders } from "../../cleancloudLegacy";
import { cleanCloudDailyOrdersSalesPlaybook } from "../../externalSystems/playbooks";

export const importCleanCloudOrdersTool: AgentTool<Record<string, any>> = {
  name: "importCleanCloudOrdersTool",
  description: "Import CleanCloud Orders/Sales CSV text through the stable ingestion layer. Browser automation must hand off CSV here instead of mutating DB directly.",
  async execute(input) {
    const csvText = typeof input.csvText === "string" ? input.csvText : "";
    if (!csvText.trim()) {
      return {
        entityType: "cleancloud_import_batch",
        entityId: null,
        output: {
          status: "blocked",
          reason: "csvText is required",
          playbook: cleanCloudDailyOrdersSalesPlaybook,
        },
      };
    }

    const summary = await importCleanCloudLegacyOrders({
      csvText,
      sourceFileName: typeof input.sourceFileName === "string" ? input.sourceFileName : undefined,
    });

    return {
      entityType: "cleancloud_import_batch",
      entityId: summary.importBatchId,
      output: {
        ...summary,
        label: "Legacy CleanCloud",
        playbook: cleanCloudDailyOrdersSalesPlaybook,
      },
    };
  },
};
