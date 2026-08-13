import type { ObjectionArchetype, SalesIntelChannel } from "./salesIntel";

export type GoldlineCommercialCallOutcome =
  | "no_answer"
  | "left_voicemail"
  | "spoke"
  | "visit_booked"
  | "not_a_fit"
  | "contact_unavailable";

export const GOLDLINE_PROGRESSION_RULE_VERSION = 1 as const;
export const GOLDLINE_PROGRESSION_RECENCY_DAYS = 90 as const;

export const GOLDLINE_UNLOCK_RULE_IDS = [
  "FIRST_CAPTURE",
  "FIRST_VERIFIED_RECOVERY",
  "FOLLOW_UP_AFTER_NO_ANSWER",
  "FIRST_COMPLETED_FIELD_VISIT",
  "CLOSED_WON",
  "ARCHETYPE_EVIDENCE",
] as const;
export type GoldlineUnlockRuleId = (typeof GOLDLINE_UNLOCK_RULE_IDS)[number];

export const GOLDLINE_AGENT_IDS = [
  "SCOUT",
  "FOLLOW_UP",
  "RELATIONSHIP",
  "INTEL",
] as const;
export type GoldlineAgentId = (typeof GOLDLINE_AGENT_IDS)[number];

export const GOLDLINE_SKILL_STATES = [
  "LOCKED",
  "OBSERVED",
  "ACTIVE",
  "DEEPENED",
  "STALE",
] as const;
export type GoldlineSkillState = (typeof GOLDLINE_SKILL_STATES)[number];

export type GoldlineEvidenceKind =
  | "commercial_mission"
  | "commercial_pipeline"
  | "commercial_call"
  | "commercial_follow_up"
  | "commercial_visit"
  | "driver_recovery"
  | "armory_usage"
  | "armory_outcome"
  | "sales_intel_framework"
  | "scout_discovery";

export type GoldlineEvidenceRef = {
  kind: GoldlineEvidenceKind;
  sourceRef: string;
  missionId: number | null;
  observedAt: string;
};

export type GoldlineMissionEvidence = {
  missionId: number;
  accountId: number;
  assignedTo: string;
  status:
    | "candidate"
    | "selected"
    | "game_ready"
    | "game_active"
    | "game_completed"
    | "phone_ready"
    | "preparing"
    | "en_route"
    | "arrived"
    | "visit_completed"
    | "follow_up"
    | "won"
    | "lost";
  pipelineStage:
    | "discovered"
    | "qualified"
    | "mission_created"
    | "game_ready"
    | "field_ready"
    | "visit_planned"
    | "visited"
    | "follow_up"
    | "proposal_sent"
    | "pilot_requested"
    | "verbal_yes"
    | "won"
    | "lost";
  completedAt: string | null;
  updatedAt: string;
};

export type GoldlineCallEvidence = {
  eventId: number;
  missionId: number;
  actorId: string;
  outcome: GoldlineCommercialCallOutcome;
  createdAt: string;
};

export type GoldlineFollowUpEvidence = {
  followUpId: string;
  missionId: number;
  status: "open" | "completed" | "cancelled";
  dueAt: string;
  assignedTo: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  completedBy: string | null;
};

export type GoldlineVisitEvidence = {
  visitOutcomeId: number;
  missionId: number;
  recordedBy: string;
  outcome: "follow_up" | "won" | "lost";
  createdAt: string;
};

export type GoldlineRecoveryEvidence = {
  missionId: number;
  actorId: string;
  state: "recovery_available" | "recovery_active";
  verifiedAt: string | null;
  sourceRef: string;
};

export type GoldlineArmoryUsageEvidence = {
  usageId: string;
  missionId: number;
  actorId: string;
  weaponId: string;
  frameworkId: string | null;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  requestId: string;
  usedAt: string;
};

