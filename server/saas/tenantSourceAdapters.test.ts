import { describe, expect, it } from "vitest";
import {
  getTenantImportProvider,
  getTenantSourceAdapterManifest,
} from "./tenantImportProviders";

describe("tenant source adapter contract", () => {
  it("keeps CleanCloud batch import compatibility while exposing source semantics", () => {
    const provider = getTenantImportProvider("cleancloud_csv");
    const manifest = getTenantSourceAdapterManifest("cleancloud_csv");

    expect(provider.key).toBe("cleancloud_csv");
    expect(provider.capabilities).toEqual({
      customers: true,
      orders: true,
      connectionMode: "csv",
    });
    expect(manifest.providerKey).toBe(provider.key);
    expect(manifest.entityCapabilities).toEqual(["customers", "orders"]);
    expect(manifest.connectionModes).toEqual(["csv"]);
    expect(manifest.coverage.semantics).toBe("existing_source_coverage");
    expect(manifest.freshness.clock).toBe("existing_source_binding");
    expect(manifest.evidenceClass).toBe("authoritative_external");
  });

  it("fails closed for unknown providers", () => {
    expect(() => getTenantImportProvider("missing")).toThrow(
      /Unsupported tenant import provider/
    );
  });
});
