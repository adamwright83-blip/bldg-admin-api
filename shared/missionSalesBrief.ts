/**
 * MissionSalesBrief — the single authoritative, provenance-aware sales
 * brief for one commercial mission. Claire and the field UI both consume
 * this exact artifact; neither is allowed to invent a separate strategy.
 * See docs in the Claire Pass 2 build brief for the full architectural law.
 */

/** The Goldline truth hierarchy this pass preserves, from highest to lowest authority. */
export type MissionSalesBriefProvenanceClass =
  | "authoritative_evidence" // system-of-record data (mission/account/pipeline/visit-outcome rows)
  | "operator_attested" // a fact the operator explicitly reported and had persisted
  | "derived_analysis" // deterministic computation over the above (e.g. "no price objection is recorded")
  | "reviewed_sales_intel" // an accepted/active SalesIntelTeaching
  | "recommendation" // a suggestion the compiler produced — never promotable to a fact
  | "game_projection"; // fictional/UX framing — never a source of business truth

export type MissionSalesBriefFact = {
  text: string;
  provenance: MissionSalesBriefProvenanceClass;
  sourceReference: string;
};

export type MissionSalesBriefUnknown = {
  question: string;
  /** Why this remains unknown, for transparency (e.g. "no visit outcome has recorded an objection yet"). */
  reason: string;
};

export type MissionSalesBriefIntelReference = {
  teachingId: string;
  category: string;
  title: string;
  rationale: string;
};

export type MissionSalesBriefRecommendedApproach = {
  primaryObjective: string;
  recommendedOpening: string | null;
  questionsToAsk: string[];
  actionsToTake: string[];
  thingsToAvoid: string[];
  successDefinition: string;
};

export type MissionSalesBriefSource = "model" | "fallback";

export type MissionSalesBrief = {
  id: number;
  version: number;
  tenantId: string;
  missionId: number;
  accountId: number | null;

  generatedAt: string;
  /** ISO timestamp of the most recent authoritative evidence this brief accounted for — the version-invalidation watermark. */
  generatedFromEvidenceThrough: string;

  account: {
    name: string;
    address: string | null;
    accountType: string | null;
  };

  mission: {
    missionType: string;
    currentStatus: string;
    objective: string;
  };

  knownFacts: MissionSalesBriefFact[];
  priorInteractions: MissionSalesBriefFact[];
  priorOutcomes: MissionSalesBriefFact[];
  relevantSignals: MissionSalesBriefFact[];

  unknowns: MissionSalesBriefUnknown[];
  unresolvedQuestions: string[];

  recommendedApproach: MissionSalesBriefRecommendedApproach;

  salesIntel: {
    includedIntelIds: string[];
    frameworkId: string | null;
    rationale: string | null;
  };

  provenance: {
    sourceReferences: string[];
    verificationClasses: MissionSalesBriefProvenanceClass[];
  };

  source: MissionSalesBriefSource;
  compilerVersion: string;
  confidence: number;
  warnings: string[];

  createdBy: "system";
  /** Version this one supersedes, or null for the first version of a mission. */
  supersedesVersion: number | null;
};

/** Compact projection handed to Claire (via ClaireDriveContext) — never the full brief, never raw Sales Intel content. */
export type CompactMissionSalesBriefForClaire = {
  briefId: number;
  version: number;
  primaryObjective: string;
  keyKnownFacts: string[];
  keyUnknown: string | null;
  recommendedOpening: string | null;
  questionsToAsk: string[];
  thingsToAvoid: string[];
  frameworkId: string | null;
};

/** Compact projection handed to the mobile FIELD BRIEF surface. */
export type FieldMissionSalesBrief = {
  briefId: number;
  version: number;
  primaryObjective: string;
  known: string[];
  keyUnknown: string | null;
  ask: string[];
  avoid: string[];
  previousRelevantOutcome: string | null;
  frameworkId: string | null;
};

export function toCompactMissionSalesBriefForClaire(
  brief: MissionSalesBrief
): CompactMissionSalesBriefForClaire {
  return {
    briefId: brief.id,
    version: brief.version,
    primaryObjective: brief.recommendedApproach.primaryObjective,
    keyKnownFacts: brief.knownFacts.slice(0, 4).map(fact => fact.text),
    keyUnknown: brief.unknowns[0]?.question ?? null,
    recommendedOpening: brief.recommendedApproach.recommendedOpening,
    questionsToAsk: brief.recommendedApproach.questionsToAsk.slice(0, 3),
    thingsToAvoid: brief.recommendedApproach.thingsToAvoid.slice(0, 3),
    frameworkId: brief.salesIntel.frameworkId,
  };
}

export function toFieldMissionSalesBrief(
  brief: MissionSalesBrief
): FieldMissionSalesBrief {
  return {
    briefId: brief.id,
    version: brief.version,
    primaryObjective: brief.recommendedApproach.primaryObjective,
    known: brief.knownFacts.map(fact => fact.text),
    keyUnknown: brief.unknowns[0]?.question ?? null,
    ask: brief.recommendedApproach.questionsToAsk,
    avoid: brief.recommendedApproach.thingsToAvoid,
    previousRelevantOutcome: brief.priorOutcomes[0]?.text ?? null,
    frameworkId: brief.salesIntel.frameworkId,
  };
}