export type GoldlineArmoryOutcomeEvidence = {
  outcomeId: string;
  usageId: string;
  missionId: number;
  actorId: string;
  outcomeKind:
    | "follow_up_created"
    | "call_logged"
    | "visit_completed"
    | "account_won"
    | "account_lost"
    | "access_recorded"
    | "no_change";
  outcomeReference: string;
  observedAt: string;
};

export type GoldlineTrainerFrameworkEvidence = {
  frameworkId: string;
  sourceArtifactId: string;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  responseFamily: string;
  independentSourceSupportCount: number;
  acceptedAt: string;
};

export type GoldlineScoutDiscoveryEvidence = {
  reportId: string;
  missionId: number;
  actorId: string;
  sourceRef: string;
  generatedAt: string;
};

export type GoldlineProgressionEvidence = {
  tenantId: string;
  actorId: string;
  missions: readonly GoldlineMissionEvidence[];
  calls: readonly GoldlineCallEvidence[];
  followUps: readonly GoldlineFollowUpEvidence[];
  visits: readonly GoldlineVisitEvidence[];
  recoveries: readonly GoldlineRecoveryEvidence[];
  armoryUsages: readonly GoldlineArmoryUsageEvidence[];
  armoryOutcomes: readonly GoldlineArmoryOutcomeEvidence[];
  trainerFrameworks: readonly GoldlineTrainerFrameworkEvidence[];
  scoutDiscoveries: readonly GoldlineScoutDiscoveryEvidence[];
};

export type GoldlineUnlockProjection = {
  ruleId: GoldlineUnlockRuleId;
  ruleVersion: typeof GOLDLINE_PROGRESSION_RULE_VERSION;
  eligible: boolean;
  earnedAt: string | null;
  evidenceRefs: readonly GoldlineEvidenceRef[];
};

export type GoldlineAgentCapability =
  | "SURFACE_SCOUT_DISCOVERIES"
  | "SURFACE_DUE_FOLLOW_UPS"
  | "SURFACE_VERIFIED_RECOVERY"
  | "SURFACE_RELATIONSHIP_ACTIONS"
  | "EXPOSE_RELEVANT_INTELLIGENCE";

export type GoldlineAgentProjection = {
  agentId: GoldlineAgentId;
  eligible: boolean;
  eligibilityRule: GoldlineUnlockRuleId | "INTEL_MINIMUM_EVIDENCE";
  evidenceRefs: readonly GoldlineEvidenceRef[];
  capabilities: readonly GoldlineAgentCapability[];
};

export type GoldlineOutcomeClassification =
  | "positive_evidence"
  | "neutral_evidence"
  | "negative_evidence"
  | "unresolved";

export type GoldlineSkillBranchProjection = {
  branchId: ObjectionArchetype;
  state: GoldlineSkillState;
  ruleVersion: typeof GOLDLINE_PROGRESSION_RULE_VERSION;
  distinctMissionCount: number;
  persistedRealActionCount: number;
  relevantMoveUseCount: number;
  positiveAuthoritativeOutcomeCount: number;
  positiveOutcomeMissionCount: number;
  latestEvidenceAt: string | null;
  evidenceSourceRefs: readonly GoldlineEvidenceRef[];
};

export type GoldlineTechniqueProjection = {
  frameworkId: string;
  branchId: ObjectionArchetype;
  channel: SalesIntelChannel;
  eligible: boolean;
  deeperEligible: boolean;
  reviewOnly: boolean;
  doctrineSourceRef: string;
  playerEvidenceRefs: readonly GoldlineEvidenceRef[];
};

export type GoldlineMissionReason =
  | "REAL_FOLLOW_UP_DUE"
  | "REAL_FOLLOW_UP_WAITING"
  | "RECOVERY_AVAILABLE"
  | "SCOUT_VERIFIED_DISCOVERY"
  | "RELATIONSHIP_VISIT_READY"
  | "ARCHETYPE_TECHNIQUE_RELEVANT";

export type GoldlineAuthoritativeSourceKind =
  | "commercial_follow_up"
  | "commercial_mission"
  | "driver_recovery"
  | "scout_discovery";

