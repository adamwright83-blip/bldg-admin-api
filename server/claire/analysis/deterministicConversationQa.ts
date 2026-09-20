import type { ConversationTurn } from "../conversation/types";
import { hasNonProductionProvenance } from "../knowledge/productionVisibility";
import { detectCallControl, interpretTurn, isPureCallControlTurn, parseCardinality } from "../turn/interpretTurn";

export type DeterministicQaFinding = {
  category: string;
  summary: string;
  turnOrdinal: number | null;
  severity: "low" | "medium" | "high";
};

function nextClaire(turns: ConversationTurn[], index: number): ConversationTurn | null {
  for (let i = index + 1; i < turns.length; i += 1) {
    const turn = turns[i]!;
    if (turn.speaker === "CLAIRE") return turn;
    if (turn.speaker === "OPERATOR") return null;
  }
  return null;
}

/**
 * Deterministic post-call invariant checks. These are deliberately narrow:
 * they flag structural failures we can prove from the transcript without an LLM.
 * They never mutate business truth or action state.
 */
export function deterministicConversationQa(turns: ConversationTurn[]): DeterministicQaFinding[] {
  const findings: DeterministicQaFinding[] = [];
  let refusalSeenAt: number | null = null;

  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index]!;
    if (turn.speaker === "CLAIRE") {
      if (hasNonProductionProvenance({ note: turn.text })) {
        findings.push({
          category: "synthetic_artifact_leak",
          summary: "Claire exposed text carrying synthetic/test provenance in a production conversation.",
          turnOrdinal: turn.ordinal,
          severity: "high",
        });
      }
      if (
        refusalSeenAt != null &&
        /\b(?:still holding|say yes|want me to put|put .* on the day\s*line)\b/i.test(turn.text)
      ) {
        findings.push({
          category: "cleared_proposal_reappeared",
          summary: "A proposal resurfaced after the operator explicitly refused it.",
          turnOrdinal: turn.ordinal,
          severity: "high",
        });
      }
      continue;
    }

    const interpreted = interpretTurn(turn.text);
    const reply = nextClaire(turns, index);

    if (interpreted.actionRefused) refusalSeenAt = turn.ordinal;

    if (
      interpreted.acknowledgement &&
      reply &&
      /\b(?:can'?t|cannot|unable to)\s+verify\b|\bverify that properly\b/i.test(reply.text)
    ) {
      findings.push({
        category: "acknowledgement_misrouted",
        summary: "A conversational acknowledgement was routed as a factual verification problem.",
        turnOrdinal: reply.ordinal,
        severity: "high",
      });
    }

    const requested = parseCardinality(turn.text);
    if (
      requested != null &&
      requested > 1 &&
      /\b(?:last|latest|recent|previous|other|first)\b/i.test(turn.text) &&
      reply &&
      /\b(?:the|your) (?:latest|last|most recent) (?:paid )?(?:sale|order)\b/i.test(reply.text) &&
      !new RegExp(`\\b${requested}\\b`).test(reply.text)
    ) {
      findings.push({
        category: "list_cardinality_collapsed",
        summary: `Operator requested ${requested} records but Claire answered in singular latest-record form.`,
        turnOrdinal: reply.ordinal,
        severity: "high",
      });
    }

    if (
      interpreted.actionRefused &&
      reply &&
      /\bwant me to (?:put|add)|\bon the day\s*line\b/i.test(reply.text)
    ) {
      findings.push({
        category: "refusal_became_action_proposal",
        summary: "An explicit action refusal was followed by a Day Line proposal.",
        turnOrdinal: reply.ordinal,
        severity: "high",
      });
    }

    if (
      interpreted.businessJudgment &&
      reply &&
      /\b(?:gumball|synthetic verification|mission\s+\d+)\b/i.test(reply.text) &&
      !/\b(?:gumball|mission)\b/i.test(turn.text)
    ) {
      findings.push({
        category: "targeted_question_route_contamination",
        summary: "A scoped business-judgment question received unrelated global operating-board content.",
        turnOrdinal: reply.ordinal,
        severity: "high",
      });
    }

    if (
      interpreted.correctnessChallenge &&
      reply &&
      /\b(?:came from|receipt|grounded|wording was my own)\b/i.test(reply.text) &&
      !/\b(?:checked|rechecked|checked again|current ledger|current record|reread)\b/i.test(reply.text)
    ) {
      findings.push({
        category: "correctness_challenge_without_reread",
        summary: "A correctness challenge was answered with provenance language but no evidence of a fresh reread.",
        turnOrdinal: reply.ordinal,
        severity: "high",
      });
    }

    if (detectCallControl(turn.text) === "end" && isPureCallControlTurn(turn.text)) {
      const laterOperator = turns.slice(index + 1).find(candidate => candidate.speaker === "OPERATOR");
      if (laterOperator) {
        findings.push({
          category: "call_end_not_honored",
          summary: "A pure operator leave-taking was followed by another operator turn in the same call.",
          turnOrdinal: laterOperator.ordinal,
          severity: "high",
        });
      }
    }
  }

  return findings.filter(
    (finding, index, all) =>
      all.findIndex(
        candidate =>
          candidate.category === finding.category &&
          candidate.turnOrdinal === finding.turnOrdinal
      ) === index
  );
}
