import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  provider,
  startTenantImportRun,
  persistNormalizedTenantImport,
  finishTenantImportRun,
} = vi.hoisted(() => {
  const provider = {
    key: "fixture_csv",
    capabilities: {
      customers: true,
      orders: true,
      connectionMode: "csv",
    },
    manifest: {
      providerKey: "fixture_csv",
      version: "1",
      entityCapabilities: ["customers", "orders"],
      connectionModes: ["csv"],
      canonicalIdentityKeys: {},
      coverage: { bases: ["orders_created"], semantics: "existing_source_coverage" },
      freshness: { clock: "existing_source_binding" },
      provenance: { providerIdentity: "fixture", adapterVersion: "fixture-v1" },
      evidenceClass: "authoritative_external",
    },
    validateConnection: vi.fn(async () => undefined),
    importBatch: vi.fn(async () => ({
      providerKey: "fixture_csv",
      importedCustomers: 1,
      importedOrders: 1,
      skippedRecords: 0,
      completedWithErrors: false,
      errors: [],
      normalizedCustomers: [
        {
          externalId: "customer-1",
          name: "Customer One",
          email: null,
          phone: null,
          sourceCapturedAt: "2026-09-28T00:00:00.000Z",
          facts: {},
        },
      ],
      normalizedOrders: [
        {
          externalId: "order-1",
          externalCustomerId: "customer-1",
          totalCents: 2500,
          paid: true,
          occurredAt: "2026-09-28T00:00:00.000Z",
          sourceCapturedAt: "2026-09-28T00:00:00.000Z",
          facts: {},
        },
      ],
    })),
  };
  return {
    provider,
    startTenantImportRun: vi.fn(async () => ({
      connectionId: 7,
      runId: "run-1",
    })),
    persistNormalizedTenantImport: vi.fn(async () => undefined),
    finishTenantImportRun: vi.fn(async () => undefined),
  };
});

vi.mock("./tenantImportProviders", () => ({
  getTenantImportProvider: vi.fn(() => provider),
}));

vi.mock("./saasStore", () => ({
  startTenantImportRun,
  persistNormalizedTenantImport,
  finishTenantImportRun,
}));

import { runTenantImport } from "./tenantImportService";

describe("runTenantImport batch compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the existing batch import orchestration and normalized persistence path", async () => {
    const result = await runTenantImport({
      tenantId: "tenant-a",
      providerKey: "fixture_csv",
      sourceFileName: "orders.csv",
      payload: "fixture",
    });

    expect(provider.validateConnection).toHaveBeenCalledWith({ mode: "csv" });
    expect(provider.importBatch).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      providerKey: "fixture_csv",
      sourceFileName: "orders.csv",
      payload: "fixture",
    });
    expect(persistNormalizedTenantImport).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      providerKey: "fixture_csv",
      connectionId: 7,
      runId: "run-1",
      customers: expect.arrayContaining([
        expect.objectContaining({ externalId: "customer-1" }),
      ]),
      orders: expect.arrayContaining([
        expect.objectContaining({ externalId: "order-1", totalCents: 2500, paid: true }),
      ]),
    });
    expect(finishTenantImportRun).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        runId: "run-1",
        connectionId: 7,
        status: "completed",
        importedCustomers: 1,
        importedOrders: 1,
      })
    );
    expect(result).toEqual({
      runId: "run-1",
      providerKey: "fixture_csv",
      importedCustomers: 1,
      importedOrders: 1,
      skippedRecords: 0,
      completedWithErrors: false,
      errors: [],
    });
  });
});
