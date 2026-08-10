export const EXPANSION_SCOUT = "EXPANSION_SCOUT" as const;

export type CapabilityEvaluation = {
  capabilityId: typeof EXPANSION_SCOUT;
  eligible: boolean;
  unlocked: boolean;
  reasons: string[];
  sourceReferences: string[];
  evidenceSummary: Record<string, unknown>;
  unlockedAt: string | null;
};

export type ExpansionScoutEvidence = {
  verifiedWin: boolean;
  accountArchetype: string | null;
  accountAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  serviceType: string | null;
  serviceRadiusMiles: number | null;
  commercialServiceEnabled: boolean;
  sourceReferences: string[];
};

export function evaluateExpansionScout(
  evidence: ExpansionScoutEvidence
): Omit<CapabilityEvaluation, "unlocked" | "unlockedAt"> {
  const reasons: string[] = [];
  if (!evidence.verifiedWin)
    reasons.push("A verified commercial win is required");
  if (!evidence.accountArchetype || evidence.accountArchetype === "other") {
    reasons.push(
      "Need a meaningful won-account archetype for lookalike search"
    );
  }
  if (
    !evidence.accountAddress ||
    evidence.latitude == null ||
    evidence.longitude == null
  ) {
    reasons.push("Need a sourced won-account location");
  }
  if (!evidence.serviceType || !evidence.commercialServiceEnabled) {
    reasons.push("Need an enabled commercial service profile");
  }
  if (!evidence.serviceRadiusMiles || evidence.serviceRadiusMiles <= 0) {
    reasons.push("Need a configured service radius");
  }
  return {
    capabilityId: EXPANSION_SCOUT,
    eligible: reasons.length === 0,
    reasons:
      reasons.length === 0
        ? [
            "Verified win contains enough archetype, location, and service evidence for sourced lookalikes",
          ]
        : reasons,
    sourceReferences: evidence.sourceReferences,
    evidenceSummary: {
      verifiedWin: evidence.verifiedWin,
      accountArchetype: evidence.accountArchetype,
      hasSourcedLocation: Boolean(
        evidence.accountAddress &&
          evidence.latitude != null &&
          evidence.longitude != null
      ),
      serviceType: evidence.serviceType,
      serviceRadiusMiles: evidence.serviceRadiusMiles,
      commercialServiceEnabled: evidence.commercialServiceEnabled,
    },
  };
}

export type ScoutDiscovery = {
  entityId: string;
  missionId: number;
  companyName: string;
  address: string;
  matchScore: number | null;
  evidence: string[];
  sourceReference: string;
};

export type ScoutReport = {
  id: string;
  generatedAt: string;
  sourceReferences: string[];
  criteria: { archetype: string; area: string; radiusMiles: number };
  discoveries: ScoutDiscovery[];
};