export type GoldlineAgentMissionCandidate = {
  agentId: GoldlineAgentId;
  sourceKind: GoldlineAuthoritativeSourceKind;
  sourceRef: string;
  missionId: number;
  affordance: "VISIT" | "FOLLOW_UP" | "RECOVER" | "REVIEW" | "WAIT";
  reasonCode: GoldlineMissionReason;
  availableAt: string | null;
  branchId: ObjectionArchetype | null;
  evidenceRefs: readonly GoldlineEvidenceRef[];
};

export type GoldlineProgressionProjection = {
  ruleVersion: typeof GOLDLINE_PROGRESSION_RULE_VERSION;
  recencyDays: typeof GOLDLINE_PROGRESSION_RECENCY_DAYS;
  tenantId: string;
  actorId: string;
  projectedAt: string;
  unlocks: readonly GoldlineUnlockProjection[];
  agents: readonly GoldlineAgentProjection[];
  branches: readonly GoldlineSkillBranchProjection[];
  techniques: readonly GoldlineTechniqueProjection[];
  missionCandidates: readonly GoldlineAgentMissionCandidate[];
};

const ARCHETYPES: readonly ObjectionArchetype[] = [
  "ANCHOR",
  "GATEKEEPER",
  "GHOST",
  "STALLER",
];

