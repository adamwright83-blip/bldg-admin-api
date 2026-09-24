import type { VoiceCommitmentTurnResult } from "../voiceCommitmentLoop";
import {
  linkRelatedAction,
  persistSpokenTurn,
} from "./ledgerService";
import { finishConversationAndMaybeAnalyze } from "./pipeline";
import { emitClaireTranscriptTurnLog } from "./transcriptLog";

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
  /** The live conversation's turn number, so identical replies on different turns are all kept. */
  turnKey?: string | number | null;
  operatorMetadata?: Record<string, unknown> | null;
  claireMetadata?: Record<string, unknown> | null;
}): Promise<void> {
  await safeClaireLedger(async () => {
    const persisted = [];
    if (input.operatorText?.trim()) {
      const turn = await persistSpokenTurn({
        callSid: input.callSid,
        claireConversationId: input.claireConversationId,
        speaker: "OPERATOR",
        text: input.operatorText,
        turnKey: input.turnKey,
        providerMetadata: input.operatorMetadata ?? null,
      });
      if (turn) persisted.push(turn);
    }
    if (input.claireText?.trim()) {
      const turn = await persistSpokenTurn({
        callSid: input.callSid,
        claireConversationId: input.claireConversationId,
        speaker: "CLAIRE",
        text: input.claireText,
        turnKey: input.turnKey,
        providerMetadata: input.claireMetadata ?? null,
      });
      if (turn) persisted.push(turn);
    }

    // Relay does not have to finalize before its transcript is inspectable.
    for (const turn of persisted) {
      await emitClaireTranscriptTurnLog(turn);
    }
  });
}

/** Links every Day Line / pipeline record a Claire turn wrote to the call. */
export async function linkClaireActionIds(input: {
  callSid?: string;
  claireConversationId?: string;
  actionIds: string[];
}): Promise<void> {
  for (const actionId of input.actionIds) {
    if (!actionId) continue;
    await safeClaireLedger(() =>
      linkRelatedAction({ callSid: input.callSid, claireConversationId: input.claireConversationId, actionId })
    );
  }
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
