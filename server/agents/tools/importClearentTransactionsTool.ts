import type { AgentTool } from "../toolRegistry";
import { importClearentTransactions, parseClearentReportBasis } from "../../clearent";

export const importClearentTransactionsTool: AgentTool<Record<string, any>> = {
  name: "importClearentTransactionsTool",
  description: "Import Clearent / XplorPay CSV text through the stable payment ingestion layer. Browser automation must hand off exported files here instead of mutating DB directly.",
  async execute(input) {
    const csvText = typeof input.csvText === "string" ? input.csvText : "";
    if (!csvText.trim()) {
      return {
        entityType: "clearent_import_batch",
        entityId: null,
        output: {
          status: "blocked",
          reason: "csvText is required for agent tool imports",
          label: "Clearent / XplorPay",
        },
      };
    }

    const summary = await importClearentTransactions({
      buffer: Buffer.from(csvText),
      csvText,
      fileName: typeof input.sourceFileName === "string" ? input.sourceFileName : undefined,
      contentType: "text/csv",
      sourceReportBasis: parseClearentReportBasis(input.reportBasis ?? input.sourceReportBasis),
    });

    return {
      entityType: "clearent_import_batch",
      entityId: summary.importBatchId,
      output: {
        ...summary,
        label: "Clearent / XplorPay",
      },
    };
  },
};
