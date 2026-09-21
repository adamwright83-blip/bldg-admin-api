/**
 * Read-only Brain V2 entrypoint. Must never speak to the operator or mutate production.
 */

import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { ShadowComparisonRecord } from "../telemetry/comparison";
import { decideTurn, type ExecutiveDeps } from "../executive/decide";
import { perceiveTurn } from "../perception/perceive";
import { looksUnfinished } from "../../turn/claireTurn";
import { assertRenderedFromPlan, renderWithCharacter } from "../response/characterRenderer";
import { comparisonRecordFromDecision } from "../telemetry/comparison";
import { snapshotWorkingMemory, type WorkingMemorySource } from "../workingMemory/snapshot";
import { executeGrantedAction } from "../actions/gateway";

export type ClaireBrainTurnInput = {
  rawText: string;
  assembledText?: string;
  completeness?: "complete" | "incomplete" | "forced_flush";
  state?: WorkingMemorySource;
  tenantId: string;
  operatorUserId: string;
  surface: "voice" | "text";
  conversationKey: string;
  /** Retrieval defaults to retrieving nothing; live reads must be passed in explicitly. */
  executive?: ExecutiveDeps;
};

export type ClaireBrainTurnResult = {
  decision: ExecutiveDecision;
  candidateSpeak: string;
  candidateEndCall: boolean;
  comparison: ShadowComparisonRecord;
  mutations: [];
  productionAuthority: false;
};

export async function runClaireBrainTurn(input: ClaireBrainTurnInput): Promise<ClaireBrainTurnResult> {
  const assembled = (input.assembledText ?? input.rawText).trim();
  let completeness = input.completeness ?? "complete";
  // V2 owns complete-thought assembly. V1's listenOnly label informs, but an unfinished
  // form is never reasoned over as a finished question just because transport flushed it.
  if (completeness === "complete" && looksUnfinished(assembled)) {
    completeness = "incomplete";
  }
  const perceived = perceiveTurn({
    rawText: input.rawText,
    assembledText: input.assembledText,
    completeness,
  });
  const memory = snapshotWorkingMemory(input.state ?? {}, {
    conversationKey: input.conversationKey,
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    surface: input.surface,
  });
  const decision = await decideTurn(perceived, memory, input.executive);
  const rendered = renderWithCharacter(decision.responsePlan, { surface: input.surface });
  // The renderer phrases; it may not think. Reject anything it added on its own.
  assertRenderedFromPlan(decision.responsePlan, rendered.speak);

  for (const grant of decision.actionGrants) {
    const result = await executeGrantedAction(grant);
    if (result.executed) {
      throw new Error("Brain V2 shadow runner must not execute mutations");
    }
  }

  return {
    decision,
    candidateSpeak: rendered.speak,
    candidateEndCall: rendered.endCall,
    comparison: comparisonRecordFromDecision(input.conversationKey, decision),
    mutations: [],
    productionAuthority: false,
  };
}
