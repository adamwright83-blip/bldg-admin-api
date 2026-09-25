/**
 * Operator-scoped Brain V2 live cutover.
 *
 * V2 is the executive authority for the lanes it already owns: Day Line work
 * lifecycle and call control. Existing V1 code remains underneath as an action /
 * character adapter, not as the deciding brain. Unsupported lanes fail open to the
 * existing production path rather than pretending V2 owns capabilities it does not.
 */

import type { ClaireTurnResult } from "../../turn/claireTurn";
import type { WorkingMemorySource } from "../workingMemory/snapshot";
import type { ExecutiveActionGrant } from "../contracts/grants";
import { isAuthorizedProductionOperator } from "../businessMemory/sourceVisibility";
import {
  liveExecutiveDeps,
  type ShadowRetrievalContext,
} from "../shadow/observeShadowTurn";
import type { LiveRetrievalDeps } from "../executive/decide";
import {
  runClaireBrainTurn,
  type ClaireBrainTurnResult,
} from "../shadow/runClaireBrainTurn";

export type ClaireBrainV2LiveInput = {
  rawText: string;
  assembledText?: string;
  completeness?: "complete" | "incomplete" | "forced_flush";
  state: WorkingMemorySource;
  tenantId: string;
  operatorUserId: string;
  surface: "voice" | "text";
  conversationKey: string;
  live: ShadowRetrievalContext;
  /** Optional hermetic readers for tests; production uses the existing live readers. */
  liveDeps?: LiveRetrievalDeps;
  /**
   * Existing proven production action path. V2 grants permission; this adapter
   * performs the requested state/business mutation and returns its receipt-backed
   * Claire result.
   */
  executeLegacyAdapter: (
    grant: ExecutiveActionGrant
  ) => Promise<ClaireTurnResult>;
};

export type ClaireBrainV2LiveResult =
  | {
      active: false;
      reason:
        | "disabled"
        | "operator_not_authorized"
        | "error"
        | "outside_live_scope";
    }
  | {
      active: true;
      result: ClaireBrainTurnResult;
      adapterResult: ClaireTurnResult | null;
      actionClasses: ExecutiveActionGrant["actionClass"][];
      /**
       * Live V2 currently owns action lifecycle and call control. Other lanes stay
       * on the proven V1 path until their production adapters are complete.
       */
      handled: true;
    };

function enabled(env: NodeJS.ProcessEnv): boolean {
  const flag = env.CLAIRE_BRAIN_V2_LIVE;
  return flag === "1" || flag?.toLowerCase() === "true";
}

export function isClaireBrainV2LiveEnabled(input: {
  tenantId: string;
  operatorUserId: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!enabled(input.env ?? process.env)) return false;
  return isAuthorizedProductionOperator({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
  });
}

export async function runClaireBrainV2LiveTurn(
  input: ClaireBrainV2LiveInput,
  options: { env?: NodeJS.ProcessEnv } = {}
): Promise<ClaireBrainV2LiveResult> {
  const env = options.env ?? process.env;
  if (!enabled(env)) return { active: false, reason: "disabled" };
  if (
    !isAuthorizedProductionOperator({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
    })
  ) {
    return { active: false, reason: "operator_not_authorized" };
  }

  let adapterResult: ClaireTurnResult | null = null;
  let adapterPromise: Promise<ClaireTurnResult> | null = null;

  const execute = async (
    grant: ExecutiveActionGrant
  ): Promise<ClaireTurnResult> => {
    // One semantic operator turn can mint more than one grant. The underlying
    // legacy adapter must still run at most once.
    adapterPromise ??= input.executeLegacyAdapter(grant);
    adapterResult = await adapterPromise;
    return adapterResult;
  };

  try {
    const result = await runClaireBrainTurn({
      rawText: input.rawText,
      assembledText: input.assembledText,
      completeness: input.completeness,
      state: input.state,
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      surface: input.surface,
      conversationKey: input.conversationKey,
      executive: {
        ...liveExecutiveDeps(input.live, input.liveDeps),
        productionAuthority: true,
      },
      productionAuthority: true,
      actionExecutor: execute,
    });

    if (!result.productionAuthority) {
      throw new Error("Brain V2 live turn returned without production authority");
    }

    const actionClasses = result.decision.actionGrants.map(
      grant => grant.actionClass
    );

    const ownsActionLifecycle = actionClasses.length > 0;
    const ownsCallControl = result.candidateEndCall;

    if (!ownsActionLifecycle && !ownsCallControl) {
      return { active: false, reason: "outside_live_scope" };
    }

    return {
      active: true,
      result,
      adapterResult,
      actionClasses,
      handled: true,
    };
  } catch (error) {
    console.error("[ClaireBrainV2] live cutover turn failed", {
      event: "claire_brain_v2_live_failed",
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      surface: input.surface,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { active: false, reason: "error" };
  }
}
