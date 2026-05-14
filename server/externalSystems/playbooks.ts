import type { BrowserAutomationPlaybook } from "./csvIngestion";

export const cleanCloudDailyOrdersSalesPlaybook: BrowserAutomationPlaybook = {
  system: "cleancloud",
  playbook: "daily-orders-sales-export",
  cadence: "Daily at 4:00 PM America/Los_Angeles",
  downloadArtifact: "csv",
  handoffEndpoint: "/api/admin/cleancloud/import",
  steps: [
    {
      name: "Open CleanCloud reporting",
      actor: "browser",
      instruction: "Navigate to the authenticated CleanCloud Orders/Sales export surface.",
    },
    {
      name: "Select business day",
      actor: "browser",
      instruction: "Filter the report to the target Pacific business day before export.",
    },
    {
      name: "Download CSV",
      actor: "browser",
      instruction: "Export Orders/Sales as CSV and retain the downloaded filename.",
    },
    {
      name: "Submit artifact",
      actor: "system",
      instruction: "POST the CSV artifact to the stable ingestion endpoint. Do not write directly to application tables from browser automation.",
    },
    {
      name: "Report summary",
      actor: "system",
      instruction: "Return imported, skipped, duplicate, and unresolved-building counts to the operator or calling agent.",
    },
  ],
};

export const externalSystemPlaybooks = {
  cleancloud: {
    dailyOrdersSales: cleanCloudDailyOrdersSalesPlaybook,
  },
};
