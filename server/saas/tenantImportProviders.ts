import type {
  OrderCustomerImportProvider,
  TenantImportRequest,
  TenantImportResult,
} from "../../shared/tenantImports";
import {
  importCleanCloudPaidOrders,
  normalizeCleanCloudPaidOrderRow,
  parseCleanCloudPaidReportType,
} from "../cleancloudPaidOrders";
import { parseCsv } from "../externalSystems/csvIngestion";

class CleanCloudCsvImportProvider implements OrderCustomerImportProvider {
  readonly key = "cleancloud_csv" as const;
  readonly capabilities = {
    customers: true,
    orders: true,
    connectionMode: "csv",
  } as const;

  async validateConnection(configuration: unknown): Promise<void> {
    if (configuration != null && typeof configuration !== "object") {
      throw new Error("CleanCloud CSV configuration must be an object");
    }
  }

  async importBatch(input: TenantImportRequest): Promise<TenantImportResult> {
    const summary = await importCleanCloudPaidOrders({
      csvText: input.payload,
      sourceFileName: input.sourceFileName,
      sourceReportType: parseCleanCloudPaidReportType(
        input.options?.reportType ?? "orders_sales"
      ),
      tenantId: input.tenantId,
    });
    const capturedAt = new Date().toISOString();
    const normalizedRows = parseCsv(input.payload)
      .map(
        row =>
          normalizeCleanCloudPaidOrderRow(row, {
            sourceReportType: summary.sourceReportType,
            sourceFileName: input.sourceFileName,
            importBatchId: summary.importBatchId ?? 0,
            tenantId: input.tenantId,
          }).normalized
      )
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    const customers = new Map<string, (typeof normalizedRows)[number]>();
    for (const row of normalizedRows) {
      const externalId =
        row.cleancloudCustomerId ||
        row.customerEmail ||
        row.customerPhone ||
        `name:${row.customerName.toLowerCase()}`;
      if (!customers.has(externalId)) customers.set(externalId, row);
    }
    return {
      providerKey: this.key,
      importedCustomers: customers.size,
      importedOrders: summary.importedRowCount + summary.updatedRowCount,
      skippedRecords: summary.skippedRowCount,
      completedWithErrors: summary.importStatus === "completed_with_errors",
      errors: summary.errors.map(error => ({
        rowNumber: error.rowNumber,
        message: error.message,
      })),
      normalizedCustomers: Array.from(customers, ([externalId, row]) => ({
        externalId,
        name: row.customerName,
        email: row.customerEmail ?? null,
        phone: row.customerPhone ?? null,
        sourceCapturedAt: capturedAt,
        facts: { address: row.address, buildingSlug: row.buildingSlug },
      })),
      normalizedOrders: normalizedRows.map(row => ({
        externalId: row.cleancloudOrderId,
        externalCustomerId: row.cleancloudCustomerId ?? null,
        totalCents: row.totalCents ?? 0,
        paid: row.paid ?? false,
        occurredAt: row.placedAtUtc?.toISOString() ?? null,
        sourceCapturedAt: capturedAt,
        facts: {
          status: row.orderStatus,
          totalWeightLbs: row.totalWeightLbs,
          reportType: row.sourceReportType,
        },
      })),
    };
  }
}

const providers = new Map<string, OrderCustomerImportProvider>();

export function registerTenantImportProvider(
  provider: OrderCustomerImportProvider
) {
  providers.set(provider.key, provider);
}

export function getTenantImportProvider(
  key: string
): OrderCustomerImportProvider {
  const provider = providers.get(key);
  if (!provider) throw new Error(`Unsupported tenant import provider: ${key}`);
  return provider;
}

registerTenantImportProvider(new CleanCloudCsvImportProvider());
