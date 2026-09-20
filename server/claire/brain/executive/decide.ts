/**
 * The executive loop. Exactly one ExecutiveDecision per completed turn.
 *
 *   Perception → Attention → Retrieval → Integration → Inhibition → Authority → Decision
 *
 * No downstream subsystem selects a top-level intent, and nothing here mutates.
 *
 * Retrieval is INJECTED and defaults to retrieving nothing. Reading production data is
 * an explicit act: a caller that wants live reads must pass `liveReadOnlyRetrieval`.
 * That keeps every existing caller — and every test — hermetic by construction, and
 * means no code path can quietly reach the database just by calling the brain.
 */

import type { ExecutiveDecision, InhibitedCandidate } from "../contracts/executiveDecision";
import type { EvidenceItem } from "../contracts/evidence";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { ResponseSegment } from "../contracts/responsePlan";
import type { RetrievalRequest, RetrievalResult } from "../contracts/retrieval";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";
import { planAttention } from "./attention";
import { planRetrieval } from "./retrievalPlan";
import { integrate, type IntegrationContext } from "./integrate";
import { mintActionGrant, mintCallControlGrant } from "./grants";
import { assertGovernedDecision } from "./governor";
import {
  defaultBusinessMemoryDeps,
  retrieveBusinessEvidence,
  type BusinessMemoryContext,
  type BusinessMemoryDeps,
} from "../businessMemory/adapter";
import {
  defaultEpisodicMemoryDeps,
  retrieveEpisodicEvidence,
  type EpisodicMemoryContext,
  type EpisodicMemoryDeps,
} from "../episodicMemory/adapter";
import { noSelfMemory, retrieveSelfEvidence, type SelfMemoryContext, type SelfMemoryDeps } from "../selfMemory/adapter";
import { noGoals, retrieveGoalEvidence, type GoalsContext, type GoalsDeps } from "../goals/adapter";

/** One function per compartment. Each returns evidence; none decides anything. */
export type RetrievalRunner = (request: RetrievalRequest) => Promise<EvidenceItem[]>;

export type ExecutiveDeps = {
  retrieve: RetrievalRunner;
  ctx: IntegrationContext;
};

/** Retrieves nothing. Honest default: we have not looked, so we must not assert. */
export const noRetrieval: RetrievalRunner = async () => [];

export const defaultExecutiveDeps: ExecutiveDeps = {
  retrieve: noRetrieval,
  ctx: { timeZone: "America/Los_Angeles", today: new Date().toISOString().slice(0, 10), surface: "voice" },
};

export type LiveRetrievalContext = {
  business: BusinessMemoryContext;
  episodic?: EpisodicMemoryContext;
  self?: SelfMemoryContext;
  goals?: GoalsContext;
};

export type LiveRetrievalDeps = {
  business?: BusinessMemoryDeps;
  episodic?: EpisodicMemoryDeps;
  self?: SelfMemoryDeps;
  goals?: GoalsDeps;
};

/**
 * Live, READ-ONLY retrieval against the existing authoritative readers.
 *
 * Nothing in this phase wires it into a production entrypoint. A compartment with no
 * context supplied simply returns nothing: an unconfigured compartment must stay silent
 * rather than fall back to some default that reads more than the caller intended.
 */
export function liveReadOnlyRetrieval(
  ctx: LiveRetrievalContext | BusinessMemoryContext,
  deps: LiveRetrievalDeps | BusinessMemoryDeps = {}
): RetrievalRunner {
  const live: LiveRetrievalContext = "business" in ctx ? ctx : { business: ctx as BusinessMemoryContext };
  const wired: LiveRetrievalDeps = "runQuery" in deps ? { business: deps as BusinessMemoryDeps } : (deps as LiveRetrievalDeps);

  return async request => {
    switch (request.compartment) {
      case "businessMemory":
        return retrieveBusinessEvidence(request, live.business, wired.business ?? defaultBusinessMemoryDeps);
      case "episodicMemory":
        if (!live.episodic) return [];
        return retrieveEpisodicEvidence(request, live.episodic, wired.episodic ?? defaultEpisodicMemoryDeps);
      case "selfMemory":
        if (!live.self) return [];
        return retrieveSelfEvidence(request, live.self, wired.self ?? noSelfMemory);
      case "goals":
        if (!live.goals) return [];
        return retrieveGoalEvidence(request, live.goals, wired.goals ?? noGoals);
      default:
        return [];
    }
  };
}

function conversational(text: string): ResponseSegment {
  return { type: "ConversationalSegment", text };
}

