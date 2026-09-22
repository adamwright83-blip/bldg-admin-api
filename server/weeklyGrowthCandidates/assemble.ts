import { isDealable, rankCandidates, type LeverCandidate } from "../churnRadar/hustlerLeverSelection";
import {
  WEEKLY_GROWTH_CAPS,
  WEEKLY_GROWTH_RANK_REASONS,
  WEEKLY_GROWTH_SOURCE_KINDS,
  WEEKLY_GROWTH_SOURCE_REPORT_KEYS,
  motionAlignsWithMacroGoal,
  prepFeasibleWithinHorizon,
  type WeeklyGrowthCandidate,
  type WeeklyGrowthCandidateFeed,
  type WeeklyGrowthMotion,
  type WeeklyGrowthRankReason,
  type WeeklyGrowthSourceKind,
  type WeeklyGrowthSourceRef,
  type WeeklyGrowthSourceReport,
  type WeeklyGrowthSourceReportKey,
} from "../../shared/weeklyGrowthCandidates";
import type {
  SourceAvailability,
  WeeklyGrowthMacroSnapshot,
  WeeklyGrowthRawOrigin,
  WeeklyGrowthRawRecord,
  WeeklyGrowthSourceBundle,
} from "./rawRecord";

const UNFINISHED_ORIGINS = new Set<WeeklyGrowthRawOrigin>([
  "day_director_commitment",
  "commercial_mission",
  "ops_task",
  "campaign_run",
]);

const LIVE_STATUS: Record<WeeklyGrowthRawOrigin, ReadonlySet<string> | null> = {
  day_director_commitment: new Set(["open"]),
  commercial_mission: new Set([
    "selected",
    "game_ready",
    "game_active",
    "game_completed",
    "phone_ready",
    "preparing",
    "en_route",
    "arrived",
    "visit_completed",
    "follow_up",
  ]),
  ops_task: new Set(["open", "accepted", "in_progress"]),
  campaign_run: new Set(["active"]),
  commercial_follow_up: new Set(["open"]),
  proactive_obligation: new Set(["scheduled", "draft_prepared", "awaiting_result"]),
  churn_snapshot: new Set(["scored"]),
  campaign_template: new Set(["enabled"]),
  strategy_snapshot: null,
  mission_sequencer: null,
};

const OPERATIONAL_TEXT: Array<{ class: WeeklyGrowthRawRecord["operationalClass"]; pattern: RegExp }> = [
  { class: "pickup", pattern: /\bpick[\s-]?ups?\b/i },
  { class: "dropoff", pattern: /\bdrop[\s-]?offs?\b/i },
  { class: "route", pattern: /\broute stops?\b/i },
  { class: "procurement", pattern: /\b(jetro|procurement)\b/i },
  { class: "plant", pattern: /\b(plant work|processing plant|laundry plant)\b/i },
  { class: "laundry_processing", pattern: /\blaundry processing\b/i },
  { class: "housekeeping", pattern: /\bhousekeeping\b/i },
  { class: "cargo", pattern: /\bcargo(?:-only)?\b/i },
  { class: "maintenance", pattern: /\bmaintenance\b/i },
];

const CONTENT_PRIORITY: WeeklyGrowthRawOrigin[] = [
  "commercial_follow_up",
  "commercial_mission",
  "ops_task",
  "campaign_run",
  "proactive_obligation",
  "day_director_commitment",
  "churn_snapshot",
  "campaign_template",
];

const AUTHORITY: Record<WeeklyGrowthRawOrigin, number> = {
  day_director_commitment: 0,
  commercial_mission: 0,
  ops_task: 0,
  campaign_run: 0,
  commercial_follow_up: 1,
  proactive_obligation: 2,
  churn_snapshot: 3,
  campaign_template: 4,
  strategy_snapshot: 99,
  mission_sequencer: 99,
};

