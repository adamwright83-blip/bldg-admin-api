/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import {
  DAYFORGE_COACHING_CLAIM_KEYS,
  claimMayDriveDirectInstruction,
  legacyDayforgeCoachingOutputSchema,
  legacyDayforgeEvidenceReferenceSchema,
  legacyDayforgeModelCoachingOutputSchema,
  type LegacyDayforgeClaimProvenance,
  type LegacyDayforgeCoachingClaim,
  type LegacyDayforgeCoachingClaimKey,
  type LegacyDayforgeCoachingOutput,
  type LegacyDayforgeEvidenceReference,
} from "@shared/legacyDayforgeCoaching";

export const DAYFORGE_COACHING_FALLBACK_CATEGORIES = [
  "luxury_full_service_hotel",
  "apartment_building",
  "property_management_company",
  "salon",
  "med_spa",
  "gym",
  "office",
  "restaurant",
  "other_local_service_business",
] as const;

export type LegacyDayforgeCoachingFallbackCategory =
  (typeof DAYFORGE_COACHING_FALLBACK_CATEGORIES)[number];

export const DAYFORGE_COACHING_FALLBACK_CODES = [
  "provider_unconfigured",
  "provider_timeout",
  "provider_over_budget",
  "provider_circuit_open",
  "provider_error",
  "invalid_structured_output",
  "invalid_evidence",
  "unsafe_ungrounded_claim",
  "unsafe_output_content",
] as const;

export type LegacyDayforgeCoachingFallbackCode =
  (typeof DAYFORGE_COACHING_FALLBACK_CODES)[number];

export type LegacyDayforgeCoachingGroundingEvidence = {
  claimKey: LegacyDayforgeCoachingClaimKey;
  /** Canonical, server-produced representation that a model claim must match. */
  displayValue: string;
  reference: LegacyDayforgeEvidenceReference;
};

export type PreparedLegacyDayforgeCoachingArtifact = {
  generationStatus: "generated" | "fallback";
  structuredOutput: LegacyDayforgeCoachingOutput;
  evidenceReferences: LegacyDayforgeEvidenceReference[];
  fallbackCode: LegacyDayforgeCoachingFallbackCode | null;
  failureCode: string | null;
};

export class LegacyDayforgeCoachingPolicyError extends Error {
  constructor(
    readonly code:
      | "invalid_structured_output"
      | "unsafe_ungrounded_claim"
      | "unsafe_output_content"
      | "invalid_evidence",
    message: string,
  ) {
    super(message);
    this.name = "LegacyDayforgeCoachingPolicyError";
  }
}

const ACCOUNT_SPECIFIC_CLAIM_KEYS = new Set<LegacyDayforgeCoachingClaimKey>([
  "account_type",
  "decision_maker_name",
  "address",
  "portfolio_size",
  "unit_count",
  "distance",
  "estimated_annual_value",
  "current_vendor",
  "reporting_line",
  "approved_offer",
  "prior_visit",
]);

const SAFE_OBJECTION_CATEGORIES = new Map([
  ["timing", "Timing"],
  ["existing vendor", "Existing vendor"],
  ["pricing", "Pricing"],
  ["capacity", "Capacity"],
  ["turnaround", "Turnaround"],
  ["quality", "Quality"],
  ["reliability", "Reliability"],
  ["contract", "Contract"],
]);

const CLAIM_LABELS: Partial<Record<LegacyDayforgeCoachingClaimKey, string>> = {
  account_type: "account type",
  decision_maker_name: "decision maker",
  address: "address",
  portfolio_size: "portfolio size",
  unit_count: "unit count",
  distance: "distance",
  estimated_annual_value: "estimated annual value",
  current_vendor: "current vendor",
  reporting_line: "reporting line",
  approved_offer: "approved offer",
  prior_visit: "prior visit",
};

const DIRECT_FIELD_KEYS: ReadonlyArray<{
  key: LegacyDayforgeCoachingClaimKey;
  read: (output: LegacyDayforgeCoachingOutput) => string;
}> = [
  { key: "recommended_role", read: output => output.recommendedRole },
  { key: "first_navigation_point", read: output => output.firstNavigationPoint },
  { key: "fallback_navigation_point", read: output => output.fallbackNavigationPoint },
  { key: "opening_line", read: output => output.openingLine },
];

