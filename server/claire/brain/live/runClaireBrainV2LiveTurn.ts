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
import {
  actionGrantSourceIsBackground,
  type ActionAuthorityBasis,
  type ActionClass,
  type ActionGrantSource,
  type ExecutiveActionGrant,
} from "../contracts/grants";
import { executeGrantedAction } from "../actions/gateway";
import { mintActionGrant } from "../executive/grants";
import {
  evaluatePersistentActionPolicy,
  type ToolRiskClass,
} from "../../../persistentOperator/actionPolicy";
import type { CanonicalOperatorIdentity } from "../../../persistentOperator/identity";
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
        | "execution_error"
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

export function shouldFallbackToClaireLegacy(
  result: ClaireBrainV2LiveResult
): boolean {
  if (result.active) return false;
  return result.reason !== "execution_error";
}

const UNPROVEN_DAY_LINE_WRITE_SPEECH =
  "I understood the Day Line request, but I don't have a write receipt yet, so I can't confirm a change. I'm keeping those items in mind.";

function hasDayLineWriteEvidence(result: ClaireTurnResult): boolean {
  return Boolean(result.actionIds?.length || result.mutationReceipts?.length);
}

function guardCommittedDayLineResult(
  grant: ExecutiveActionGrant,
  result: ClaireTurnResult
): ClaireTurnResult {
  if (grant.actionClass !== "commit_day_line" && grant.actionClass !== "commit_briefing") return result;
  if (hasDayLineWriteEvidence(result)) return result;

  // A truthful explicit-commit failure already carries its own receipt-backed
  // failure sentence ("nothing saved", "nothing new needed saving"). Keep it.
  if (result.kind === "briefing_saved" && result.receiptBackedCommit) return result;

  // Live V2 may grant the write, but the legacy organ still has to return
  // durable evidence that something was written (or already existed). Never
  // allow a conversational acknowledgement to masquerade as a successful write.
  return {
    ...result,
    speak: UNPROVEN_DAY_LINE_WRITE_SPEECH,
    receiptBackedCommit: undefined,
    mutationReceipts: undefined,
    actionIds: [],
  };
}

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
  let adapterExecutionStarted = false;

  const execute = async (
    grant: ExecutiveActionGrant
  ): Promise<ClaireTurnResult> => {
    // One semantic operator turn can mint more than one grant. The underlying
    // grant-bound adapter must still run at most once.
    if (!adapterPromise) {
      adapterExecutionStarted = true;
      adapterPromise = input.executeLegacyAdapter(grant);
    }
    const rawAdapterResult = await adapterPromise;
    adapterResult = guardCommittedDayLineResult(grant, rawAdapterResult);
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
    return {
      active: false,
      reason: adapterExecutionStarted ? "execution_error" : "error",
    };
  }
}


export async function executePersistentOperatorAction<T>(input: {
  identity: CanonicalOperatorIdentity;
  actionClass: ActionClass;
  authorityBasis: ActionAuthorityBasis;
  source: Exclude<ActionGrantSource, { type: "operator_turn" }>;
  riskClass: ToolRiskClass;
  exactAction: string;
  standingAuthorizationId?: string | null;
  approvedByUserId?: string | null;
  expiresAtMs: number;
  scope?: ExecutiveActionGrant["scope"];
  execute: (grant: ExecutiveActionGrant) => Promise<T>;
}) {
  if (!actionGrantSourceIsBackground(input.source)) {
    throw new Error("Persistent operator action requires a background authority source");
  }
  if (
    input.source.tenantId !== input.identity.tenantId ||
    input.source.canonicalOperatorId !== input.identity.canonicalOperatorId
  ) {
    throw new Error("Persistent operator authority source identity mismatch");
  }

  const policy = await evaluatePersistentActionPolicy({
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    exactAction: input.exactAction,
    riskClass: input.riskClass,
    standingAuthorizationId: input.standingAuthorizationId,
    approvedByUserId: input.approvedByUserId,
  });
  if (!policy.allowed) {
    throw new Error(`Persistent action policy denied: ${policy.reason}`);
  }

  const grant = mintActionGrant({
    actionClass: input.actionClass,
    scope: input.scope ?? { identity: input.identity.canonicalOpenId },
    authorityBasis: input.authorityBasis,
    sourceTurnAssembledText: "",
    source: input.source,
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    expiresAtMs: input.expiresAtMs,
    constraints: {
      mutationAllowed: true,
      shadowOnly: false,
    },
  });

  return executeGrantedAction(grant, { execute: input.execute });
}
