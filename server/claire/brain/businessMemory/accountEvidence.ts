/**
 * Epistemic decomposition of an account.
 *
 * `loadAccountHistory` returns everything Goldline recorded about an account in one
 * structure. Most of it is HISTORY. Labelling the whole thing current truth is exactly
 * the mistake that lets "you visited in June" become "they're a customer now".
 *
 * So the structure is split at this boundary:
 *
 *   CURRENT     open follow-ups, pipeline stage, live mission state, scheduled
 *               commitments, account/contact identity
 *   HISTORICAL  visits, completed follow-ups, past outcomes, conversation mentions
 *
 * Each piece carries its own as-of time, so "as of when?" always has an answer.
 */

import type { AccountHistory } from "../../knowledge/accountKnowledge";
import type { EvidenceItem } from "../contracts/evidence";

function base(input: {
  id: string;
  type: EvidenceItem["type"];
  reader: string;
  observedAtIso: string;
  asOf: string;
  current: boolean;
  payload: unknown;
}): EvidenceItem {
  return {
    id: input.id,
    type: input.type,
    source: input.reader,
    provenance: { reader: input.reader },
    observedAt: input.observedAtIso,
    asOf: input.asOf,
    freshness: null,
    coverage: null,
    authoritativeFor: input.current ? ["current_business_truth"] : ["historical_observation"],
    payload: input.payload,
    operatorVisible: true,
  };
}

/**
 * Split one account's record into separately-stamped evidence.
 *
 * Coverage is deliberately marked incomplete on the historical side: the reader caps
 * what it returns, so "no visit on record" never licenses "they were never visited".
 */
export function evidenceFromAccountHistory(input: {
  history: AccountHistory;
  reader: string;
  observedAtIso: string;
}): EvidenceItem[] {
  const { history, reader, observedAtIso } = input;
  const accountId = history.account.id;
  const items: EvidenceItem[] = [];

  // ── Current ───────────────────────────────────────────────────────────────
  items.push(
    base({
      id: `account_state:${accountId}:identity`,
      type: "account_state",
      reader,
      observedAtIso,
      asOf: observedAtIso,
      current: true,
      payload: {
        accountId,
        name: history.account.name,
        accountType: history.account.accountType,
        contacts: history.contacts.filter(contact => contact.name),
      },
    })
  );

  if (history.pipelineStage) {
    items.push(
      base({
        id: `account_state:${accountId}:pipeline`,
        type: "account_state",
        reader,
        observedAtIso,
        asOf: observedAtIso,
        current: true,
        payload: { accountId, pipelineStage: history.pipelineStage, pipelineId: history.pipelineId },
      })
    );
  }

  const openFollowUps = history.followUps.filter(followUp => !followUp.completedAt);
  if (openFollowUps.length) {
    items.push(
      base({
        id: `account_state:${accountId}:open_follow_ups`,
        type: "account_state",
        reader,
        observedAtIso,
        asOf: observedAtIso,
        current: true,
        payload: { accountId, openTotal: openFollowUps.length, followUps: openFollowUps },
      })
    );
  }

  const liveMissions = history.missions.filter(
    mission => mission.status !== "completed" && mission.status !== "cancelled"
  );
  if (liveMissions.length) {
    items.push(
      base({
        id: `account_state:${accountId}:missions`,
        type: "account_state",
        reader,
        observedAtIso,
        asOf: observedAtIso,
        current: true,
        payload: { accountId, missions: liveMissions },
      })
    );
  }

  if (history.dayLineMentions.length) {
    const scheduled = history.dayLineMentions.filter(item => item.status !== "completed");
    if (scheduled.length) {
      items.push(
        base({
          id: `account_state:${accountId}:day_line`,
          type: "day_line_read",
          reader,
          observedAtIso,
          asOf: observedAtIso,
          current: true,
          payload: { accountId, scheduled },
        })
      );
    }
  }

  // ── Historical ────────────────────────────────────────────────────────────
  // Everything below describes what happened THEN. As-of is the event's own date.
  for (const visit of history.fieldVisits) {
    const at = visit.departedAt ?? visit.arrivedAt;
    if (!at) continue;
    items.push(
      base({
        id: `account_visit:${accountId}:${visit.missionId}`,
        type: "conversation_turn",
        reader,
        observedAtIso,
        asOf: at,
        current: false,
        payload: { accountId, kind: "field_visit", at, notes: visit.notes },
      })
    );
  }

  for (const outcome of history.outcomes) {
    items.push(
      base({
        id: `account_outcome:${accountId}:${outcome.missionId}`,
        type: "conversation_turn",
        reader,
        observedAtIso,
        asOf: outcome.createdAt,
        current: false,
        payload: {
          accountId,
          kind: "visit_outcome",
          outcome: outcome.outcome,
          notes: outcome.notes,
          at: outcome.createdAt,
        },
      })
    );
  }

  for (const mention of history.conversationMentions) {
    items.push(
      base({
        id: `conversation_turn:${mention.sessionId}:${mention.at}`,
        type: "conversation_turn",
        reader,
        observedAtIso,
        asOf: mention.at,
        current: false,
        payload: { accountId, speaker: mention.speaker, text: mention.text, at: mention.at },
      })
    );
  }

  const completedFollowUps = history.followUps.filter(followUp => followUp.completedAt);
  for (const followUp of completedFollowUps) {
    items.push(
      base({
        id: `account_follow_up:${accountId}:${followUp.id}`,
        type: "conversation_turn",
        reader,
        observedAtIso,
        asOf: followUp.completedAt as string,
        current: false,
        payload: { accountId, kind: "completed_follow_up", note: followUp.note, at: followUp.completedAt },
      })
    );
  }

  return items;
}