const SENSITIVE_OUTPUT_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:ignore|disregard) (?:all |any )?(?:previous|prior|system) instructions/i,
  /\b(?:system|developer) prompt\b/i,
  /<script\b/i,
];

function normalizedDisplayValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function outputProse(output: LegacyDayforgeCoachingOutput): string[] {
  return [
    output.recommendedRole,
    output.roleRationale,
    output.firstNavigationPoint,
    output.fallbackNavigationPoint,
    output.openingLine,
    ...output.discoveryQuestions,
    ...output.likelyObjectionCategories,
    ...output.doNotClaim,
    ...output.unknowns,
    ...output.claims.map(claim => claim.displayValue),
    output.generatedSummary,
  ];
}

export function assertLegacyDayforgeCoachingOutputIsSafeForStorage(
  output: LegacyDayforgeCoachingOutput,
): void {
  const unsafe = outputProse(output).find(value =>
    SENSITIVE_OUTPUT_PATTERNS.some(pattern => pattern.test(value))
  );
  if (unsafe) {
    throw new LegacyDayforgeCoachingPolicyError(
      "unsafe_output_content",
      "Coaching output contains sensitive or instruction-like content that cannot be stored",
    );
  }
}

function confidenceForProvenance(
  provenance: LegacyDayforgeClaimProvenance,
): LegacyDayforgeCoachingClaim["confidence"] {
  if (["provider_sourced", "operator_observation", "crm_history"].includes(provenance)) {
    return "high";
  }
  if (["deterministic_estimate", "general_industry_guidance"].includes(provenance)) {
    return "medium";
  }
  return "low";
}

function sourceAllowsDirectInstruction(provenance: LegacyDayforgeClaimProvenance): boolean {
  return [
    "provider_sourced",
    "operator_observation",
    "crm_history",
    "general_industry_guidance",
  ].includes(provenance);
}

