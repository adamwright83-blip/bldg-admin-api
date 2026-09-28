export type ExecutionIntelligenceObjectiveRef = {
  objectiveId: string;
  workFamily?: string | null;
  executionType?: "mission" | "challenge" | "hybrid_objective" | null;
};

export type ExecutionIntelligenceProvenance = {
  sourceType: string;
  sourceArtifactId: string;
  transcriptId: string;
  transcriptStartMs: number | null;
  transcriptEndMs: number | null;
};

export type ExecutionIntelligenceItem = {
  /** Stable technique identity; never a row-version id. */
  key: string;
  version: number;
  doctrineFamily: string;
  title: string;
  principle: string;
  sourceProvenance: ExecutionIntelligenceProvenance;
  applicability: {
    whenToUse: readonly string[];
    whenNotToUse: readonly string[];
    reason: string;
  };
};

export type ExecutionIntelligenceSelectionInput = {
  tenantId: string;
  objectiveRef: ExecutionIntelligenceObjectiveRef;
  context: unknown;
  limit: number;
};
