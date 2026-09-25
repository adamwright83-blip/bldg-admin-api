/**
 * The executive cycle. Exactly one ExecutiveDecision per completed turn.
 *
 *   Perception
 *     → Working-Memory Gate        (what may be written / what may influence)
 *     → Attention                  (lanes, compartments, what to resolve)
 *     → Retrieval A                (cheap, unscoped)
 *     → Scope Resolution           (who is this actually about?)
 *     → Conflict + Epistemic       (do things line up? what do we know?)
 *     → Control Allocation         (fast / deliberate / verify / clarify)
 *         ├── enough  → Integration
 *         └── more    → Retrieval B / Verify → re-monitor
 *     → Integration → Inhibition → Judgment → Authority
 *     → ExecutiveDecision → ResponsePlan / Action Gateway / Call Control
 *     → Working-Memory Update
 *
 * COGNITION MAY LOOP, but always terminates: every exit records a StoppingReason, and
 * the allocator refuses a round that would repeat a request or could not change the
 * answer.
 *
 * Retrieval is INJECTED and defaults to retrieving nothing. Reading production data is
 * an explicit act, so no code path reaches the database merely by calling the brain.
 */

import type { ExecutiveDecision, InhibitedCandidate } from "../contracts/executiveDecision";
import type { EvidenceItem, PriorClaimRecheckResult } from "../contracts/evidence";
import type { PerceivedTurn } from "../contracts/perceivedTurn";
import type { ResponseSegment } from "../contracts/responsePlan";
import type { RetrievalRequest } from "../contracts/retrieval";
import type { WorkingMemorySnapshot } from "../contracts/workingMemory";
import { initialControlState, type ExecutiveControlState } from "../contracts/control";
import { planAttention } from "./attention";
import { activeTaskSets, classifyChange, gateWorkingMemory, inputRuling, outputAllowed, suppressedSlots } from "./workingMemoryGate";
import {
  planRetrievalPassA,
  planRetrievalPassB,
  planVerification,
  resolveScope,
  type ResolvedScope,
} from "./retrievalPlan";
import { monitorConflicts } from "./conflictMonitor";
import { assessEpistemicState } from "./epistemicState";
import { allocateControl, anotherRoundIsWorthwhile, terminalReason } from "./controlAllocator";
import { integrate, type IntegrationContext } from "./integrate";
import { applyInhibition } from "./inhibition";
import { mintActionGrant, mintCallControlGrant } from "./grants";
import { proposalText, proposedWorkTitle } from "./proposal";
import { dayLineCandidate } from "./dayLineAuthority";
import { nextStrategicFrame } from "./strategicFrame";
import { explicitPendingReturn } from "./pendingBinding";
import { PLANNING_AUTHORITIES_NOT_TOUCHED, type CognitiveAcknowledgementKind } from "../contracts/responsePlan";
import { phraseCognitiveAcknowledgement } from "../response/cognitiveAcknowledgement";
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

export type RetrievalRunner = (request: RetrievalRequest) => Promise<EvidenceItem[]>;

