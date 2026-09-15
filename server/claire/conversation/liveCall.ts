import type { VoiceCommitmentTurnResult } from "../voiceCommitmentLoop";
import {
  linkRelatedAction,
  persistSpokenTurn,
} from "./ledgerService";
import { finishConversationAndMaybeAnalyze } from "./pipeline";

export async function safeClaireLedger(
  work: () => Promise<unknown>
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.warn("[ClaireLedger] failed", error);
  }
}

export async function persistOperatorAndClaire(input: {
  callSid?: string;
  claireConversationId?: string;
  operatorText?: string | null;
  claireText?: string | null;
}): Promise<void> {
  await safeClaireLedger(async () => {
    if (input.operatorText?.trim()) {
      await persistSpokenTurn({
        callSid: input.callSid,
        claireConversationId: input.claireConversationId,
        speaker: "OPERATOR",
        text: input.operatorText,
      });
    }
    if (input.claireText?.trim()) {
      await persistSpokenTurn({
        callSid: input.callSid,
        claireConversationId: input.claireConversationId,
        speaker: "CLAIRE",
        text: input.claireText,
      });
    }
  });
}

export async function linkClaireCallAction(input: {
  callSid?: string;
  claireConversationId?: string;
  turn: VoiceCommitmentTurnResult;
}): Promise<void> {
  const actionId =
    input.turn.kind === "accepted"
      ? input.turn.commitmentId
      : input.turn.kind === "updated"
        ? input.turn.commitmentId
        : null;
  if (!actionId) return;
  await safeClaireLedger(() =>
    linkRelatedAction({
      callSid: input.callSid,
      claireConversationId: input.claireConversationId,
      actionId,
    })
  );
}

export async function endClaireCallLedger(input: {
  callSid?: string;
  claireConversationId?: string;
  operatorText?: string | null;
  claireText?: string | null;
  reason: string;
}): Promise<void> {
  await persistOperatorAndClaire(input);
  void finishConversationAndMaybeAnalyze({
    callSid: input.callSid,
    claireConversationId: input.claireConversationId,
    reason: input.reason,
  }).catch(error => {
    console.warn("[ClaireLedger] post-call pipeline failed", error);
  });
}
