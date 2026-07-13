import {
  finishTenantImportRun,
  persistNormalizedTenantImport,
  startTenantImportRun,
} from "./saasStore";
import { getTenantImportProvider } from "./tenantImportProviders";

export async function runTenantImport(input: {
  tenantId: string;
  providerKey: string;
  sourceFileName: string;
  payload: string;
  options?: Record<string, string>;
}) {
  const provider = getTenantImportProvider(input.providerKey);
  await provider.validateConnection({
    mode: provider.capabilities.connectionMode,
  });
  const run = await startTenantImportRun({
    tenantId: input.tenantId,
    providerKey: input.providerKey,
    configuration: { mode: provider.capabilities.connectionMode },
  });
  try {
    const result = await provider.importBatch(input);
    await persistNormalizedTenantImport({
      tenantId: input.tenantId,
      providerKey: input.providerKey,
      connectionId: run.connectionId,
      runId: run.runId,
      customers: result.normalizedCustomers ?? [],
      orders: result.normalizedOrders ?? [],
    });
    await finishTenantImportRun({
      tenantId: input.tenantId,
      runId: run.runId,
      connectionId: run.connectionId,
      status: result.completedWithErrors
        ? "completed_with_errors"
        : "completed",
      importedCustomers: result.importedCustomers,
      importedOrders: result.importedOrders,
      skippedRecords: result.skippedRecords,
      errorJson: result.errors.length ? result.errors : undefined,
    });
    return {
      runId: run.runId,
      providerKey: result.providerKey,
      importedCustomers: result.importedCustomers,
      importedOrders: result.importedOrders,
      skippedRecords: result.skippedRecords,
      completedWithErrors: result.completedWithErrors,
      errors: result.errors,
    };
  } catch (error) {
    await finishTenantImportRun({
      tenantId: input.tenantId,
      runId: run.runId,
      connectionId: run.connectionId,
      status: "failed",
      importedCustomers: 0,
      importedOrders: 0,
      skippedRecords: 0,
      errorJson: [
        { message: error instanceof Error ? error.message : "Import failed" },
      ],
    });
    throw error;
  }
}
