/**
 * Brain V2 turn runner.
 *
 * Shadow remains the default. Production authority must be injected explicitly by
 * the live cutover orchestrator together with an Action Gateway executor.
 */

import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { ShadowComparisonRecord } from "../telemetry/comparison";
import { decideTurn, type ExecutiveDeps } from "../executive/decide";
import { perceiveTurn } from "../perception/perceive";
import { looksUnfinished } from "../../turn/claireTurn";
import { assertRenderedFromPlan, renderWithCharacter } from "../response/characterRenderer";
import { comparisonRecordFromDecision } from "../telemetry/comparison";
import { snapshotWorkingMemory, type WorkingMemorySource } from "../workingMemory/snapshot";
import {
  executeGrantedAction,
  type ActionGatewayResult,
  type LiveActionExecutor,
} from "../actions/gateway";

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
  /** Default false. Only the operator-scoped live cutover sets this true. */
  productionAuthority?: boolean;
  /** Required when a live decision mints an executable action grant. */
  actionExecutor?: LiveActionExecutor;
};

export type ClaireBrainTurnResult = {
  decision: ExecutiveDecision;
  candidateSpeak: string;
  candidateEndCall: boolean;
  comparison: ShadowComparisonRecord;
  mutations: ActionGatewayResult[];
  productionAuthority: boolean;
};

export async function runClaireBrainTurn(input: ClaireBrainTurnInput): Promise<ClaireBrainTurnResult> {
  const assembled = (input.assembledText ?? input.rawText).trim();
  let completeness = input.completeness ?? "complete";
  // Voice owns complete-thought assembly: V1's listenOnly label informs, but an
  // unfinished spoken form is never reasoned over just because transport flushed it.
  // A forced flush is the exception — V1 already released that exact text, so V2
  // must reason over the same assembled utterance rather than re-holding it.
  // Desk text has no fragment assembler yet, so punctuationless typed questions
  // ("Tell me where my order is") must not inherit the voice-ending heuristic.
  if (
    input.surface === "voice" &&
    completeness === "complete" &&
    looksUnfinished(assembled)
  ) {
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
  const decision = await decideTurn(perceived, memory, {
    ...(input.executive ?? { retrieve: async () => [], ctx: { timeZone: "UTC", today: new Date().toISOString().slice(0, 10), surface: input.surface } }),
    productionAuthority: input.productionAuthority === true,
  });
  const rendered = renderWithCharacter(decision.responsePlan, { surface: input.surface });
  // The renderer phrases; it may not think. Reject anything it added on its own.
  assertRenderedFromPlan(decision.responsePlan, rendered.speak);

  const mutations: ActionGatewayResult[] = [];
  for (const grant of decision.actionGrants) {
    const result = await executeGrantedAction(grant, {
      execute: input.productionAuthority ? input.actionExecutor : undefined,
    });
    if (!input.productionAuthority && result.executed) {
      throw new Error("Brain V2 shadow runner must not execute mutations");
    }
    mutations.push(result);
  }

  return {
    decision,
    candidateSpeak: rendered.speak,
    candidateEndCall: rendered.endCall,
    comparison: comparisonRecordFromDecision(input.conversationKey, decision),
    mutations,
    productionAuthority: decision.productionAuthority,
  };
}
