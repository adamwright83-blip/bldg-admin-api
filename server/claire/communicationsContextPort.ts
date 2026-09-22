import type { TranscriptCandidateClass, TranscriptCandidateEvidence } from "@shared/twilioFuture";
import {
  communicationsEvidenceContainsBusinessOutcome,
  toCommunicationCandidateEvidence,
} from "../twilioPlatform/communicationEvidence";
import { listCommunicationReceiptsForOperator } from "../twilioPlatform/communicationReceipts";
import type { TwilioCommunicationReceipt } from "@shared/twilioPlatform";
import {
  classifyTranscriptCandidate,
  promoteTranscriptCandidate,
} from "../twilioPlatform/future/transcriptCandidate";

/**
 * Read-only Claire view of communications evidence and unverified transcript
 * candidates. This port has no writer. It does not derive Daily Command,
 * Weekly Mission, Narrator events, or any other business outcome.
 */

export type ClaireTranscriptCandidateInput =
  | TranscriptCandidateEvidence
  | {
      evidenceClass: TranscriptCandidateClass;
      text: string;
      sentiment?: string | null;
    };

export type ClaireCommunicationsContextPort = {
  readonly access: "read_only";
  readonly impliesBusinessOutcome: false;
  readonly evidence: readonly ReturnType<typeof toCommunicationCandidateEvidence>[number][];
  readonly transcriptCandidates: readonly TranscriptCandidateEvidence[];
};

function asUnverifiedCandidate(input: ClaireTranscriptCandidateInput): TranscriptCandidateEvidence {
  if ("kind" in input && input.kind === "transcript_candidate_evidence") {
    return promoteTranscriptCandidate(input).candidate;
  }
  return classifyTranscriptCandidate(input);
}

export function readClaireCommunicationsContext(input: {
  receipts?: readonly TwilioCommunicationReceipt[];
  transcriptCandidates?: readonly ClaireTranscriptCandidateInput[];
} = {}): ClaireCommunicationsContextPort {
  const evidence = Object.freeze(
    (input.receipts ?? []).flatMap(receipt => toCommunicationCandidateEvidence(receipt))
  );
  const transcriptCandidates = Object.freeze(
    (input.transcriptCandidates ?? []).map(asUnverifiedCandidate)
  );
  const port: ClaireCommunicationsContextPort = Object.freeze({
    access: "read_only",
    impliesBusinessOutcome: false,
    evidence,
    transcriptCandidates,
  });
  if (communicationsEvidenceContainsBusinessOutcome(port.evidence) !== null) {
    throw new Error("communications evidence included a business outcome");
  }
  return port;
}

export async function loadClaireCommunicationsContext(input: {
  tenantId: string;
  operatorUserId: string;
  transcriptCandidates?: readonly ClaireTranscriptCandidateInput[];
}): Promise<ClaireCommunicationsContextPort> {
  let receipts: TwilioCommunicationReceipt[] = [];
  try {
    receipts = await listCommunicationReceiptsForOperator({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
    });
  } catch (error) {
    console.warn(
      "[Claire] communications context unavailable",
      error instanceof Error ? error.name : "error"
    );
    receipts = [];
  }
  return readClaireCommunicationsContext({
    receipts,
    transcriptCandidates: input.transcriptCandidates,
  });
}