export async function decideTurn(
  perceived: PerceivedTurn,
  memory: WorkingMemorySnapshot,
  deps: ExecutiveDeps = defaultExecutiveDeps
): Promise<ExecutiveDecision> {
  const inhibited: InhibitedCandidate[] = [];
  const attention = planAttention(perceived, memory);

  if (perceived.completeness === "incomplete") {
    inhibited.push({ kind: "half_turn", detail: "Perception has not released a complete thought" });
  }
  if (perceived.mayProposeWorkHint && !perceived.explicitActionRequest && !perceived.operatorWorkCommitment) {
    inhibited.push({ kind: "parser_text_as_action_authority", detail: "mayProposeWorkHint is not authority" });
  }
  if (attention.pendingDisposition === "none" && (memory.pendingBriefing || memory.pendingProposal)) {
    inhibited.push({ kind: "pending_as_intent", detail: "holding pending must not reinterpret this utterance" });
  }
  if (!attention.boardEligible) {
    inhibited.push({
      kind: "global_goal_contaminates_scope",
      detail: "global board/goals not retrieved for this turn",
    });
  }

  const segments: ResponseSegment[] = [];
  const actionGrants: ExecutiveDecision["actionGrants"] = [];
  let callControl: ExecutiveDecision["callControl"] = { endCall: false };
  let retrievals: RetrievalRequest[] = [];
  let evidence: EvidenceItem[] = [];
  let conclusions: ExecutiveDecision["conclusions"] = [];

  if (perceived.completeness === "incomplete") {
    // A half-turn never reaches retrieval. Perception holds; the executive stays silent.
    segments.push(conversational(""));
  } else {
    retrievals = planRetrieval(perceived, memory, attention);
    const results: RetrievalResult[] = [];
    for (const request of retrievals) {
      results.push({ request, evidence: await deps.retrieve(request) });
    }
    evidence = results.flatMap(result => result.evidence);

    const integration = integrate({ perceived, attention, evidence, memory, ctx: deps.ctx });
    if (integration.extraEvidence.length) evidence = [...evidence, ...integration.extraEvidence];
    conclusions = integration.conclusions;
    inhibited.push(...integration.inhibited);

    if (attention.pendingDisposition === "reject") {
      segments.push(conversational("Understood. I won't."));
    }

    segments.push(...integration.segments);

    if (
      (perceived.explicitActionRequest || perceived.operatorWorkCommitment) &&
      !perceived.refusal &&
      attention.pendingDisposition !== "reject"
    ) {
      const grant = mintActionGrant({
        actionClass: "propose_day_line",
        scope: {},
        authorityBasis: perceived.explicitActionRequest
          ? "current_turn_explicit_request"
          : "current_turn_operator_commitment",
        sourceTurnAssembledText: perceived.assembledText,
        expiresAtMs: Date.now() + 15 * 60_000,
        constraints: { mutationAllowed: false, shadowOnly: true },
      });
      actionGrants.push(grant);
      segments.push({ type: "ActionProposalSegment", text: "", grant });
    }

    // Confirming a pending item inherits authority from that item's lifecycle.
    // It is never manufactured from the word "yes" alone.
    if (attention.pendingDisposition === "confirm") {
      const grant = mintActionGrant({
        actionClass: "commit_briefing",
        scope: { identity: memory.pendingBriefing?.identity ?? memory.pendingProposal?.identity },
        authorityBasis: "pending_lifecycle",
        sourceTurnAssembledText: perceived.assembledText,
        expiresAtMs: Date.now() + 15 * 60_000,
        constraints: { mutationAllowed: false, shadowOnly: true },
      });
      actionGrants.push(grant);
    }

    if (perceived.callControl === "end") {
      const grant = mintCallControlGrant({
        endCall: true,
        basis: "operator_leave_taking",
        sourceTurnAssembledText: perceived.assembledText,
      });
      callControl = { endCall: true, grant };
      segments.push({ type: "CallControlSegment", text: "", endCall: true, grant });
    }

    if (segments.length === 0) segments.push(conversational(""));
  }

  const responsePlan = { perceivedTurn: perceived, attention, segments };
  const decision: ExecutiveDecision = {
    perceivedTurn: perceived,
    attention,
    retrievals,
    evidence,
    conclusions,
    inhibitedCandidates: inhibited,
    responsePlan,
    responseSegments: segments,
    actionGrants,
    callControl,
    productionAuthority: false,
  };
  assertGovernedDecision(decision);
  return decision;
}