const READER_NAME: Record<WeeklyGrowthRawOrigin, string> = {
  day_director_commitment: "dayDirectorCommitments",
  commercial_mission: "listCommercialMissions",
  ops_task: "listOpsTasks",
  campaign_run: "listOperatorRuns",
  commercial_follow_up: "commercialFollowUps",
  proactive_obligation: "loadObligations",
  churn_snapshot: "getLatestChurnScan",
  campaign_template: "listCampaigns",
  strategy_snapshot: "snapshotBuilder",
  mission_sequencer: "missionSequencer",
};

const SOURCE_CLASS: Record<WeeklyGrowthSourceKind, number> = {
  unfinished_growth_work: 1,
  commercial_follow_up: 2,
  proactive_obligation: 3,
  customer_recovery: 4,
  campaign_library: 5,
};

export type AssembleWeeklyGrowthCandidatesInput = {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  remainingDates: readonly string[];
  today: string;
  observedAt: string;
  bundle: WeeklyGrowthSourceBundle;
};

type Ranked = {
  candidate: WeeklyGrowthCandidate;
  sourceClass: number;
  inFlight: number;
  due: number;
  score: number | null;
  prep: number;
  macro: number;
  stableId: string;
};

export function assembleWeeklyGrowthCandidates(
  input: AssembleWeeklyGrowthCandidatesInput
): Omit<WeeklyGrowthCandidateFeed, "generatedAt" | "fingerprint"> {
  const macro = macroMetric(input.bundle.macroGoal);
  const eligibleBySource = new Map<WeeklyGrowthSourceKind, WeeklyGrowthRawRecord[]>();
  for (const kind of WEEKLY_GROWTH_SOURCE_KINDS) eligibleBySource.set(kind, []);

  const observed = new Map<WeeklyGrowthSourceKind, number>();
  for (const kind of WEEKLY_GROWTH_SOURCE_KINDS) observed.set(kind, 0);

  const recoveryPool: WeeklyGrowthRawRecord[] = [];

  for (const record of recordsOf(input.bundle.unfinished)) {
    observe(observed, record);
    if (!eligibleUnfinished(record, input)) continue;
    const kind = sourceKindOf(record.origin);
    if (kind) eligibleBySource.get(kind)!.push(record);
  }
  for (const record of recordsOf(input.bundle.commercialFollowUps)) {
    observe(observed, record);
    if (eligibleFollowUp(record, input)) eligibleBySource.get("commercial_follow_up")!.push(record);
  }
  for (const record of recordsOf(input.bundle.proactiveObligations)) {
    observe(observed, record);
    if (eligibleObligation(record, input)) eligibleBySource.get("proactive_obligation")!.push(record);
  }
  for (const record of recordsOf(input.bundle.recovery)) {
    observe(observed, record);
    if (scoped(record, input) && !banned(record) && record.status === "scored") recoveryPool.push(record);
  }
  for (const record of recordsOf(input.bundle.campaigns)) {
    observe(observed, record);
    if (eligibleCampaign(record, input)) eligibleBySource.get("campaign_library")!.push(record);
  }

  const dealable = recoveryPool.filter(record => isDealable(toLever(record)));
  eligibleBySource.set("customer_recovery", dealable);

  const warmOrder = rankCandidates(dealable.map(toLever), "warm");
  const swingOrder = rankCandidates(dealable.map(toLever), "big_swing");
  const warmRank = new Map(warmOrder.map((item, index) => [item.id, index]));
  const swingRank = new Map(swingOrder.map((item, index) => [item.id, index]));

  const eligible = WEEKLY_GROWTH_SOURCE_KINDS.flatMap(kind => eligibleBySource.get(kind) ?? []);
  const groups = dedupe(eligible);
  const ranked: Ranked[] = groups.map(group => toRanked(group, input, macro, warmRank, swingRank, warmOrder.length));
  ranked.sort(compareRanked);

  const shown: WeeklyGrowthCandidate[] = [];
  let followUps = 0;
  let recoveries = 0;
  let campaigns = 0;
  for (const item of ranked) {
    if (shown.length >= WEEKLY_GROWTH_CAPS.total) break;
    const kind = item.candidate.sourceKind;
    if ((kind === "commercial_follow_up" || kind === "proactive_obligation") && followUps >= WEEKLY_GROWTH_CAPS.followUp) {
      continue;
    }
    if (kind === "customer_recovery" && recoveries >= WEEKLY_GROWTH_CAPS.recovery) continue;
    if (kind === "campaign_library" && campaigns >= WEEKLY_GROWTH_CAPS.campaign) continue;
    shown.push(item.candidate);
    if (kind === "commercial_follow_up" || kind === "proactive_obligation") followUps += 1;
    if (kind === "customer_recovery") recoveries += 1;
    if (kind === "campaign_library") campaigns += 1;
  }

  const sources = {} as Record<WeeklyGrowthSourceReportKey, WeeklyGrowthSourceReport>;
  for (const key of WEEKLY_GROWTH_SOURCE_REPORT_KEYS) {
    sources[key] = reportFor(key, input.bundle, observed, eligibleBySource, ranked, shown);
  }

  return {
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    dayDirectorActorId: input.dayDirectorActorId,
    candidates: shown,
    sources,
    caps: WEEKLY_GROWTH_CAPS,
  };
}

