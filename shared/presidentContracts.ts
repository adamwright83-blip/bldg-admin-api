export const PRESIDENT_SEAT = "seat.president" as const;
export const PRESIDENT_STAGE_1_RESULT = "WAITING_FOR_HUMAN_SELECTION" as const;
export type PresidentEvidenceKind = "FACT" | "INFERENCE" | "UNKNOWN";
export interface PresidentEvidenceClaim {
  kind: PresidentEvidenceKind;
  sourceId: string;
  sourceLocation: string;
  statement: string;
  verified: boolean;
}
export interface PresidentCandidateProject {
  id: string;
  assessmentId: string;
  title: string;
  missingCapability: string;
  currentGap: string;
  proposedBuild: string;
  resultingCapability: string;
  rank: number;
  rankReason: string;
  evidence: PresidentEvidenceClaim[];
  blockers: string[];
  humanDecisionDependency: string | null;
  status: "PROPOSED_AWAITING_HUMAN_SELECTION";
}
export interface PresidentAssessment {
  id: string;
  seat: typeof PRESIDENT_SEAT;
  inspectedRepositorySha: string;
  evidenceSnapshotId: string;
  status: "COMPLETED";
  resultState: typeof PRESIDENT_STAGE_1_RESULT;
  evidenceSourcesAvailable: string[];
  evidenceSourcesUnavailable: string[];
  startedAt: string;
  completedAt: string;
  provider: string;
  model: string;
  candidates: PresidentCandidateProject[];
  executionCount: 0;
}
export interface PresidentEvidenceSnapshot {
  id: string;
  repositorySha: string;
  availableSources: string[];
  unavailableSources: string[];
  sourceDigests: Record<string, string>;
  sourceContents: Record<string, string>;
}

/** Fail closed on fabricated execution claims or silently stripped provenance. */
export function assertPresidentStage1Assessment(a: PresidentAssessment): void {
  if (
    a.seat !== PRESIDENT_SEAT ||
    a.resultState !== PRESIDENT_STAGE_1_RESULT ||
    a.status !== "COMPLETED" ||
    a.executionCount !== 0
  )
    throw new Error(
      "Only a completed Stage 1 menu with zero execution can be stored"
    );
  for (const key of [
    "execution",
    "executionResults",
    "workOrders",
    "preflight",
    "reviews",
    "internalCandidates",
  ])
    if (key in a)
      throw new Error("Later-stage President state cannot be stored");
  for (const c of a.candidates) {
    if (
      c.assessmentId !== a.id ||
      c.status !== "PROPOSED_AWAITING_HUMAN_SELECTION" ||
      !c.evidence.some(e => e.kind === "FACT") ||
      !c.evidence.some(e => e.kind === "INFERENCE")
    )
      throw new Error("Candidate lacks Stage 1 identity or provenance");
    for (const e of c.evidence)
      if (
        !["FACT", "INFERENCE", "UNKNOWN"].includes(e.kind) ||
        !e.sourceId ||
        !e.sourceLocation ||
        !e.statement ||
        (e.kind === "UNKNOWN" && e.verified)
      )
        throw new Error("Invalid President evidence distinction");
  }
}
