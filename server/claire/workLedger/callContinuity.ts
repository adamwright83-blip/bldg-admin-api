/**
 * Facts about the calls just before this one, so Claire never tells the
 * operator "that wasn't me — I don't make outbound calls" seconds after her
 * own scheduled debrief dropped (production, 2026-10-15 17:30 PT).
 *
 * Session timestamps are compared with each other only: the stored values are
 * shifted by the same local-time offset, so differences are correct even
 * where absolute values are not.
 */
import { loadRecentClaireSessionsAround } from "../conversation/conversationQuery";

const LOOKBACK_MS = 30 * 60 * 1_000;

const KIND_LABEL: Record<string, string> = {
  evening_debrief: "scheduled evening debrief call",
  morning_readiness: "scheduled morning call",
  evening_planning: "scheduled evening planning call",
  morning_reconciliation: "scheduled morning call",
  weekly_planning_invite: "scheduled weekly planning call",
  weekly_planning: "scheduled weekly planning call",
  pre_drive: "call",
  field_debrief: "field debrief call",
};

export type PriorCallSummary = {
  conversationKind: string;
  completionReason: string | null;
  secondsBeforeThisCall: number;
  durationSeconds: number | null;
  claireOpening: string | null;
  operatorSpoke: boolean;
  outbound: boolean;
};

export function describePriorCalls(calls: PriorCallSummary[]): string[] {
  return calls.map(call => {
    const label = KIND_LABEL[call.conversationKind] ?? "call";
    const when =
      call.secondsBeforeThisCall < 90
        ? "Moments before this call"
        : `About ${Math.round(call.secondsBeforeThisCall / 60)} minutes before this call`;
    if (call.completionReason === "call_create_failed") {
      return `${when}, Claire tried to place the ${label} but it could not be placed; the operator never heard it.`;
    }
    const direction = call.outbound ? `Claire called the operator for the ${label}` : `the operator called Claire`;
    const ended =
      call.durationSeconds != null
        ? `it ended after ${call.durationSeconds} seconds${call.completionReason ? ` (${call.completionReason.replace(/_/g, " ")})` : ""}`
        : "it ended";
    const spoke = call.operatorSpoke ? "" : " before the operator said anything";
    const opening = call.claireOpening ? ` Claire's opening was: "${call.claireOpening.slice(0, 200)}"` : "";
    const ownIt = call.outbound
      ? " If the operator mentions Claire calling and hanging up, that was this call: own it plainly and pick up where it should have gone. Never deny making calls."
      : "";
    return `${when}, ${direction}; ${ended}${spoke}.${opening}${ownIt}`;
  });
}

const OUTBOUND_KINDS = new Set([
  "evening_debrief",
  "morning_readiness",
  "evening_planning",
  "morning_reconciliation",
  "weekly_planning_invite",
  "weekly_planning",
]);

export async function loadPriorCallFacts(input: {
  tenantId: string;
  operatorUserId: string;
  claireConversationId: string;
}): Promise<string[]> {
  const { current, prior } = await loadRecentClaireSessionsAround(input);
  if (!current) return [];
  const currentStart = current.startedAt.getTime();
  const summaries: PriorCallSummary[] = prior
    .filter(session => currentStart - session.startedAt.getTime() <= LOOKBACK_MS)
    .slice(0, 2)
    .map(session => {
      const spoken = session.turns.filter(turn => !/post_call/i.test(turn.source));
      return {
        conversationKind: session.conversationKind,
        completionReason: session.completionReason,
        secondsBeforeThisCall: Math.max(0, Math.round((currentStart - session.startedAt.getTime()) / 1_000)),
        durationSeconds: session.endedAt ? Math.max(0, Math.round((session.endedAt.getTime() - session.startedAt.getTime()) / 1_000)) : null,
        claireOpening: spoken.find(turn => turn.speaker.toUpperCase() === "CLAIRE")?.text ?? null,
        operatorSpoke: spoken.some(turn => turn.speaker.toUpperCase() === "OPERATOR"),
        outbound: OUTBOUND_KINDS.has(session.conversationKind),
      };
    });
  return describePriorCalls(summaries);
}
