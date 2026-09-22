import {
  COMMUNICATION_BUSINESS_OUTCOMES_STILL_NOT_IMPLIED,
  TRANSCRIPT_CANNOT_CREATE,
  UNVERIFIED_TRANSCRIPT_EVIDENCE,
  sentimentIsClaireRegard,
  transcriptCannotCreate,
  type TranscriptCandidateClass,
  type TranscriptCandidateEvidence,
  type TranscriptCannotCreate,
} from "@shared/twilioFuture";

export function classifyTranscriptCandidate(input: {
  evidenceClass: TranscriptCandidateClass;
  text: string;
  sentiment?: string | null;
}): TranscriptCandidateEvidence {
  if (sentimentIsClaireRegard(input.sentiment)) {
    throw new Error("conversation intelligence sentiment was treated as Claire regard");
  }
  return {
    kind: "transcript_candidate_evidence",
    status: UNVERIFIED_TRANSCRIPT_EVIDENCE,
    evidenceClass: input.evidenceClass,
    text: input.text,
    regard: null,
  };
}

export function promoteTranscriptCandidate(
  candidate: TranscriptCandidateEvidence
): { promoted: false; status: typeof UNVERIFIED_TRANSCRIPT_EVIDENCE; candidate: TranscriptCandidateEvidence } {
  return {
    promoted: false,
    status: UNVERIFIED_TRANSCRIPT_EVIDENCE,
    candidate: { ...candidate, status: UNVERIFIED_TRANSCRIPT_EVIDENCE, regard: null },
  };
}

export function authoritiesCreatedByTranscript(
  candidate: TranscriptCandidateEvidence
): readonly TranscriptCannotCreate[] {
  return TRANSCRIPT_CANNOT_CREATE.filter(authority => transcriptCannotCreate(candidate, authority));
}

export function businessOutcomesCreatedByTranscript(
  candidate: TranscriptCandidateEvidence
): readonly string[] {
  return COMMUNICATION_BUSINESS_OUTCOMES_STILL_NOT_IMPLIED.filter(outcome =>
    transcriptCannotCreate(candidate, outcome)
  );
}