function reportFor(
  key: WeeklyGrowthSourceReportKey,
  bundle: WeeklyGrowthSourceBundle,
  observed: Map<WeeklyGrowthSourceKind, number>,
  eligibleBySource: Map<WeeklyGrowthSourceKind, WeeklyGrowthRawRecord[]>,
  ranked: Ranked[],
  shown: WeeklyGrowthCandidate[]
): WeeklyGrowthSourceReport {
  if (key === "macro_goal") {
    const source = bundle.macroGoal;
    if (source.status === "unavailable") return { status: "unavailable", reason: source.reason };
    return {
      status: "available",
      observedCount: source.records.length,
      eligibleCount: 0,
      rankedCount: 0,
      shownCount: 0,
    };
  }
  const availability = availabilityFor(key, bundle);
  if (availability.status === "unavailable") return { status: "unavailable", reason: availability.reason };
  return {
    status: "available",
    observedCount: observed.get(key) ?? 0,
    eligibleCount: eligibleBySource.get(key)?.length ?? 0,
    rankedCount: ranked.filter(item => item.candidate.sourceKind === key).length,
    shownCount: shown.filter(item => item.sourceKind === key).length,
  };
}

function availabilityFor(
  key: WeeklyGrowthSourceKind,
  bundle: WeeklyGrowthSourceBundle
): SourceAvailability<WeeklyGrowthRawRecord> {
  switch (key) {
    case "unfinished_growth_work":
      return bundle.unfinished;
    case "commercial_follow_up":
      return bundle.commercialFollowUps;
    case "proactive_obligation":
      return bundle.proactiveObligations;
    case "customer_recovery":
      return bundle.recovery;
    case "campaign_library":
      return bundle.campaigns;
  }
}

function recordsOf(source: SourceAvailability<WeeklyGrowthRawRecord>): WeeklyGrowthRawRecord[] {
  return source.status === "available" ? source.records : [];
}

function observe(observed: Map<WeeklyGrowthSourceKind, number>, record: WeeklyGrowthRawRecord): void {
  const kind = sourceKindOf(record.origin);
  if (!kind) return;
  observed.set(kind, (observed.get(kind) ?? 0) + 1);
}

function sourceKindOf(origin: WeeklyGrowthRawOrigin): WeeklyGrowthSourceKind | null {
  switch (origin) {
    case "day_director_commitment":
    case "commercial_mission":
    case "ops_task":
    case "campaign_run":
      return "unfinished_growth_work";
    case "commercial_follow_up":
      return "commercial_follow_up";
    case "proactive_obligation":
      return "proactive_obligation";
    case "churn_snapshot":
      return "customer_recovery";
    case "campaign_template":
      return "campaign_library";
    default:
      return null;
  }
}

