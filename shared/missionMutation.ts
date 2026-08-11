/**
 * Mission Mutation Library — generalizes "failure mutates, it does not
 * disappear" across all four encounter archetypes without inventing a second
 * CRM state machine.
 *
 * A mutation is a GAME/WORLD interpretation of an authoritative business
 * state transition that already happened. It is never itself the source of
 * truth: `deriveMutation` only reads real evidence (follow-up commitments,
 * pipeline stage, decision-maker discovery, verified win/loss) and maps it to
 * a world effect. Nothing here writes business state.
 */

export const MUTATION_TYPES = [
  "RECOVERY_PATH",
  "ALT_ROUTE",
  "WATCH_WINDOW",
  "NEW_CONTACT_ROUTE",
  "FOLLOW_UP_ROUTE",
  "ESCALATION_ROUTE",
  "SCOUT_BRANCH",
  "CLOSED_PATH",
  "CAPTURED_PATH",
] as const;

export type MutationType = (typeof MUTATION_TYPES)[number];

export const MUTATION_TRIGGER_TYPES = [
  "follow_up_commitment",
  "decision_maker_discovered",
  "pipeline_stage_change",
  "verified_win",
  "verified_loss",
  "scout_discovery",
  "contact_route_discovered",
] as const;

export type MutationTriggerType = (typeof MUTATION_TRIGGER_TYPES)[number];

export type MutationEvidence = {
  missionStatus: string;
  pipelineStage: string | null;
  lossReason: string | null;
  followUpDueAt: string | null;
  hasDecisionMakerContact: boolean;
  verifiedWin: boolean;
};

export type WorldEffect = {
  visualState:
    | "available"
    | "approaching"
    | "active"
    | "captured"
    | "contested"
    | "recovery_available"
    | "recovery_active"
    | "watching"
    | "closed";
  worldAnchor: string;
  unlockedPath: string | null;
};

export type MutationDecision = {
  mutationType: MutationType;
  triggerType: MutationTriggerType;
  /** Stable identity of the evidence that justified this mutation, used for idempotency. */
  triggerReference: string;
  worldEffect: WorldEffect;
};

/**
 * Deterministic priority. Evaluated top to bottom; the first rule whose
 * condition holds wins. This ordering is the entire "priority" system — no
 * randomness, no reload variance. Authoritative terminal states (won/lost)
 * always outrank in-flight signals like a follow-up commitment.
 */
export function deriveMutation(
  evidence: MutationEvidence
): MutationDecision | null {
  const {
    missionStatus,
    pipelineStage,
    lossReason,
    followUpDueAt,
    hasDecisionMakerContact,
    verifiedWin,
  } = evidence;

  // CLOSED is terminal. Authoritative loss evidence always wins, and no rule
  // below may ever re-open a closed mission from game state alone.
  if (missionStatus === "lost" || pipelineStage === "lost") {
    return {
      mutationType: "CLOSED_PATH",
      triggerType: "verified_loss",
      triggerReference: `loss:${lossReason ?? "unspecified"}`,
      worldEffect: {
        visualState: "closed",
        worldAnchor: "fortress_gate",
        unlockedPath: null,
      },
    };
  }

  if (verifiedWin || missionStatus === "won" || pipelineStage === "won") {
    return {
      mutationType: "CAPTURED_PATH",
      triggerType: "verified_win",
      triggerReference: "win:verified",
      worldEffect: {
        visualState: "captured",
        worldAnchor: "victory_banner",
        unlockedPath: null,
      },
    };
  }

  // A real, still-future follow-up commitment is the strongest in-flight
  // signal: it is an explicit promise, not an inference.
  if (followUpDueAt) {
    const due = new Date(followUpDueAt);
    if (Number.isFinite(due.getTime())) {
      return {
        mutationType: "WATCH_WINDOW",
        triggerType: "follow_up_commitment",
        triggerReference: `follow_up:${followUpDueAt}`,
        worldEffect: {
          visualState: "watching",
          worldAnchor: "watchtower",
          unlockedPath: "watch_window",
        },
      };
    }
  }

  if (missionStatus === "follow_up") {
    return {
      mutationType: "RECOVERY_PATH",
      triggerType: "pipeline_stage_change",
      triggerReference: `pipeline:${pipelineStage ?? "follow_up"}`,
      worldEffect: {
        visualState: "contested",
        worldAnchor: "gold_side_entrance",
        unlockedPath: "gold_recovery_path",
      },
    };
  }

  // Actively worked but no route to the decision maker: a real access gap,
  // not an inference from missing data (the mission has to be in flight).
  if (missionStatus === "active" && !hasDecisionMakerContact) {
    return {
      mutationType: "NEW_CONTACT_ROUTE",
      triggerType: "contact_route_discovered",
      triggerReference: "contact_route:blocked",
      worldEffect: {
        visualState: "active",
        worldAnchor: "gate_checkpoint",
        unlockedPath: null,
      },
    };
  }

  return null;
}

/**
 * Mutation identity for idempotency: the same (tenant, actor, mission,
 * trigger) must never persist a second row. Evaluating the same authoritative
 * state twice must be a no-op, not a duplicate world node.
 */
export function mutationIdentityKey(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  triggerReference: string;
}): string {
  return [
    input.tenantId,
    input.actorId,
    input.missionId,
    input.triggerReference,
  ].join(":");
}