export function sanitizeLegacyDayforgeEvidenceReferenceForStorage(
  reference: LegacyDayforgeEvidenceReference,
): LegacyDayforgeEvidenceReference {
  const parsed = legacyDayforgeEvidenceReferenceSchema.safeParse(reference);
  if (!parsed.success) {
    throw new LegacyDayforgeCoachingPolicyError(
      "invalid_evidence",
      "Coaching evidence reference did not match the storage contract",
    );
  }

  let sourceUrl = parsed.data.sourceUrl;
  if (sourceUrl) {
    const url = new URL(sourceUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    sourceUrl = url.toString();
  }

  const inputs = parsed.data.inputs
    ? Object.fromEntries(
        Object.entries(parsed.data.inputs).filter(([key, value]) => {
          if (/(?:resident|customer|contact|person|name|email|phone)/i.test(key)) return false;
          if (typeof value !== "string") return true;
          return !SENSITIVE_OUTPUT_PATTERNS.some(pattern => pattern.test(value));
        }),
      )
    : null;

  const sanitized = {
    ...parsed.data,
    sourceUrl,
    inputs,
  };
  if (
    sanitized.sourceType === "deterministic_estimate" &&
    (
      sanitized.formulaVersion === null ||
      sanitized.formula === null ||
      sanitized.inputs === null ||
      Object.keys(sanitized.inputs).length === 0
    )
  ) {
    throw new LegacyDayforgeCoachingPolicyError(
      "invalid_evidence",
      "Deterministic estimates require a formula version, formula, and retained inputs",
    );
  }
  return sanitized;
}

function validatedGroundingEvidence(
  evidence: LegacyDayforgeCoachingGroundingEvidence[],
): Map<string, LegacyDayforgeCoachingGroundingEvidence> {
  if (evidence.length > 50) {
    throw new LegacyDayforgeCoachingPolicyError(
      "invalid_evidence",
      "At most 50 coaching evidence references may be supplied",
    );
  }
  const byId = new Map<string, LegacyDayforgeCoachingGroundingEvidence>();
  for (const candidate of evidence) {
    if (!DAYFORGE_COACHING_CLAIM_KEYS.includes(candidate.claimKey)) {
      throw new LegacyDayforgeCoachingPolicyError("invalid_evidence", "Unknown coaching claim key");
    }
    const displayValue = candidate.displayValue.trim();
    if (!displayValue || displayValue.length > 512) {
      throw new LegacyDayforgeCoachingPolicyError(
        "invalid_evidence",
        "Coaching evidence display value is outside the allowed bounds",
      );
    }
    const reference = sanitizeLegacyDayforgeEvidenceReferenceForStorage(candidate.reference);
    const previous = byId.get(reference.id);
    if (previous) {
      const same = previous.claimKey === candidate.claimKey &&
        normalizedDisplayValue(previous.displayValue) === normalizedDisplayValue(displayValue) &&
        previous.reference.sourceType === reference.sourceType;
      if (!same) {
        throw new LegacyDayforgeCoachingPolicyError(
          "invalid_evidence",
          "A coaching evidence ID cannot describe multiple claims",
        );
      }
      continue;
    }
    byId.set(reference.id, { ...candidate, displayValue, reference });
  }
  return byId;
}

function assertUniqueClaimKeys(
  claims: Array<{ key: LegacyDayforgeCoachingClaimKey }>,
): void {
  const keys = new Set<LegacyDayforgeCoachingClaimKey>();
  for (const claim of claims) {
    if (keys.has(claim.key)) {
      throw new LegacyDayforgeCoachingPolicyError(
        "invalid_structured_output",
        `Coaching output repeated claim key ${claim.key}`,
      );
    }
    keys.add(claim.key);
  }
}

/**
 * Converts model output into the only representation that may be persisted.
 * Provenance, confidence, grounded state, and direct-instruction safety are all
 * assigned here from server-owned evidence; the model schema cannot set them.
 */
export function groundLegacyDayforgeModelCoachingOutput(input: {
  rawOutput: unknown;
  evidence: LegacyDayforgeCoachingGroundingEvidence[];
  generatedAt: Date;
}): PreparedLegacyDayforgeCoachingArtifact {
  const parsed = legacyDayforgeModelCoachingOutputSchema.safeParse(input.rawOutput);
  if (!parsed.success) {
    throw new LegacyDayforgeCoachingPolicyError(
      "invalid_structured_output",
      "Provider coaching output did not match the structured result schema",
    );
  }
  assertUniqueClaimKeys(parsed.data.claims);
  const evidenceById = validatedGroundingEvidence(input.evidence);
  const generatedAt = input.generatedAt.toISOString();
  const claims: LegacyDayforgeCoachingClaim[] = parsed.data.claims.map(modelClaim => {
    const evidence = modelClaim.evidenceReferenceId
      ? evidenceById.get(modelClaim.evidenceReferenceId)
      : undefined;
    const matched = evidence &&
      evidence.claimKey === modelClaim.key &&
      normalizedDisplayValue(evidence.displayValue) === normalizedDisplayValue(modelClaim.displayValue);
    if (!matched) {
      return {
        key: modelClaim.key,
        displayValue: modelClaim.displayValue,
        provenance: "model_inference",
        confidence: "low",
        evidenceReferenceId: null,
        capturedAt: generatedAt,
        safeForDirectInstruction: false,
        grounded: false,
      };
    }
    return {
      key: modelClaim.key,
      displayValue: modelClaim.displayValue,
      provenance: evidence.reference.sourceType,
      confidence: confidenceForProvenance(evidence.reference.sourceType),
      evidenceReferenceId: evidence.reference.id,
      capturedAt: evidence.reference.capturedAt,
      safeForDirectInstruction: sourceAllowsDirectInstruction(evidence.reference.sourceType),
      grounded: true,
    };
  });
  const initiallyGroundedOutput = legacyDayforgeCoachingOutputSchema.parse({ ...parsed.data, claims });
  for (const directField of DIRECT_FIELD_KEYS) {
    const value = normalizedDisplayValue(directField.read(initiallyGroundedOutput));
    const claim = claims.find(candidate =>
      candidate.key === directField.key &&
      normalizedDisplayValue(candidate.displayValue) === value
    );
    if (!claim || !claimMayDriveDirectInstruction(claim)) {
      throw new LegacyDayforgeCoachingPolicyError(
        "unsafe_ungrounded_claim",
        `Direct coaching field ${directField.key} was not grounded in an allowed source`,
      );
    }
  }

  // Persist server-composed prose rather than provider-authored narrative. This
  // prevents an undeclared account-specific paraphrase from bypassing exact
  // claim matching while preserving the model's evidence-backed action choices.
  const suppressedAccountClaimKeys = claims
    .filter(claim => !claim.grounded && ACCOUNT_SPECIFIC_CLAIM_KEYS.has(claim.key))
    .map(claim => claim.key);
  // Ungrounded claims are useful to the suppression decision, but are not
  // durable coaching facts. Persist only claims reconciled to server evidence.
  const retainedClaims = claims.filter(claim => claim.grounded);
  const objections = Array.from(new Set(
    parsed.data.likelyObjectionCategories.flatMap(value => {
      const allowed = SAFE_OBJECTION_CATEGORIES.get(normalizedDisplayValue(value));
      return allowed ? [allowed] : [];
    }),
  )).slice(0, 3);
  const unknownLabels = Array.from(new Set(
    suppressedAccountClaimKeys.map(key => CLAIM_LABELS[key] ?? "account detail"),
  ));
  const output = legacyDayforgeCoachingOutputSchema.parse({
    recommendedRole: parsed.data.recommendedRole,
    roleRationale: "This is a practical role to ask for based on the supplied guidance; it is not an account-verified individual.",
    firstNavigationPoint: parsed.data.firstNavigationPoint,
    fallbackNavigationPoint: parsed.data.fallbackNavigationPoint,
    openingLine: parsed.data.openingLine,
    discoveryQuestions: [
      "How is laundry or linen service handled today?",
      "What causes the most friction with the current process?",
      "Who else should be involved in evaluating a local service?",
    ],
    likelyObjectionCategories: objections.length > 0
      ? objections
      : ["Timing", "Existing vendor", "Pricing"],
    doNotClaim: ["Do not present an individual, contract, volume, value, vendor, or reporting line as verified without retained evidence."],
    unknowns: unknownLabels.length > 0
      ? unknownLabels.map(label => `The account's ${label} is unconfirmed.`)
      : ["Account-specific decision makers and buying details remain unconfirmed unless shown as sourced claims."],
    claims: retainedClaims,
    generatedSummary: `Ask for the ${parsed.data.recommendedRole}. Use the listed first move and fallback without implying that account-specific facts were verified.`,
  });
  assertLegacyDayforgeCoachingOutputIsSafeForStorage(output);

  const usedReferenceIds = new Set(
    retainedClaims.flatMap(claim => claim.evidenceReferenceId ? [claim.evidenceReferenceId] : []),
  );
  return {
    generationStatus: "generated",
    structuredOutput: output,
    evidenceReferences: Array.from(evidenceById.values())
      .filter(candidate => usedReferenceIds.has(candidate.reference.id))
      .map(candidate => candidate.reference),
    fallbackCode: null,
    failureCode: null,
  };
}

type FallbackTemplate = {
  role: string;
  rationale: string;
  firstMove: string;
  fallback: string;
};

const FALLBACK_TEMPLATES: Record<LegacyDayforgeCoachingFallbackCategory, FallbackTemplate> = {
  luxury_full_service_hotel: {
    role: "Director of Rooms",
    rationale: "This role commonly coordinates rooms-facing operations at a full-service hotel.",
    firstMove: "Ask security where Rooms leadership is located.",
    fallback: "Ask the concierge desk to route you to Rooms leadership.",
  },
  apartment_building: {
    role: "Community Manager",
    rationale: "This role commonly coordinates resident services and building operations.",
    firstMove: "Start at the leasing office and ask for the Community Manager.",
    fallback: "Ask the front desk who oversees resident-service vendors.",
  },
  property_management_company: {
    role: "Operations Manager",
    rationale: "This role commonly evaluates service vendors across managed properties.",
    firstMove: "Ask reception for the Operations Manager.",
    fallback: "Ask who manages regional vendor relationships.",
  },
  salon: {
    role: "Salon Owner or Manager",
    rationale: "This role commonly owns linen-service and operating decisions.",
    firstMove: "Ask the front desk for the owner or manager.",
    fallback: "Ask who handles towels and laundry service.",
  },
  med_spa: {
    role: "Practice Manager",
    rationale: "This role commonly coordinates clinical-support vendors and daily operations.",
    firstMove: "Ask reception for the Practice Manager.",
    fallback: "Ask who manages linen and towel service.",
  },
  gym: {
    role: "General Manager",
    rationale: "This role commonly owns facility-service and member-experience decisions.",
    firstMove: "Ask the front desk for the General Manager.",
    fallback: "Ask who oversees towel and facility vendors.",
  },
  office: {
    role: "Facilities or Office Manager",
    rationale: "This role commonly coordinates workplace service vendors.",
    firstMove: "Ask reception for the Facilities or Office Manager.",
    fallback: "Ask security who manages workplace vendors.",
  },
  restaurant: {
    role: "General Manager",
    rationale: "This role commonly owns day-to-day linen and service-vendor decisions.",
    firstMove: "Ask the host stand for the General Manager outside service rush.",
    fallback: "Ask who manages linen and laundry vendors.",
  },
  other_local_service_business: {
    role: "Owner or Operations Manager",
    rationale: "An owner or operations lead commonly evaluates recurring local services.",
    firstMove: "Ask the front desk for the person responsible for operations.",
    fallback: "Ask who evaluates recurring service vendors.",
  },
};

export function buildDeterministicLegacyDayforgeCoachingFallback(input: {
  category: LegacyDayforgeCoachingFallbackCategory;
  fallbackCode: LegacyDayforgeCoachingFallbackCode;
  generatedAt: Date;
  failureCode?: string | null;
}): PreparedLegacyDayforgeCoachingArtifact {
  const template = FALLBACK_TEMPLATES[input.category];
  const capturedAt = input.generatedAt.toISOString();
  const evidenceId = `legacy-dayforge-fallback-v1:${input.category}`;
  const reference = legacyDayforgeEvidenceReferenceSchema.parse({
    id: evidenceId,
    sourceType: "general_industry_guidance",
    capturedAt,
    sourceUrl: null,
    formulaVersion: null,
    formula: null,
    inputs: { businessTypeCategory: input.category, templateVersion: "v1" },
  });
  const directClaims: Array<[LegacyDayforgeCoachingClaimKey, string]> = [
    ["recommended_role", template.role],
    ["first_navigation_point", template.firstMove],
    ["fallback_navigation_point", template.fallback],
    [
      "opening_line",
      "Hi, I run a local commercial laundry service. Who handles laundry and linen operations here?",
    ],
  ];
  const claims: LegacyDayforgeCoachingClaim[] = directClaims.map(([key, displayValue]) => ({
    key,
    displayValue,
    provenance: "general_industry_guidance",
    confidence: "medium",
    evidenceReferenceId: evidenceId,
    capturedAt,
    safeForDirectInstruction: true,
    grounded: true,
  }));
  const output = legacyDayforgeCoachingOutputSchema.parse({
    recommendedRole: template.role,
    roleRationale: template.rationale,
    firstNavigationPoint: template.firstMove,
    fallbackNavigationPoint: template.fallback,
    openingLine: directClaims[3][1],
    discoveryQuestions: [
      "How is laundry or linen service handled today?",
      "What causes the most friction with the current process?",
      "Who else should be involved in evaluating a local service?",
    ],
    likelyObjectionCategories: ["Timing", "Existing vendor", "Pricing"],
    doNotClaim: ["Do not claim that any individual, contract, volume, or current vendor was verified."],
    unknowns: ["The account's current vendor, volume, decision maker, and buying process are unconfirmed."],
    claims,
    generatedSummary: `Ask for the ${template.role}; use the listed first move and fallback without presenting account-specific facts as verified.`,
  });
  assertLegacyDayforgeCoachingOutputIsSafeForStorage(output);
  return {
    generationStatus: "fallback",
    structuredOutput: output,
    evidenceReferences: [reference],
    fallbackCode: input.fallbackCode,
    failureCode: input.failureCode?.trim().slice(0, 96) || null,
  };
}
