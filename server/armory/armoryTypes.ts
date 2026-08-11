import type {
  ObjectionArchetype,
  SalesIntelChannel,
  SalesIntelPhrase,
} from "../../shared/salesIntel";

export type { ObjectionArchetype, SalesIntelChannel };

/** Retained from Run 1/2 — the journal-and-coaching view of the Armory. */
export type ArmoryItem = {
  id: string;
  title: string;
  cue: string;
  response: string;
  outcome: "worked" | "did_not_work" | "guidance";
  provenance:
    | "personal_journal"
    | "curated_source"
    | "foundation"
    | "evidence_backed_mission_context";
  sourceReference: string;
};

export type ArchetypeSummary = {
  archetype: ObjectionArchetype;
  count: number;
  explanation: string;
  evidence: Array<{ text: string; sourceReference: string }>;
};

/**
 * Where a weapon's teaching comes from. These are mutually exclusive on
 * purpose: a trainer's teaching and the player's own evidence are different
 * kinds of claim and are never merged into one provenance.
 */
export type ArmoryProvenance =
  | {
      type: "trainer_source";
      creator: string;
      creatorHandle: string | null;
      frameworkId: string;
      frameworkName: string;
      sourceArtifactId: string;
      sourceUrl: string | null;
      sourceType: string;
      /** Set only when the extractor grounded it in a transcript range. */
      transcriptStartMs: number | null;
      transcriptEndMs: number | null;
      extractionVersion: string;
      extractionModel: string | null;
      confidence: number | null;
      /** Distinct other accepted sources teaching the same response for this archetype/channel — a fact, never a score. */
      independentSourceSupportCount: number;
    }
  | {
      type: "personal_evidence";
      evidenceReferences: string[];
    }
  | {
      type: "foundation";
      sourceReference: string;
    };

/**
 * Layer B, reported separately from the trainer's teaching and deliberately
 * phrased as observation. `uses` and `outcomeEvidence` are counts of things
 * that happened, not a success rate and not an attribution.
 */
export type ArmoryPersonalEvidence = {
  uses: number;
  outcomeEvidence: number;
  followUpsObserved: number;
  winsObserved: number;
  confidence: "insufficient" | "emerging" | "strong";
  /** Plain-language summary that never claims causation. */
  summary: string;
};

export type ArmoryWeapon = {
  id: string;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  title: string;
  responseFamily: string;
  /** Compact line the player sees in the encounter. */
  spokenLine: string | null;
  discoveryQuestion: string | null;
  /** Principle behind the move, shown when provenance is expanded. */
  principle: string | null;
  exampleLanguage: SalesIntelPhrase[];
  whenToUse: string[];
  whenNotToUse: string[];
  provenance: ArmoryProvenance;
  personalEvidence: ArmoryPersonalEvidence | null;
  /** Contextual fit for the current encounter; never a damage stat. */
  fit: "high" | "medium" | "low";
  fitReason: string;
};

export type ArmoryWeaponQuery = {
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  missionId: number | null;
};

/**
 * Evidence bands. Deliberately conservative: a handful of uses is never
 * enough to call something proven for this player.
 */
export function personalEvidenceConfidence(input: {
  uses: number;
  outcomeEvidence: number;
}): ArmoryPersonalEvidence["confidence"] {
  if (input.uses < 3) return "insufficient";
  if (input.uses >= 8 && input.outcomeEvidence >= 3) return "strong";
  return "emerging";
}

export function personalEvidenceSummary(input: {
  uses: number;
  outcomeEvidence: number;
  confidence: ArmoryPersonalEvidence["confidence"];
}): string {
  if (input.uses === 0) return "You have not used this yet.";
  const plural = input.uses === 1 ? "time" : "times";
  if (input.confidence === "insufficient") {
    return `Used ${input.uses} ${plural} — not enough of your own evidence to draw a conclusion.`;
  }
  return `Used ${input.uses} ${plural}, with ${input.outcomeEvidence} associated next-step outcome${
    input.outcomeEvidence === 1 ? "" : "s"
  } observed afterwards.`;
}
