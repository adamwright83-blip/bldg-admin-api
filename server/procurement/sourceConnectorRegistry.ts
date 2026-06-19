import {
  evaluateSourceConnectorCompliance,
  type SourceConnectorKey,
} from "./sourceConnectorCompliancePolicy";
import type {
  SourceConnectorAdapter,
  SourceConnectorRunInput,
  SourceConnectorRunResult,
} from "./sourceConnectorTypes";

function disabledAdapter(sourceKey: SourceConnectorKey): SourceConnectorAdapter {
  return Object.freeze({
    sourceKey,
    enabled: false as const,
    async run(input: SourceConnectorRunInput): Promise<SourceConnectorRunResult> {
      if (input.compliance.sourceKey !== sourceKey) {
        return blocked(sourceKey, "connector_compliance_source_mismatch");
      }
      if (!input.configurationPresent) {
        return {
          ...blocked(sourceKey, "connector_configuration_missing"),
          status: "needs_configuration",
        };
      }

      const compliance = evaluateSourceConnectorCompliance(input.compliance);
      if (sourceKey === "reddit" || compliance.reasons.includes("legal_review_required")) {
        return {
          ...blocked(sourceKey, "connector_legal_review_required"),
          status: "needs_legal_review",
        };
      }
      return blocked(sourceKey, "connector_disabled");
    },
  });
}

function blocked(sourceKey: SourceConnectorKey, reason: string): SourceConnectorRunResult {
  return {
    sourceKey,
    status: "blocked",
    candidates: [],
    reasons: [reason],
    externalCallPerformed: false,
  };
}

const ADAPTERS: Readonly<Record<SourceConnectorKey, SourceConnectorAdapter>> = Object.freeze({
  google_business_profiles: disabledAdapter("google_business_profiles"),
  yelp_business_directory: disabledAdapter("yelp_business_directory"),
  reddit: disabledAdapter("reddit"),
});

export function getSourceConnector(sourceKey: string): SourceConnectorAdapter | null {
  return Object.prototype.hasOwnProperty.call(ADAPTERS, sourceKey)
    ? ADAPTERS[sourceKey as SourceConnectorKey]
    : null;
}

export function listSourceConnectors(): readonly SourceConnectorAdapter[] {
  return Object.values(ADAPTERS);
}

export function connectorResultCanBecomeCandidateEvidence(
  result: SourceConnectorRunResult,
  complianceInput: SourceConnectorRunInput["compliance"],
): boolean {
  const compliance = evaluateSourceConnectorCompliance(complianceInput);
  return result.sourceKey === complianceInput.sourceKey
    && result.status !== "blocked"
    && result.status !== "needs_configuration"
    && result.status !== "needs_legal_review"
    && result.candidates.length > 0
    && compliance.candidateEvidenceAllowed;
}
