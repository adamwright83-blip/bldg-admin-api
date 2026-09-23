/**
 * Transport facts from the merged call bridge are not business outcomes.
 * spoke and visit_booked still require this attempt's prospect leg to have
 * connected. Duration and CALL_COMPLETED do not.
 */
import {
  isConnectedConversationOutcome,
  prospectLegConnected,
  type ProspectLegReceiptFact,
} from "../../shared/coldCallBurst";

export type RookContactAttemptReceipt = ProspectLegReceiptFact & {
  attemptId: number;
};

export type RookContactTransportRead = {
  attemptId: number;
  durationSeconds: number | null;
  attemptStatus: string | null;
  spoke: boolean;
  visitBooked: boolean;
  /** True only for a connected conversation on this attempt. Duration is not this. */
  businessSuccess: boolean;
};

export function evaluateRookContactTransport(input: {
  tenantId: string;
  attemptId: number;
  attemptStatus: string | null;
  durationSeconds?: number | null;
  repLegCallSid: string | null;
  customerLegCallSid: string | null;
  receipts: readonly RookContactAttemptReceipt[];
  proposedOutcome?: string | null;
}): RookContactTransportRead {
  const ownReceipts = input.receipts.filter(receipt => receipt.attemptId === input.attemptId);
  const connected = prospectLegConnected({
    tenantId: input.tenantId,
    attemptStatus: input.attemptStatus,
    repLegCallSid: input.repLegCallSid,
    customerLegCallSid: input.customerLegCallSid,
    receipts: ownReceipts,
  });
  const proposed = input.proposedOutcome ?? null;
  const connectedClaim = connected && proposed != null && isConnectedConversationOutcome(proposed);
  return {
    attemptId: input.attemptId,
    durationSeconds: input.durationSeconds ?? null,
    attemptStatus: input.attemptStatus,
    spoke: connectedClaim && proposed === "spoke",
    visitBooked: connectedClaim && proposed === "visit_booked",
    businessSuccess: connectedClaim,
  };
}
