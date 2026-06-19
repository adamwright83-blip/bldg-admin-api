export const VENDOR_SOURCE_TYPES = [
  "manual_operator_list",
  "public_business_directory",
  "permitted_public_fetch",
] as const;

export type VendorSourceType = (typeof VENDOR_SOURCE_TYPES)[number];
export type VendorSourceRegistryRow = {
  sourceType: string;
  complianceClass: string;
  allowedUseFlags: Record<string, unknown>;
  prohibitedUseFlags: Record<string, unknown>;
  sourcePolicy: Record<string, unknown>;
  notes: string | null;
};

export type CandidateIdentity = {
  sourceType: string;
  sourceReference: string;
  category: string;
  businessName: string;
};

export type CandidateCreationDecision = {
  allowed: boolean;
  reasons: string[];
};

const flagIsTrue = (value: Record<string, unknown> | null | undefined, key: string) =>
  value?.[key] === true;

export function isRegisteredSourceType(sourceType: string): sourceType is VendorSourceType {
  return VENDOR_SOURCE_TYPES.includes(sourceType as VendorSourceType);
}

export function sourceAllowsCandidateDiscovery(row: VendorSourceRegistryRow | null): boolean {
  return !!row && isRegisteredSourceType(row.sourceType)
    && flagIsTrue(row.allowedUseFlags, "candidate_discovery")
    && sourceProhibitsUnsafeAccess(row);
}

export function sourceAllowsPublicEvidenceCapture(row: VendorSourceRegistryRow | null): boolean {
  return sourceAllowsCandidateDiscovery(row)
    && flagIsTrue(row!.allowedUseFlags, "public_evidence_capture");
}

export function sourceProhibitsUnsafeAccess(row: VendorSourceRegistryRow | null): boolean {
  return !!row
    && flagIsTrue(row.prohibitedUseFlags, "login_bypass")
    && flagIsTrue(row.prohibitedUseFlags, "tos_violating_access")
    && flagIsTrue(row.prohibitedUseFlags, "hidden_bulk_scraping")
    && flagIsTrue(row.prohibitedUseFlags, "purchased_lead_lists");
}

export function candidateHasRequiredIdentity(candidate: CandidateIdentity): boolean {
  return [candidate.sourceType, candidate.sourceReference, candidate.category, candidate.businessName]
    .every(value => typeof value === "string" && value.trim().length > 0);
}

export function canCreateCandidate(
  candidate: CandidateIdentity,
  registryRow: VendorSourceRegistryRow | null,
): CandidateCreationDecision {
  const reasons: string[] = [];
  if (!candidateHasRequiredIdentity(candidate)) reasons.push("missing_required_candidate_identity");
  if (!registryRow || !isRegisteredSourceType(registryRow.sourceType)) reasons.push("source_not_registered");
  else if (candidate.sourceType !== registryRow.sourceType) reasons.push("source_registry_mismatch");
  if (registryRow && !sourceAllowsCandidateDiscovery(registryRow)) reasons.push("candidate_discovery_not_allowed");
  return { allowed: reasons.length === 0, reasons };
}

export function isCandidateReadyForOutreach(): false {
  return false;
}