export type ExecutiveDeps = {
  retrieve: RetrievalRunner;
  ctx: IntegrationContext;
  nowMs?: () => number;
  /**
   * Production authority is explicit and injected by the live cutover
   * orchestrator. Ordinary calls and every shadow observer remain false.
   */
  productionAuthority?: boolean;
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
 * A compartment with no context supplied stays silent rather than reading more than
 * the caller intended.
 */
export function liveReadOnlyRetrieval(
  ctx: LiveRetrievalContext | BusinessMemoryContext,
  deps: LiveRetrievalDeps | BusinessMemoryDeps = {}
): RetrievalRunner {
  const live: LiveRetrievalContext = "business" in ctx ? ctx : { business: ctx as BusinessMemoryContext };
  const wired: LiveRetrievalDeps =
    "runQuery" in deps ? { business: deps as BusinessMemoryDeps } : (deps as LiveRetrievalDeps);

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

function acknowledge(kind: CognitiveAcknowledgementKind, strategic: boolean): ResponseSegment {
  return {
    type: "CognitiveAcknowledgementSegment",
    kind,
    durableWrite: false,
    ...(strategic ? { collisionsAvoided: PLANNING_AUTHORITIES_NOT_TOUCHED } : {}),
    text: phraseCognitiveAcknowledgement(kind),
  };
}

function recheckFrom(evidence: readonly EvidenceItem[]): PriorClaimRecheckResult | null {
  const item = evidence.find(candidate => candidate.type === "prior_claim_recheck");
  if (!item) return null;
  return (item.payload as { recheck?: PriorClaimRecheckResult }).recheck ?? null;
}

export async function decideTurn(
  perceived: PerceivedTurn,
  memory: WorkingMemorySnapshot,
  deps: ExecutiveDeps = defaultExecutiveDeps
): Promise<ExecutiveDecision> {
  const nowMs = deps.nowMs?.() ?? Date.now();
  const productionAuthority = deps.productionAuthority === true;
  const control: ExecutiveControlState = initialControlState();
  const inhibited: InhibitedCandidate[] = [];

  // ── Working-memory gating ─────────────────────────────────────────────────
  const change = classifyChange(perceived, memory);
  const taskSets = activeTaskSets(perceived, memory, nowMs);
  const rulings = gateWorkingMemory({ perceived, memory, change, taskSets });
  control.change = change;
  control.activeTaskSets = taskSets;
  control.workingMemoryGates = rulings;
  control.suppressedContext = suppressedSlots(rulings);

  // ── Attention ─────────────────────────────────────────────────────────────
  const attention = planAttention({ perceived, memory, change, taskSets, rulings });

  const segments: ResponseSegment[] = [];
  const actionGrants: ExecutiveDecision["actionGrants"] = [];
  let callControl: ExecutiveDecision["callControl"] = { endCall: false };
  let retrievals: RetrievalRequest[] = [];
  let evidence: EvidenceItem[] = [];
  let conclusions: ExecutiveDecision["conclusions"] = [];
  let workingMemoryUpdate: ExecutiveDecision["workingMemoryUpdate"];
  let scope: ResolvedScope = { accountIds: [], terms: [], ambiguous: false };

  if (perceived.completeness === "incomplete") {
    // A half-turn never reaches retrieval. Perception holds; the executive stays silent.
    inhibited.push({ kind: "half_turn", detail: "Perception has not released a complete thought" });
    control.stoppingReason = "evidence_sufficient";
    segments.push(conversational(""));
  } else {
    const run = async (requests: RetrievalRequest[]): Promise<void> => {
      if (!requests.length) return;
      retrievals = [...retrievals, ...requests];
      control.retrievalRounds += 1;
      for (const request of requests) {
        evidence = [...evidence, ...(await deps.retrieve(request))];
      }
    };

    // ── Pass A: cheap and unscoped ──────────────────────────────────────────
    await run(planRetrievalPassA(perceived, memory, attention));

    // ── Scope resolution ────────────────────────────────────────────────────
    scope = resolveScope(evidence);
    control.ambiguity = scope.ambiguous
      ? "requires_clarification"
      : attention.entitiesToResolve.length && !scope.accountIds.length
        ? "resolvable"
        : "none";

    // ── Monitor, allocate, and loop only while it is worth it ───────────────
    const monitor = (): void => {
      control.conflicts = monitorConflicts({
        perceived,
        memory,
        evidence,
        taskSets,
        recheck: recheckFrom(evidence),
      });
      control.epistemic = assessEpistemicState({
        evidence,
        unresolvedReferences: scope.ambiguous ? attention.entitiesToResolve : [],
        priorClaimRechecked: recheckFrom(evidence)?.resolution === "fresh_query",
        hasConflict: control.conflicts.some(
          conflict => conflict.kind === "current_source_conflict" || conflict.kind === "prior_claim_conflict"
        ),
        retrievalAttempted: retrievals.length > 1,
      });
      control.mode = allocateControl({
        perceived,
        taskSets,
        conflicts: control.conflicts,
        epistemic: control.epistemic,
      });
      control.needsVerification = control.mode === "verify";
    };

    monitor();

    // One bounded escalation: scoped reads, or a verification reread.
    const proposed =
      control.mode === "verify"
        ? planVerification(memory, attention)
        : planRetrievalPassB({ perceived, memory, attention, scope });

    const verdict = anotherRoundIsWorthwhile({
      mode: control.mode,
      epistemic: control.epistemic,
      conflicts: control.conflicts,
      retrievalRounds: control.retrievalRounds,
      issued: retrievals,
      proposed,
    });

    if (verdict.worthwhile) {
      control.deliberationDepth += 1;
      await run(proposed);
      scope = resolveScope(evidence);
      // New evidence can change what we know and what conflicts; look again.
      monitor();
      control.stoppingReason = terminalReason({ mode: control.mode, epistemic: control.epistemic });
    } else {
      control.stoppingReason = verdict.reason ?? terminalReason({ mode: control.mode, epistemic: control.epistemic });
    }

    // ── Integration ─────────────────────────────────────────────────────────
    if (attention.pendingDisposition === "reject") {
      segments.push(conversational("Understood. I won't."));
    }

    const integration = integrate({ perceived, attention, evidence, memory, control, ctx: deps.ctx });
    if (integration.extraEvidence.length) evidence = [...evidence, ...integration.extraEvidence];
    conclusions = integration.conclusions;
    inhibited.push(...integration.inhibited);
    segments.push(...integration.segments);
    if (integration.orderedQueryUpdate || integration.continuationPresented) {
      workingMemoryUpdate = {
        orderedQuery: integration.orderedQueryUpdate,
        continuationPresented: integration.continuationPresented,
      };
    } else if (inputRuling(rulings, "ordered_query") === "clear") {
      workingMemoryUpdate = { orderedQuery: null };
    }

    // ── Authority ───────────────────────────────────────────────────────────
    // Work-frame classification informs this choice. It does not mint the grant.
    const mayPropose = dayLineCandidate(perceived) && attention.pendingDisposition !== "reject";
    if (mayPropose) {
      control.actionRisk = "proposal_only";
      const title = proposedWorkTitle(perceived);
      const explicitCommit = perceived.workDeclarationKind === "explicit_day_line";
      const grant = mintActionGrant({
        actionClass: explicitCommit ? "commit_day_line" : "propose_day_line",
        scope: title ? { titles: [title] } : {},
        authorityBasis: perceived.explicitActionRequest
          ? "current_turn_explicit_request"
          : "current_turn_operator_commitment",
        sourceTurnAssembledText: perceived.assembledText,
        expiresAtMs: nowMs + 15 * 60_000,
        constraints: {
          mutationAllowed: productionAuthority,
          shadowOnly: !productionAuthority,
        },
      });
      actionGrants.push(grant);
      segments.push({ type: "ActionProposalSegment", text: proposalText(title), grant });
    }

    if (attention.pendingDisposition === "confirm") {
      // Authority is inherited from the pending item's lifecycle, never manufactured
      // from the word "yes" alone.
      control.actionRisk = "proposal_only";
      const grant = mintActionGrant({
        actionClass: "commit_briefing",
        scope: { identity: memory.pendingBriefing?.identity ?? memory.pendingProposal?.identity },
        authorityBasis: "pending_lifecycle",
        sourceTurnAssembledText: perceived.assembledText,
        expiresAtMs: nowMs + 15 * 60_000,
        constraints: {
          mutationAllowed: productionAuthority,
          shadowOnly: !productionAuthority,
        },
      });
      actionGrants.push(grant);
    }

    const frameUpdate = nextStrategicFrame({ perceived, memory, nowMs });
    if (frameUpdate) {
      workingMemoryUpdate = { ...(workingMemoryUpdate ?? {}), activeWorkFrame: frameUpdate };
    }

    if (perceived.classifierStatus !== "classified") {
      conclusions = [
        ...conclusions,
        {
          kind: "classification_hold",
          detail: "work-frame classification did not authorize an action",
          evidenceIds: [],
        },
      ];
    } else {
      if (explicitPendingReturn(perceived, memory) && attention.pendingDisposition === "none") {
        segments.push(acknowledge("pending_reactivated", false));
      }
      if (perceived.attentionRepair !== "none" && attention.priorClaim === "none") {
        segments.push(acknowledge("attention_repaired", false));
      }
      const strategicActive = taskSets.some(task => task.kind === "strategic_work");
      if (
        strategicActive &&
        (frameUpdate?.status === "content_held" ||
          (perceived.workDeclarationKind === "strategic_work" && perceived.strategicShape === "content"))
      ) {
        segments.push(acknowledge("strategic_content_understood", true));
        conclusions = [
          ...conclusions,
          {
            kind: "strategic_work_understood",
            detail: "operator-declared strategic work held cognitively; no durable write",
            evidenceIds: [],
          },
        ];
      } else if (strategicActive && perceived.workDeclarationKind === "strategic_work" && perceived.strategicShape === "unresolved") {
        segments.push(acknowledge("awaiting_strategic_content", true));
        conclusions = [
          ...conclusions,
          {
            kind: "strategic_work_understood",
            detail: "strategic frame open; content unresolved; no durable write",
            evidenceIds: [],
          },
        ];
      } else if (perceived.operatorIntentAttested && perceived.workDeclarationKind !== "ordinary_work" && perceived.workDeclarationKind !== "explicit_day_line" && perceived.workDeclarationKind !== "explicit_action") {
        segments.push(acknowledge("operator_intent_understood", false));
      }
      if (perceived.operatorIntentAttested) {
        conclusions = [
          ...conclusions,
          {
            kind: "operator_intent_attested",
            detail: "operator-attested intention; not an external fact to verify",
            evidenceIds: [],
          },
        ];
      }
      if (perceived.embeddedExternalFact) {
        conclusions = [
          ...conclusions,
          {
            kind: "external_fact_unverified",
            detail: "an embedded external claim was not verified and was not treated as the intention",
            evidenceIds: [],
          },
        ];
      }
      if (perceived.explicitMissionWriteRequest) {
        conclusions = [
          ...conclusions,
          {
            kind: "mission_write_unavailable",
            detail: "no canonical mission write path; declaration held cognitively",
            evidenceIds: [],
          },
        ];
      }
      if (perceived.externalCapability) {
        conclusions = [
          ...conclusions,
          {
            kind: "external_capability_unowned",
            detail: "recognized an existing capability Brain V2 does not execute; no grant minted",
            evidenceIds: [],
          },
        ];
      }
      if (
        !mayPropose &&
        attention.pendingDisposition !== "reject" &&
        !perceived.openFragment &&
        !perceived.refusal &&
        !perceived.externalCapability &&
        !perceived.explicitMissionWriteRequest &&
        (perceived.workDeclarationKind === "explicit_action" || perceived.workDeclarationKind === "ordinary_work")
      ) {
        conclusions = [
          ...conclusions,
          {
            kind: "action_unsupported",
            detail: "recognized an action Brain V2 does not own; no Day Line grant",
            evidenceIds: [],
          },
        ];
      }
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

  // ── Inhibition ────────────────────────────────────────────────────────────
  inhibited.push(
    ...applyInhibition({
      perceived,
      memory,
      attention,
      control,
      evidence,
      orderedQueryAllowed: outputAllowed(rulings, "ordered_query"),
    })
  );

  const responsePlan = { perceivedTurn: perceived, attention, segments };
  const decision: ExecutiveDecision = {
    perceivedTurn: perceived,
    attention,
    control,
    retrievals,
    evidence,
    conclusions,
    inhibitedCandidates: inhibited,
    responsePlan,
    responseSegments: segments,
    actionGrants,
    callControl,
    productionAuthority: false,
    workingMemoryUpdate,
  };
  assertGovernedDecision(decision);
  return decision;
}
