export type TenantImportProviderKey = "cleancloud_csv" | (string & {});

export type TenantImportCapabilities = {
  customers: boolean;
  orders: boolean;
  connectionMode: "csv" | "api";
};

export type TenantImportRequest = {
  tenantId: string;
  sourceFileName: string;
  payload: string;
  options?: Record<string, string>;
};

export type TenantImportResult = {
  providerKey: string;
  importedCustomers: number;
  importedOrders: number;
  skippedRecords: number;
  completedWithErrors: boolean;
  errors: Array<{ rowNumber?: number; message: string }>;
  normalizedCustomers?: NormalizedTenantCustomer[];
  normalizedOrders?: NormalizedTenantOrder[];
};

export type NormalizedTenantCustomer = {
  externalId: string;
  name: string;
  email: string | null;
  phone: string | null;
  sourceCapturedAt: string;
  facts: Record<string, unknown>;
};

export type NormalizedTenantOrder = {
  externalId: string;
  externalCustomerId: string | null;
  totalCents: number;
  paid: boolean;
  occurredAt: string | null;
  sourceCapturedAt: string;
  facts: Record<string, unknown>;
};

export interface OrderCustomerImportProvider {
  readonly key: TenantImportProviderKey;
  readonly capabilities: TenantImportCapabilities;
  validateConnection(configuration: unknown): Promise<void>;
  importBatch(input: TenantImportRequest): Promise<TenantImportResult>;
}
