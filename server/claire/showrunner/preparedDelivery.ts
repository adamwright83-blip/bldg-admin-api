/**
 * Consuming a promise only once it has been delivered.
 *
 * A scheduled call's opening may speak one prepared item ("Last night I said I'd have the open
 * property visits ready: … Which one do you want first?"). Placing the call is not delivering it:
 * an unanswered call, a failed dial, voicemail, or a hangup before anyone speaks must leave the
 * item prepared so the next call can still keep the promise.
 *
 * The evidence used is the first authoritative OPERATOR utterance on that call that is not a
 * voicemail greeting or menu (the voice turn handler rejects those before calling this). A person
 * answered and heard the opening. Exactly the ids the dialer recorded as spoken are consumed, and
 * the store's write is conditional on status = 'prepared', so duplicate webhooks and retries are
 * harmless. A failed write leaves `consumedAt` null and the next operator turn tries again.
 */
import { drizzlePreparedItemStore, type PreparedItemStore } from "../../agents/persistentOperator/preparedItems";
import type { ShowrunnerCallState } from "./showrunnerTurn";

export type PreparedDeliveryResult = "consumed" | "already_consumed" | "nothing_offered" | "no_operator_speech" | "write_failed";

export async function consumeDeliveredPreparedItems(input: {
  showrunner: Pick<ShowrunnerCallState, "tenantId" | "canonicalOperatorId" | "preparedOffered"> | null | undefined;
  conversationKey: string;
  /** The operator's utterance on this turn, already known not to be voicemail. */
  operatorUtterance: string;
  /** False when the provider marked the transcript unconfirmed. */
  sourceConfirmed?: boolean;
  now?: Date;
  store?: PreparedItemStore;
}): Promise<PreparedDeliveryResult> {
  const offered = input.showrunner?.preparedOffered;
  if (!input.showrunner || !offered?.ids.length) return "nothing_offered";
  if (offered.consumedAt) return "already_consumed";
  if (!input.operatorUtterance.trim() || input.sourceConfirmed === false) return "no_operator_speech";
  try {
    await (input.store ?? drizzlePreparedItemStore()).markConsumed(
      { tenantId: input.showrunner.tenantId, canonicalOperatorId: input.showrunner.canonicalOperatorId },
      offered.ids,
      input.conversationKey
    );
  } catch (error) {
    console.warn("[Claire] prepared item not consumed; will retry on the next operator turn", error instanceof Error ? error.message : error);
    return "write_failed";
  }
  offered.consumedAt = (input.now ?? new Date()).toISOString();
  return "consumed";
}