function banned(record: WeeklyGrowthRawRecord): boolean {
  return record.fixture || record.origin === "strategy_snapshot" || record.origin === "mission_sequencer";
}

function scoped(record: WeeklyGrowthRawRecord, input: AssembleWeeklyGrowthCandidatesInput): boolean {
  if (record.tenantId !== input.tenantId) return false;
  if (record.origin === "day_director_commitment") return record.actorId === input.dayDirectorActorId;
  if (record.origin === "churn_snapshot" || record.origin === "campaign_template") return true;
  if (record.operatorUserId == null) return record.origin === "commercial_follow_up";
  return record.operatorUserId === input.operatorUserId;
}

function live(record: WeeklyGrowthRawRecord): boolean {
  const allowed = LIVE_STATUS[record.origin];
  return allowed != null && allowed.has(record.status);
}

function operationalHit(record: WeeklyGrowthRawRecord): boolean {
  if (record.operationalClass) return true;
  const text = `${record.title}\n${record.objective}`;
  return OPERATIONAL_TEXT.some(entry => entry.pattern.test(text));
}

function eligibleUnfinished(record: WeeklyGrowthRawRecord, input: AssembleWeeklyGrowthCandidatesInput): boolean {
  if (!UNFINISHED_ORIGINS.has(record.origin)) return false;
  if (!scoped(record, input) || banned(record) || !live(record)) return false;
  if (operationalHit(record)) return false;
  if (!record.grounding) return false;
  return true;
}

function eligibleFollowUp(record: WeeklyGrowthRawRecord, input: AssembleWeeklyGrowthCandidatesInput): boolean {
  if (record.origin !== "commercial_follow_up") return false;
  if (!scoped(record, input) || banned(record) || !live(record)) return false;
  if (operationalHit(record)) return false;
  return true;
}

function eligibleObligation(record: WeeklyGrowthRawRecord, input: AssembleWeeklyGrowthCandidatesInput): boolean {
  if (record.origin !== "proactive_obligation") return false;
  if (!scoped(record, input) || banned(record) || !live(record)) return false;
  if (record.obligationKind === "data_health" || record.obligationKind == null) return false;
  if (operationalHit(record)) return false;
  return true;
}

function eligibleCampaign(record: WeeklyGrowthRawRecord, input: AssembleWeeklyGrowthCandidatesInput): boolean {
  if (record.origin !== "campaign_template") return false;
  if (!scoped(record, input) || banned(record) || !live(record)) return false;
  if (operationalHit(record)) return false;
  return true;
}

function toLever(record: WeeklyGrowthRawRecord): LeverCandidate {
  return {
    id: record.sourceId,
    score: record.existingScore ?? 0,
    activeOrderCount: record.activeOrderCount ?? 0,
    historyOrderCount: record.historyOrderCount ?? 0,
    daysSinceLastOrder: record.daysSinceLastOrder,
    estimatedMonthlyImpactCents: record.estimatedMonthlyImpactCents,
  };
}

function dedupe(records: WeeklyGrowthRawRecord[]): WeeklyGrowthRawRecord[][] {
  const parent = records.map((_, index) => index);
  const find = (index: number): number => {
    let cursor = index;
    while (parent[cursor] !== cursor) cursor = parent[cursor]!;
    let compress = index;
    while (parent[compress] !== cursor) {
      const next = parent[compress]!;
      parent[compress] = cursor;
      compress = next;
    }
    return cursor;
  };
  const union = (left: number, right: number) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  const owners = new Map<string, number>();
  records.forEach((record, index) => {
    for (const key of dedupeKeys(record)) {
      const owner = owners.get(key);
      if (owner == null) owners.set(key, index);
      else union(owner, index);
    }
  });
  const groups = new Map<number, WeeklyGrowthRawRecord[]>();
  records.forEach((record, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(record);
    groups.set(root, group);
  });
  return [...groups.values()];
}

