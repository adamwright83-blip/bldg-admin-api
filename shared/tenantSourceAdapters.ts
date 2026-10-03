import type { GoldlineEvidenceClass } from "./goldlineTruthContract";

export const TENANT_SOURCE_ENTITY_CAPABILITIES = [
  "customers",
  "orders",
  "payments",
  "invoices",
  "commercial_accounts",
  "contacts",
  "locations",
  "refunds",
] as const;
export type TenantSourceEntityCapability =
  (typeof TENANT_SOURCE_ENTITY_CAPABILITIES)[number];

export const TENANT_SOURCE_CONNECTION_MODES = [
  "csv",
  "oauth",
  "api_key",
  "webhook",
  "incremental_api",
] as const;
export type TenantSourceConnectionMode =
  (typeof TENANT_SOURCE_CONNECTION_MODES)[number];

export const TENANT_SOURCE_COVERAGE_BASES = [
  "economic_event",
  "orders_created",
  "payment_posted",
  "dashboard_control_total",
] as const;
export type TenantSourceCoverageBasis =
  (typeof TENANT_SOURCE_COVERAGE_BASES)[number];

export type TenantSourceAdapterManifest = {
  providerKey: string;
  version: string;
  entityCapabilities: readonly TenantSourceEntityCapability[];
  connectionModes: readonly TenantSourceConnectionMode[];
  canonicalIdentityKeys: Partial<
    Record<TenantSourceEntityCapability, readonly string[]>
  >;
  coverage: {
    bases: readonly TenantSourceCoverageBasis[];
    /** Source coverage remains authoritative; adapters do not invent a second clock. */
    semantics: "existing_source_coverage";
  };
  freshness: {
    clock: "existing_source_binding";
  };
  provenance: {
    providerIdentity: string;
    adapterVersion: string;
  };
  evidenceClass: GoldlineEvidenceClass;
};

export interface TenantSourceAdapter {
  readonly manifest: TenantSourceAdapterManifest;
  validateConnection(configuration: unknown): Promise<void>;
}

export function assertTenantSourceManifest(
  manifest: TenantSourceAdapterManifest
): TenantSourceAdapterManifest {
  if (!manifest.providerKey.trim()) throw new Error("Source provider key is required");
  if (!manifest.version.trim()) throw new Error("Source adapter version is required");
  if (manifest.entityCapabilities.length === 0) {
    throw new Error(`Source adapter ${manifest.providerKey} declares no entity capabilities`);
  }
  if (manifest.connectionModes.length === 0) {
    throw new Error(`Source adapter ${manifest.providerKey} declares no connection modes`);
  }
  return manifest;
}
