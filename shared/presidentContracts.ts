export const PRESIDENT_SEAT = "seat.president" as const;
export const PRESIDENT_STAGE_1_RESULT = "WAITING_FOR_HUMAN_SELECTION" as const;
export type PresidentEvidenceKind = "FACT" | "INFERENCE" | "UNKNOWN";
export interface PresidentEvidenceClaim { kind: PresidentEvidenceKind; sourceId: string; sourceLocation: string; statement: string; verified: boolean }
export interface PresidentCandidateProject {
  id: string; assessmentId: string; title: string; missingCapability: string; currentGap: string;
  proposedBuild: string; resultingCapability: string; rank: number; rankReason: string;
  evidence: PresidentEvidenceClaim[]; blockers: string[]; humanDecisionDependency: string | null;
  status: "PROPOSED_AWAITING_HUMAN_SELECTION";
}
export interface PresidentAssessment {
  id: string; seat: typeof PRESIDENT_SEAT; inspectedRepositorySha: string; evidenceSnapshotId: string;
  status: "COMPLETED"; resultState: typeof PRESIDENT_STAGE_1_RESULT; evidenceSourcesAvailable: string[];
  evidenceSourcesUnavailable: string[]; startedAt: string; completedAt: string; provider: string; model: string;
  candidates: PresidentCandidateProject[]; executionCount: 0;
}
export interface PresidentEvidenceSnapshot { id: string; repositorySha: string; availableSources: string[]; unavailableSources: string[]; sourceDigests: Record<string, string> }