function dedupeKeys(record: WeeklyGrowthRawRecord): string[] {
  const keys = [...record.aliasKeys];
  if (record.followUpId) keys.push(`followup:${record.followUpId}`);
  if (record.obligationId) keys.push(`obligation:${record.obligationId}`);
  if (record.customerKey && (record.origin === "churn_snapshot" || record.obligationKind === "dormant_recovery")) {
    keys.push(`customer:${record.customerKey}`);
  }
  if (record.campaignId && (record.origin === "campaign_template" || record.origin === "campaign_run" || record.grounding === "campaign_linked")) {
    keys.push(`campaign:${record.campaignId}`);
  }
  if (record.commitmentId) keys.push(`commitment:${record.commitmentId}`);
  if (record.opsTaskId) keys.push(`ops:${record.opsTaskId}`);
  if (record.runId) keys.push(`run:${record.runId}`);
  if (keys.length === 0) keys.push(`source:${record.origin}:${record.sourceId}`);
  return keys;
}

function toRanked(
  group: WeeklyGrowthRawRecord[],
  input: AssembleWeeklyGrowthCandidatesInput,
  macro: WeeklyGrowthMacroSnapshot | null,
  warmRank: Map<string, number>,
  swingRank: Map<string, number>,
  warmCount: number
): Ranked {
  const authority = [...group].sort((a, b) => {
    const rank = AUTHORITY[a.origin] - AUTHORITY[b.origin];
    if (rank !== 0) return rank;
    if (a.alreadyInFlight !== b.alreadyInFlight) return a.alreadyInFlight ? -1 : 1;
    return a.sourceId.localeCompare(b.sourceId);
  })[0]!;
  const content = CONTENT_PRIORITY.map(origin => group.find(record => record.origin === origin && record.title.trim())).find(Boolean) ?? authority;
  const sourceKind = sourceKindOf(authority.origin)!;
  const motion = motionOf(group, sourceKind);
  const alreadyInFlight = group.some(record => record.alreadyInFlight);
  const prepSource = group.find(record => record.origin === "campaign_template") ?? content;
  const feasible = prepFeasibleWithinHorizon({
    leadDays: prepSource.prepLeadDays,
    today: input.today,
    remainingDates: input.remainingDates,
    alreadyInFlight,
  });
  const dueDate = group.map(record => record.dueDate).filter((date): date is string => Boolean(date)).sort()[0] ?? null;
  const followUpEvidence = group.some(
    record => record.origin === "commercial_follow_up" || record.obligationKind === "sales_follow_up" || record.followUpId != null
  );
  const due = followUpEvidence ? dueClass(dueDate, input.today, input.remainingDates) : 0;
  const recovery = group.find(record => record.origin === "churn_snapshot");
  const assumptions = group.flatMap(record => record.assumptions).sort((a, b) => a.text.localeCompare(b.text) || a.source.localeCompare(b.source));
  const confidence = confidenceOf(authority, recovery);
  const aligned = macro != null && motionAlignsWithMacroGoal(macro.metricKey, motion);
  const reasons = rankReasons({
    sourceKind,
    alreadyInFlight,
    due,
    recovery,
    aligned,
    prepLeadDays: prepSource.prepLeadDays,
    prepCondition: prepSource.prepCondition,
    feasible,
    confidence,
    assumptions: assumptions.length,
  });
  const id = stableId(input.tenantId, group);
  const candidate: WeeklyGrowthCandidate = {
    id,
    sourceKind,
    motion,
    title: content.title,
    objective: content.objective || content.title,
    alreadyInFlight,
    observedDueDate: dueDate,
    sourceRefs: sourceRefs(group),
    provenance: {
      reader: READER_NAME[authority.origin],
      sourceType: authority.origin,
      sourceIds: [...new Set(group.map(record => record.sourceId))].sort(),
      observedAt: input.observedAt,
    },
    prep: {
      leadDays: prepSource.prepLeadDays,
      condition: prepSource.prepCondition,
      feasibleWithinHorizon: feasible,
    },
    fit: {
      pocketKind: prepSource.pocketKind,
      minimumMinutes: prepSource.minimumMinutes,
    },
    observedSignals: signals(group, warmRank, swingRank),
    assumptions,
    confidence,
    rankReasons: reasons,
  };
  const score = recovery ? warmCount - (warmRank.get(recovery.sourceId) ?? 0) : null;
  return {
    candidate,
    sourceClass: SOURCE_CLASS[sourceKind],
    inFlight: alreadyInFlight ? 1 : 0,
    due,
    score,
    prep: feasible ? 1 : 0,
    macro: aligned ? 1 : 0,
    stableId: id,
  };
}