function time(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function firstByObservedAt(refs: readonly GoldlineEvidenceRef[]) {
  return [...refs].sort(
    (left, right) =>
      time(left.observedAt) - time(right.observedAt) ||
      left.sourceRef.localeCompare(right.sourceRef)
  );
}

function rule(
  ruleId: GoldlineUnlockRuleId,
  refs: readonly GoldlineEvidenceRef[]
): GoldlineUnlockProjection {
  const ordered = firstByObservedAt(refs);
  return {
    ruleId,
    ruleVersion: GOLDLINE_PROGRESSION_RULE_VERSION,
    eligible: ordered.length > 0,
    earnedAt: ordered[0]?.observedAt ?? null,
    evidenceRefs: ordered,
  };
}

function missionRef(
  mission: GoldlineMissionEvidence,
  kind: "commercial_mission" | "commercial_pipeline"
): GoldlineEvidenceRef {
  return {
    kind,
    sourceRef:
      kind === "commercial_mission"
        ? `commercial_missions:${mission.missionId}`
        : `commercial_pipeline_records:mission:${mission.missionId}`,
    missionId: mission.missionId,
    observedAt: mission.completedAt ?? mission.updatedAt,
  };
}

function callRef(call: GoldlineCallEvidence): GoldlineEvidenceRef {
  return {
    kind: "commercial_call",
    sourceRef: `commercial_mission_events:${call.eventId}`,
    missionId: call.missionId,
    observedAt: call.createdAt,
  };
}

function followUpRef(followUp: GoldlineFollowUpEvidence): GoldlineEvidenceRef {
  return {
    kind: "commercial_follow_up",
    sourceRef: `commercial_follow_ups:${followUp.followUpId}`,
    missionId: followUp.missionId,
    observedAt: followUp.completedAt ?? followUp.createdAt,
  };
}

function visitRef(visit: GoldlineVisitEvidence): GoldlineEvidenceRef {
  return {
    kind: "commercial_visit",
    sourceRef: `commercial_visit_outcomes:${visit.visitOutcomeId}`,
    missionId: visit.missionId,
    observedAt: visit.createdAt,
  };
}

function recoveryRef(recovery: GoldlineRecoveryEvidence): GoldlineEvidenceRef {
  return {
    kind: "driver_recovery",
    sourceRef: recovery.sourceRef,
    missionId: recovery.missionId,
    observedAt: recovery.verifiedAt ?? "1970-01-01T00:00:00.000Z",
  };
}

function usageRef(usage: GoldlineArmoryUsageEvidence): GoldlineEvidenceRef {
  return {
    kind: "armory_usage",
    sourceRef: `armory_weapon_usages:${usage.usageId}`,
    missionId: usage.missionId,
    observedAt: usage.usedAt,
  };
}

function outcomeRef(
  outcome: GoldlineArmoryOutcomeEvidence
): GoldlineEvidenceRef {
  return {
    kind: "armory_outcome",
    sourceRef: `armory_weapon_outcomes:${outcome.outcomeId}`,
    missionId: outcome.missionId,
    observedAt: outcome.observedAt,
  };
}

export function classifyGoldlineCallOutcome(
  outcome: GoldlineCommercialCallOutcome
): GoldlineOutcomeClassification {
  if (outcome === "visit_booked" || outcome === "spoke")
    return "positive_evidence";
  if (outcome === "left_voicemail") return "neutral_evidence";
  if (outcome === "not_a_fit") return "negative_evidence";
  return "unresolved";
}

export function classifyGoldlineArmoryOutcome(
  outcome: GoldlineArmoryOutcomeEvidence["outcomeKind"]
): GoldlineOutcomeClassification {
  if (
    outcome === "follow_up_created" ||
    outcome === "visit_completed" ||
    outcome === "account_won" ||
    outcome === "access_recorded"
  )
    return "positive_evidence";
  if (outcome === "account_lost") return "negative_evidence";
  if (outcome === "call_logged" || outcome === "no_change")
    return "neutral_evidence";
  return "unresolved";
}

export function classifyGoldlineVisitOutcome(
  outcome: GoldlineVisitEvidence["outcome"]
): GoldlineOutcomeClassification {
  if (outcome === "follow_up" || outcome === "won") return "positive_evidence";
  return "negative_evidence";
}

function projectUnlocks(
  evidence: GoldlineProgressionEvidence
): GoldlineUnlockProjection[] {
  const won = evidence.missions.filter(
    mission =>
      mission.assignedTo === evidence.actorId &&
      mission.status === "won" &&
      mission.pipelineStage === "won"
  );
  const captures = won.flatMap(mission => [
    missionRef(mission, "commercial_mission"),
    missionRef(mission, "commercial_pipeline"),
  ]);
  const recoveries = evidence.recoveries
    .filter(
      recovery =>
        recovery.actorId === evidence.actorId &&
        recovery.state === "recovery_active" &&
        recovery.verifiedAt !== null
    )
    .map(recoveryRef);
  const correlatedFollowUps: GoldlineEvidenceRef[] = [];
  for (const followUp of evidence.followUps) {
    if (
      followUp.createdBy !== evidence.actorId &&
      followUp.assignedTo !== evidence.actorId
    )
      continue;
    const noAnswer = evidence.calls.find(
      call =>
        call.actorId === evidence.actorId &&
        call.missionId === followUp.missionId &&
        call.outcome === "no_answer" &&
        time(call.createdAt) <= time(followUp.createdAt)
    );
    if (noAnswer)
      correlatedFollowUps.push(callRef(noAnswer), followUpRef(followUp));
  }
  const visits = evidence.visits
    .filter(visit => visit.recordedBy === evidence.actorId)
    .map(visitRef);
  const actionRefs = businessActionRefsByMission(evidence);
  const qualifiedArchetypeUsages = evidence.armoryUsages.filter(usage => {
    if (usage.actorId !== evidence.actorId) return false;
    const followedByAction = (actionRefs.get(usage.missionId) ?? []).some(
      action => time(action.observedAt) >= time(usage.usedAt)
    );
    const followedByAssociatedOutcome = evidence.armoryOutcomes.some(
      outcome =>
        outcome.actorId === evidence.actorId &&
        outcome.usageId === usage.usageId &&
        time(outcome.observedAt) >= time(usage.usedAt)
    );
    return followedByAction || followedByAssociatedOutcome;
  });
  const qualifiedUsageIds = new Set(
    qualifiedArchetypeUsages.map(usage => usage.usageId)
  );
  const archetypeRefs = [
    ...qualifiedArchetypeUsages.map(usageRef),
    ...qualifiedArchetypeUsages.flatMap(
      usage => actionRefs.get(usage.missionId) ?? []
    ),
    ...evidence.armoryOutcomes
      .filter(
        outcome =>
          outcome.actorId === evidence.actorId &&
          qualifiedUsageIds.has(outcome.usageId)
      )
      .map(outcomeRef),
  ].filter(
    (ref, index, all) =>
      all.findIndex(candidate => candidate.sourceRef === ref.sourceRef) ===
      index
  );
  return [
    rule("FIRST_CAPTURE", captures),
    rule("FIRST_VERIFIED_RECOVERY", recoveries),
    rule("FOLLOW_UP_AFTER_NO_ANSWER", correlatedFollowUps),
    rule("FIRST_COMPLETED_FIELD_VISIT", visits),
    rule("CLOSED_WON", captures),
    rule("ARCHETYPE_EVIDENCE", archetypeRefs),
  ];
}

function businessActionRefsByMission(
  evidence: GoldlineProgressionEvidence
): Map<number, GoldlineEvidenceRef[]> {
  const result = new Map<number, GoldlineEvidenceRef[]>();
  const add = (missionId: number, ref: GoldlineEvidenceRef) => {
    const current = result.get(missionId) ?? [];
    if (!current.some(existing => existing.sourceRef === ref.sourceRef))
      current.push(ref);
    result.set(missionId, current);
  };
  for (const call of evidence.calls) {
    if (call.actorId === evidence.actorId) add(call.missionId, callRef(call));
  }
  for (const followUp of evidence.followUps) {
    if (
      followUp.createdBy === evidence.actorId ||
      followUp.assignedTo === evidence.actorId ||
      followUp.completedBy === evidence.actorId
    )
      add(followUp.missionId, followUpRef(followUp));
  }
  for (const visit of evidence.visits) {
    if (visit.recordedBy === evidence.actorId)
      add(visit.missionId, visitRef(visit));
  }
  for (const recovery of evidence.recoveries) {
    if (
      recovery.actorId === evidence.actorId &&
      recovery.state === "recovery_active" &&
      recovery.verifiedAt
    )
      add(recovery.missionId, recoveryRef(recovery));
  }
  return result;
}

function projectBranches(
  evidence: GoldlineProgressionEvidence,
  now: Date
): GoldlineSkillBranchProjection[] {
  const actionRefs = businessActionRefsByMission(evidence);
  const staleBefore =
    now.getTime() - GOLDLINE_PROGRESSION_RECENCY_DAYS * 86_400_000;
  return ARCHETYPES.map(branchId => {
    const usages = evidence.armoryUsages.filter(
      usage =>
        usage.actorId === evidence.actorId && usage.archetype === branchId
    );
    const usageIds = new Set(usages.map(usage => usage.usageId));
    const armoryResults = evidence.armoryOutcomes.filter(
      outcome =>
        outcome.actorId === evidence.actorId && usageIds.has(outcome.usageId)
    );
    const relevantUsages = usages.filter(usage =>
      (actionRefs.get(usage.missionId) ?? []).some(
        action => time(action.observedAt) >= time(usage.usedAt)
      )
    );
    // Selecting or playing a move is not progression evidence by itself. The
    // classified encounter counts only when a persisted action or associated
    // authoritative outcome follows it. Relevance is stricter: the persisted
    // business action itself must follow the selected move.
    const qualifiedUsages = usages.filter(usage => {
      if (relevantUsages.some(relevant => relevant.usageId === usage.usageId))
        return true;
      return armoryResults.some(
        outcome =>
          outcome.usageId === usage.usageId &&
          time(outcome.observedAt) >= time(usage.usedAt)
      );
    });
    const missionIds = new Set(qualifiedUsages.map(usage => usage.missionId));
    const persistedActionRefs = Array.from(missionIds).flatMap(
      missionId => actionRefs.get(missionId) ?? []
    );
    const followsUsage = (missionId: number, observedAt: string) =>
      usages.some(
        usage =>
          usage.missionId === missionId &&
          time(observedAt) >= time(usage.usedAt)
      );
    const callResults = evidence.calls.filter(
      call =>
        call.actorId === evidence.actorId &&
        missionIds.has(call.missionId) &&
        followsUsage(call.missionId, call.createdAt)
    );
    const visitResults = evidence.visits.filter(
      visit =>
        visit.recordedBy === evidence.actorId &&
        missionIds.has(visit.missionId) &&
        followsUsage(visit.missionId, visit.createdAt)
    );
    const resultRefs = [
      ...armoryResults.map(outcomeRef),
      ...callResults.map(callRef),
      ...visitResults.map(visitRef),
    ].filter(
      (ref, index, all) =>
        all.findIndex(candidate => candidate.sourceRef === ref.sourceRef) ===
        index
    );
    const positiveRefs = [
      ...armoryResults
        .filter(
          outcome =>
            classifyGoldlineArmoryOutcome(outcome.outcomeKind) ===
            "positive_evidence"
        )
        .map(outcomeRef),
      ...callResults
        .filter(
          call =>
            classifyGoldlineCallOutcome(call.outcome) === "positive_evidence"
        )
        .map(callRef),
      ...visitResults
        .filter(
          visit =>
            classifyGoldlineVisitOutcome(visit.outcome) === "positive_evidence"
        )
        .map(visitRef),
    ].filter(
      (ref, index, all) =>
        all.findIndex(candidate => candidate.sourceRef === ref.sourceRef) ===
        index
    );
    const positiveMissionIds = new Set(
      positiveRefs
        .map(ref => ref.missionId)
        .filter((missionId): missionId is number => missionId !== null)
    );
    const refs = firstByObservedAt([
      ...qualifiedUsages.map(usageRef),
      ...persistedActionRefs,
      ...resultRefs,
    ]).filter(
      (ref, index, all) =>
        all.findIndex(candidate => candidate.sourceRef === ref.sourceRef) ===
        index
    );
    const latestEvidenceAt = refs.at(-1)?.observedAt ?? null;
    const observed = missionIds.size >= 1;
    const active =
      missionIds.size >= 3 &&
      persistedActionRefs.length >= 3 &&
      resultRefs.length >= 1;
    const deepened =
      missionIds.size >= 8 &&
      relevantUsages.length >= 6 &&
      positiveRefs.length >= 2 &&
      positiveMissionIds.size >= 2;
    const stale =
      observed &&
      latestEvidenceAt !== null &&
      time(latestEvidenceAt) < staleBefore;
    const state: GoldlineSkillState = stale
      ? "STALE"
      : deepened
        ? "DEEPENED"
        : active
          ? "ACTIVE"
          : observed
            ? "OBSERVED"
            : "LOCKED";
    return {
      branchId,
      state,
      ruleVersion: GOLDLINE_PROGRESSION_RULE_VERSION,
      distinctMissionCount: missionIds.size,
      persistedRealActionCount: persistedActionRefs.length,
      relevantMoveUseCount: relevantUsages.length,
      positiveAuthoritativeOutcomeCount: positiveRefs.length,
      positiveOutcomeMissionCount: positiveMissionIds.size,
      latestEvidenceAt,
      evidenceSourceRefs: refs,
    };
  });
}

function projectAgents(
  unlocks: readonly GoldlineUnlockProjection[],
  branches: readonly GoldlineSkillBranchProjection[]
): GoldlineAgentProjection[] {
  const byRule = new Map(unlocks.map(unlock => [unlock.ruleId, unlock]));
  const fromRule = (
    agentId: GoldlineAgentId,
    ruleId: GoldlineUnlockRuleId,
    capabilities: readonly GoldlineAgentCapability[]
  ): GoldlineAgentProjection => {
    const unlock = byRule.get(ruleId);
    return {
      agentId,
      eligible: unlock?.eligible ?? false,
      eligibilityRule: ruleId,
      evidenceRefs: unlock?.evidenceRefs ?? [],
      capabilities,
    };
  };
  const intelBranches = branches.filter(
    branch => branch.state === "ACTIVE" || branch.state === "DEEPENED"
  );
  return [
    fromRule("SCOUT", "FIRST_CAPTURE", ["SURFACE_SCOUT_DISCOVERIES"]),
    fromRule("FOLLOW_UP", "FOLLOW_UP_AFTER_NO_ANSWER", [
      "SURFACE_DUE_FOLLOW_UPS",
      "SURFACE_VERIFIED_RECOVERY",
    ]),
    fromRule("RELATIONSHIP", "CLOSED_WON", ["SURFACE_RELATIONSHIP_ACTIONS"]),
    {
      agentId: "INTEL",
      eligible: intelBranches.length > 0,
      eligibilityRule: "INTEL_MINIMUM_EVIDENCE",
      evidenceRefs: intelBranches.flatMap(branch => branch.evidenceSourceRefs),
      capabilities: ["EXPOSE_RELEVANT_INTELLIGENCE"],
    },
  ];
}

function projectTechniques(
  evidence: GoldlineProgressionEvidence,
  branches: readonly GoldlineSkillBranchProjection[]
): GoldlineTechniqueProjection[] {
  const branchById = new Map(branches.map(branch => [branch.branchId, branch]));
  return evidence.trainerFrameworks.map(framework => {
    const branch = branchById.get(framework.archetype);
    const eligible =
      branch?.state === "ACTIVE" ||
      branch?.state === "DEEPENED" ||
      branch?.state === "STALE";
    return {
      frameworkId: framework.frameworkId,
      branchId: framework.archetype,
      channel: framework.channel,
      eligible,
      deeperEligible:
        branch?.state === "DEEPENED" &&
        framework.independentSourceSupportCount >= 1,
      reviewOnly: branch?.state === "STALE",
      doctrineSourceRef: `sales_intel_frameworks:${framework.frameworkId}`,
      playerEvidenceRefs: branch?.evidenceSourceRefs ?? [],
    };
  });
}

function projectCandidates(
  evidence: GoldlineProgressionEvidence,
  agents: readonly GoldlineAgentProjection[],
  branches: readonly GoldlineSkillBranchProjection[],
  techniques: readonly GoldlineTechniqueProjection[],
  now: Date
): GoldlineAgentMissionCandidate[] {
  const eligible = new Set(
    agents.filter(agent => agent.eligible).map(agent => agent.agentId)
  );
  const candidates: GoldlineAgentMissionCandidate[] = [];
  if (eligible.has("SCOUT")) {
    for (const discovery of evidence.scoutDiscoveries.filter(
      item => item.actorId === evidence.actorId
    )) {
      candidates.push({
        agentId: "SCOUT",
        sourceKind: "scout_discovery",
        sourceRef: discovery.sourceRef,
        missionId: discovery.missionId,
        affordance: "VISIT",
        reasonCode: "SCOUT_VERIFIED_DISCOVERY",
        availableAt: discovery.generatedAt,
        branchId: null,
        evidenceRefs: [
          {
            kind: "scout_discovery",
            sourceRef: discovery.sourceRef,
            missionId: discovery.missionId,
            observedAt: discovery.generatedAt,
          },
        ],
      });
    }
  }
  if (eligible.has("FOLLOW_UP")) {
    for (const followUp of evidence.followUps.filter(
      item =>
        item.status === "open" &&
        (item.assignedTo === evidence.actorId ||
          item.createdBy === evidence.actorId)
    )) {
      const due = time(followUp.dueAt) <= now.getTime();
      candidates.push({
        agentId: "FOLLOW_UP",
        sourceKind: "commercial_follow_up",
        sourceRef: `commercial_follow_ups:${followUp.followUpId}`,
        missionId: followUp.missionId,
        affordance: due ? "FOLLOW_UP" : "WAIT",
        reasonCode: due ? "REAL_FOLLOW_UP_DUE" : "REAL_FOLLOW_UP_WAITING",
        availableAt: followUp.dueAt,
        branchId: null,
        evidenceRefs: [followUpRef(followUp)],
      });
    }
    for (const recovery of evidence.recoveries.filter(
      item =>
        item.actorId === evidence.actorId && item.state === "recovery_available"
    )) {
      candidates.push({
        agentId: "FOLLOW_UP",
        sourceKind: "driver_recovery",
        sourceRef: recovery.sourceRef,
        missionId: recovery.missionId,
        affordance: "RECOVER",
        reasonCode: "RECOVERY_AVAILABLE",
        availableAt: recovery.verifiedAt,
        branchId: null,
        evidenceRefs: [recoveryRef(recovery)],
      });
    }
  }
  if (eligible.has("RELATIONSHIP")) {
    for (const mission of evidence.missions.filter(
      item =>
        item.assignedTo === evidence.actorId &&
        ["preparing", "en_route", "arrived"].includes(item.status)
    )) {
      candidates.push({
        agentId: "RELATIONSHIP",
        sourceKind: "commercial_mission",
        sourceRef: `commercial_missions:${mission.missionId}`,
        missionId: mission.missionId,
        affordance: "VISIT",
        reasonCode: "RELATIONSHIP_VISIT_READY",
        availableAt: mission.updatedAt,
        branchId: null,
        evidenceRefs: [missionRef(mission, "commercial_mission")],
      });
    }
  }
  if (eligible.has("INTEL")) {
    for (const branch of branches.filter(
      item => item.state === "ACTIVE" || item.state === "DEEPENED"
    )) {
      if (
        !techniques.some(
          technique =>
            technique.branchId === branch.branchId && technique.eligible
        )
      )
        continue;
      const missionIds = new Set(
        branch.evidenceSourceRefs
          .map(ref => ref.missionId)
          .filter((missionId): missionId is number => missionId !== null)
      );
      for (const missionId of Array.from(missionIds)) {
        candidates.push({
          agentId: "INTEL",
          sourceKind: "commercial_mission",
          sourceRef: `commercial_missions:${missionId}`,
          missionId,
          affordance: "REVIEW",
          reasonCode: "ARCHETYPE_TECHNIQUE_RELEVANT",
          availableAt: branch.latestEvidenceAt,
          branchId: branch.branchId,
          evidenceRefs: branch.evidenceSourceRefs,
        });
      }
    }
  }
  return candidates
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          item =>
            item.agentId === candidate.agentId &&
            item.sourceRef === candidate.sourceRef &&
            item.affordance === candidate.affordance
        ) === index
    )
    .sort(
      (left, right) =>
        (left.availableAt ? time(left.availableAt) : Number.POSITIVE_INFINITY) -
          (right.availableAt
            ? time(right.availableAt)
            : Number.POSITIVE_INFINITY) ||
        left.sourceKind.localeCompare(right.sourceKind) ||
        left.sourceRef.localeCompare(right.sourceRef)
    );
}

export function projectGoldlineProgression(
  evidence: GoldlineProgressionEvidence,
  now: Date
): GoldlineProgressionProjection {
  const unlocks = projectUnlocks(evidence);
  const branches = projectBranches(evidence, now);
  const agents = projectAgents(unlocks, branches);
  const techniques = projectTechniques(evidence, branches);
  return {
    ruleVersion: GOLDLINE_PROGRESSION_RULE_VERSION,
    recencyDays: GOLDLINE_PROGRESSION_RECENCY_DAYS,
    tenantId: evidence.tenantId,
    actorId: evidence.actorId,
    projectedAt: now.toISOString(),
    unlocks,
    agents,
    branches,
    techniques,
    missionCandidates: projectCandidates(
      evidence,
      agents,
      branches,
      techniques,
      now
    ),
  };
}