function motionOf(group: WeeklyGrowthRawRecord[], sourceKind: WeeklyGrowthSourceKind): WeeklyGrowthMotion {
  const hinted = CONTENT_PRIORITY.map(origin => group.find(record => record.origin === origin && record.motionHint)).find(Boolean);
  if (hinted?.motionHint) return hinted.motionHint;
  if (sourceKind === "commercial_follow_up") return "commercial_follow_up";
  if (sourceKind === "customer_recovery") return "customer_recovery";
  if (sourceKind === "proactive_obligation") {
    return group.some(record => record.obligationKind === "dormant_recovery") ? "customer_recovery" : "commercial_follow_up";
  }
  return "continue_existing";
}

function dueClass(due: string | null, today: string, remaining: readonly string[]): number {
  if (!due) return 0;
  if (due < today) return 2;
  if (due === today || remaining.includes(due)) return 1;
  return 0;
}

function confidenceOf(
  authority: WeeklyGrowthRawRecord,
  recovery: WeeklyGrowthRawRecord | undefined
): "low" | "medium" | "high" {
  if (recovery?.confidence) return recovery.confidence;
  if (authority.confidence) return authority.confidence;
  if (authority.origin === "campaign_template") return "low";
  if (authority.origin === "proactive_obligation") return "medium";
  return "high";
}

function rankReasons(input: {
  sourceKind: WeeklyGrowthSourceKind;
  alreadyInFlight: boolean;
  due: number;
  recovery: WeeklyGrowthRawRecord | undefined;
  aligned: boolean;
  prepLeadDays: number;
  prepCondition: string | null;
  feasible: boolean;
  confidence: "low" | "medium" | "high";
  assumptions: number;
}): WeeklyGrowthRankReason[] {
  const selected = new Set<WeeklyGrowthRankReason>();
  if (input.sourceKind === "unfinished_growth_work" || input.alreadyInFlight) selected.add("CONTINUE_EXISTING_WORK");
  if (input.due === 2 && (input.sourceKind === "commercial_follow_up" || input.sourceKind === "proactive_obligation" || input.sourceKind === "unfinished_growth_work")) {
    selected.add("FOLLOW_UP_OVERDUE");
  }
  if (input.due === 1 && (input.sourceKind === "commercial_follow_up" || input.sourceKind === "proactive_obligation" || input.sourceKind === "unfinished_growth_work")) {
    selected.add("FOLLOW_UP_DUE");
  }
  if (input.sourceKind === "proactive_obligation") selected.add("PROACTIVE_OBLIGATION_ACTIVE");
  if (input.recovery && isDealable(toLever(input.recovery))) {
    selected.add("HIGH_CHURN_PRIORITY");
    selected.add("STRONG_CUSTOMER_HISTORY");
  }
  if (input.aligned) selected.add("MACRO_GOAL_ALIGNED");
  if (input.sourceKind === "campaign_library") selected.add("CAMPAIGN_ENABLED");
  if (input.prepLeadDays > 0 || input.prepCondition) selected.add("PREP_REQUIRED");
  if (!input.feasible) selected.add("INSUFFICIENT_PREP");
  if (input.confidence === "low" || input.assumptions > 0) selected.add("LOW_CONFIDENCE_ASSUMPTION");
  return WEEKLY_GROWTH_RANK_REASONS.filter(code => selected.has(code));
}

function stableId(tenantId: string, group: WeeklyGrowthRawRecord[]): string {
  const follow = group.find(record => record.followUpId);
  if (follow?.followUpId) return `wgc:${tenantId}:followup:${follow.followUpId}`;
  const obligation = group.find(record => record.obligationId);
  if (obligation?.obligationId) return `wgc:${tenantId}:obligation:${obligation.obligationId}`;
  const customer = group.find(record => record.origin === "churn_snapshot" && record.customerKey);
  if (customer?.customerKey) return `wgc:${tenantId}:customer:${customer.customerKey}`;
  const campaign = group.find(record => record.campaignId);
  if (campaign?.campaignId) return `wgc:${tenantId}:campaign:${campaign.campaignId}`;
  const first = [...group].sort((a, b) => `${a.origin}:${a.sourceId}`.localeCompare(`${b.origin}:${b.sourceId}`))[0]!;
  return `wgc:${tenantId}:${first.origin}:${first.sourceId}`;
}

function sourceRefs(group: WeeklyGrowthRawRecord[]): WeeklyGrowthSourceRef[] {
  return group
    .map(record => ({
      sourceKind: sourceKindOf(record.origin)!,
      sourceType: record.origin,
      sourceId: record.sourceId,
    }))
    .filter(ref => ref.sourceKind)
    .sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.sourceId.localeCompare(b.sourceId));
}

function signals(
  group: WeeklyGrowthRawRecord[],
  warmRank: Map<string, number>,
  swingRank: Map<string, number>
): WeeklyGrowthCandidate["observedSignals"] {
  const signalsOut: WeeklyGrowthCandidate["observedSignals"] = [];
  for (const record of group) {
    if (record.origin !== "churn_snapshot") continue;
    const push = (label: string, value: string) => {
      signalsOut.push({
        label,
        value,
        source: "customer_churn_snapshot",
        sourceIds: [record.sourceId],
      });
    };
    if (record.existingScore != null) push("churn_score", String(record.existingScore));
    if (record.historyOrderCount != null) push("history_order_count", String(record.historyOrderCount));
    if (record.daysSinceLastOrder != null) push("days_since_last_paid_order", String(record.daysSinceLastOrder));
    if (record.averageOrderValueCents != null) push("average_order_value_cents", String(record.averageOrderValueCents));
    const warm = warmRank.get(record.sourceId);
    const swing = swingRank.get(record.sourceId);
    if (warm != null) push("warm_lever_rank", String(warm));
    if (swing != null) push("big_swing_lever_rank", String(swing));
  }
  signalsOut.sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
  return signalsOut;
}

function compareRanked(a: Ranked, b: Ranked): number {
  if (a.sourceClass !== b.sourceClass) return a.sourceClass - b.sourceClass;
  if (a.inFlight !== b.inFlight) return b.inFlight - a.inFlight;
  if (a.due !== b.due) return b.due - a.due;
  if (a.score !== b.score) {
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return b.score - a.score;
  }
  if (a.prep !== b.prep) return b.prep - a.prep;
  if (a.macro !== b.macro) return b.macro - a.macro;
  return a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0;
}

function macroMetric(source: SourceAvailability<WeeklyGrowthMacroSnapshot>): WeeklyGrowthMacroSnapshot | null {
  if (source.status !== "available") return null;
  return source.records[0] ?? null;
}
