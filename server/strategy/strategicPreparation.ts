import { investigateForPreparation } from "../analytics/analysis/proactiveInvestigation";
import type { WeeklyProductionPlan } from "../../shared/strategicIntelligence";
import { loadMissionPresentations, presentationFor } from "../agents/daphne/missionFollowUp";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "./snapshotBuilder";
import { formatInTimeZone } from "date-fns-tz";
import {
  actionableDates,
  strategicPlanningHorizon,
  targetWeekHorizon,
} from "../../shared/weeklyMissionReadiness";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";
import type { CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
import { invalidateUnresolvedTemplateGeography } from "./geographyRemediation";
import { reviewStrategicQuality } from "./strategicQualityReview";
import { assembleStrategicDiagnosis } from "./strategicDiagnosis";
import { readStrategicDiagnosisInputs } from "./strategicEvidenceReaders";
import {
  latestStrategicProposal,
  strategicResponses,
  latestStrategicDiagnosis,
  persistStrategicDiagnosis,
  persistStrategicProposal,
} from "./strategicStore";
import { planForDate } from "../planning/missionDirector/missionDirectorService";
import { readWeeklyDossierFacts } from "../claire/weeklyMission/productionReaders";
import type { VerticalRegistry } from "./verticalTemplates/registry";
import type { StrategicDiagnosis } from "../../shared/strategicIntelligence";
import type { MissionWorkSelection } from "../../shared/missionDirector";
import { workThreadCandidateId, workThreadOpportunityKey } from "../../shared/workThread";
import {
  resolveCandidateWorkThread,
  resolveWorkThread,
} from "../agents/persistentOperator/workThreadStore";
import { and, eq, inArray, sql } from "drizzle-orm";
import { dayDirectorCommitments } from "../../drizzle/schema";
import { readDayLineOverlay } from "../../shared/goldlineDayLine";
import { getDb } from "../db";

/**
 * Whether the operator already has open, approved Day Line work on this
 * thread. While that execution is open the opportunity is not proposed again;
 * the commitment itself carries the work forward.
 */
async function workThreadInFlight(identity: CanonicalOperatorIdentity, workThreadId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Durable proposal database unavailable");
  const rows = await db
    .select({ metadataJson: dayDirectorCommitments.metadataJson })
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, identity.tenantId),
        inArray(dayDirectorCommitments.actorId, identity.dayDirectorActorIds),
        eq(dayDirectorCommitments.status, "open"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${dayDirectorCommitments.metadataJson}, '$.workThread.id')) = ${workThreadId}`
      )
    );
  return rows.some(row => {
    const overlay = readDayLineOverlay(row.metadataJson);
    return !overlay.cancelledAt && !overlay.notPursuing;
  });
}

/**
 * Each opportunity in the diagnosis resolves to its durable Work Thread, keyed
 * by opportunity. Wording, the customers named this hour and the diagnosis id
 * play no part, so an hourly re-diagnosis lands on the same thread.
 */
async function resolveDiagnosisWorkThreads(
  d: StrategicDiagnosis,
  identity: CanonicalOperatorIdentity,
  now: Date
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const action of d.actions) {
    if (!action.opportunity) continue;
    const thread = await resolveWorkThread({
      tenantId: identity.tenantId,
      opportunity: action.opportunity,
      title: action.title,
      sourceRef: `strategic_diagnosis:${d.businessDate}`,
      canonicalOperatorId: identity.canonicalOperatorId,
      now,
    });
    ids[workThreadOpportunityKey(action.opportunity)] = thread.id;
  }
  return ids;
}

const threadIdsOf = (d: StrategicDiagnosis) => d.actions.map(a => a.workThreadId ?? null);

/** The open Work Thread Mission Director's selected work continues, if one can be established without guessing. */
async function rankedWorkThreadId(
  identity: CanonicalOperatorIdentity,
  primary: MissionWorkSelection,
  now: Date
): Promise<string | undefined> {
  const resolved = await resolveCandidateWorkThread({
    tenantId: identity.tenantId,
    candidate: { id: primary.workId, title: primary.title, sourceKind: primary.sourceKind, workThreadId: primary.workThreadId },
    canonicalOperatorId: identity.canonicalOperatorId,
    now,
  });
  return resolved.status === "resolved" ? resolved.thread.id : undefined;
}

export async function refreshStrategicDiagnosis(input: {
  identity: CanonicalOperatorIdentity;
  timeZone: string;
  now?: Date;
  registry?: VerticalRegistry;
}) {
  const now = input.now ?? new Date();
  const businessDate = formatInTimeZone(now, input.timeZone, "yyyy-MM-dd");
  const prior = await latestStrategicDiagnosis(input.identity, businessDate);
  const registry = input.registry ?? defaultVerticalRegistry;
  const facts = await readStrategicDiagnosisInputs({
    ...input,
    now,
    businessDate,
    registry,
  });
  // Model-selected research enriches preparation as hypothesis evidence. Existing metric and ranking authority stays intact.
  // Reuse a receipt for an hour so scheduled calls do not repeatedly pay for research.
  // A missing receipt is not reused: the first failure must not hide the source-backed read.
  const priorResearch =
    prior?.evidence.filter(e => e.source === "analyzeBusinessData") ?? [];
  const reuseResearch =
    Boolean(prior) &&
    now.getTime() - Date.parse(prior!.generatedAt) < 3600000 &&
    priorResearch.length > 0;
  if (reuseResearch) {
    facts.evidence.push(...priorResearch);
  } else {
    const research = await investigateForPreparation({
      tenantId: input.identity.tenantId,
      objective: facts.focus?.statement ?? facts.goal.statement,
      now,
      timeZone: input.timeZone,
    });
    if (research) {
      facts.evidence.push({
        id: `business_analysis:${research.citedReceiptIds.join(":")}`,
        tenantId: input.identity.tenantId,
        source: "analyzeBusinessData",
        capturedAt: now.toISOString(),
        classification: "hypothesis",
        value: research.answer,
        unit: "analytical_interpretation",
        quality: "partial",
        description: [research.answer, ...research.limitations].join(" "),
      });
    }
  }
  let diagnosis = assembleStrategicDiagnosis(facts, registry);
  // Stamp each action with its Work Thread before the diagnosis is identified
  // and stored. Reassembly is pure, so the opportunities are the same ones.
  const workThreadIds = await resolveDiagnosisWorkThreads(diagnosis, input.identity, now);
  if (Object.keys(workThreadIds).length)
    diagnosis = assembleStrategicDiagnosis({ ...facts, workThreadIds }, registry);
  const content = (d: typeof diagnosis) => {
    // What the diagnosis took from the operating mandate. The mandate's own
    // revision moves with every commitment and thread, so it is left out.
    const { revision: _revision, ...fromMandate } = d.mandate ?? { revision: "" };
    void _revision;
    return canonicalJsonStringify({
      verticalKey: d.verticalKey,
      doctrineVersion: d.doctrineVersion,
      goal: d.goal,
      evidence: d.evidence.map(({ id, capturedAt, ...e }) => e),
      market: d.market,
      constraint: d.primaryConstraint,
      diagnosis: d.diagnosis,
      outcomes: d.outcomeRefs,
      uncertainty: d.uncertainty,
      mandate: d.mandate ? fromMandate : null,
      objective: d.objective ?? null,
    });
  };
  if (
    prior &&
    now.getTime() >= Date.parse(prior.generatedAt) &&
    now.getTime() - Date.parse(prior.generatedAt) < 3600000 &&
    content(prior) === content(diagnosis) &&
    JSON.stringify(threadIdsOf(prior)) === JSON.stringify(threadIdsOf(diagnosis))
  )
    return prior;
  diagnosis.quality = await reviewStrategicQuality(diagnosis);
  return persistStrategicDiagnosis(diagnosis);
}

/** Per-day limitation lines, as prepareStrategicProposal adds them to `uncertainty`. */
const LIMITATION_LINE = /^\d{4}-\d{2}-\d{2}: /;

/**
 * Pure: whether a newly prepared proposal would ask the operator to decide the same
 * thing as the open one. Ids derived from a diagnosis are ignored (every re-diagnosis
 * mints new ones); dates, titles, objectives, types, timing and constraints are not.
 */
export function proposalDecisionUnchanged(
  current: Pick<StrategicPlanningProposal, "businessDate" | "expiresAt" | "items" | "constraints" | "uncertainty">,
  next: {
    businessDate: string;
    items: StrategicPlanningProposal["items"];
    constraints: string[];
    limitations: string[];
  },
  now: Date
): boolean {
  if (current.businessDate !== next.businessDate) return false;
  if (Date.parse(current.expiresAt) <= now.getTime()) return false;
  const decision = (items: StrategicPlanningProposal["items"]) =>
    canonicalJsonStringify(
      items.map(i => ({
        businessDate: i.businessDate,
        title: i.title,
        objective: i.objective,
        executionType: i.executionType,
        missionType: i.missionType ?? null,
        window: i.timeWindow?.window ?? null,
        source: i.planId.startsWith("strategic_diagnosis:") ? "strategy" : i.candidateId,
        workThreadId: i.workThreadId ?? null,
      }))
    );
  const limitations = (current.uncertainty ?? []).filter(line => LIMITATION_LINE.test(line));
  return (
    decision(current.items) === decision(next.items) &&
    canonicalJsonStringify(current.constraints) === canonicalJsonStringify(next.constraints) &&
    canonicalJsonStringify(limitations) === canonicalJsonStringify(next.limitations)
  );
}

/** Existing autonomous evaluator and appointment executor share this preparation.
 * The proposal is immutable. Neither preparing nor presenting it approves work. */
export async function prepareStrategicProposal(input: {
  identity: CanonicalOperatorIdentity;
  timeZone: string;
  now?: Date;
  weekStart?: string;
}): Promise<StrategicPlanningProposal> {
  const now = input.now ?? new Date();
  const identity = input.identity;
  await invalidateUnresolvedTemplateGeography(identity.tenantId);
  const businessDate = formatInTimeZone(now, input.timeZone, "yyyy-MM-dd");
  const localTime = formatInTimeZone(now, input.timeZone, "HH:mm");
  const horizon = input.weekStart
    ? targetWeekHorizon({ businessDate, localTime, weekStart: input.weekStart })
    : strategicPlanningHorizon({ businessDate, localTime });
  // New work is never dated to a business day whose useful window has closed.
  const planDates = actionableDates(horizon);
  const diagnosis = await refreshStrategicDiagnosis({
    identity,
    timeZone: input.timeZone,
    now,
  });
  const operatorIds = [
    ...new Set([
      identity.canonicalOpenId,
      ...identity.aliases.map(a => a.openId),
    ]),
  ];
  const facts = await readWeeklyDossierFacts({
    tenantId: identity.tenantId,
    operatorId: identity.weeklyOperatorId,
    operatorUserIds: operatorIds,
    dayDirectorActorId: identity.dayDirectorActorId,
    dayDirectorActorIds: identity.dayDirectorActorIds,
    dates: planDates,
    now,
    timeZone: input.timeZone,
  });
  const items: StrategicPlanningProposal["items"] = [];
  const seen = new Set<string>();
  const limitations: string[] = [];
  // Claire's selected recommendation becomes the first proposed mission, with
  // provenance to the diagnosis. Mission Director's ranked work fills later days,
  // so stale unrelated follow-ups cannot displace the current strategic priority.
  const selectedAction = diagnosis.actions[0];
  const strategyDate = planDates[0];
  // The strategy item names its Work Thread, and its candidate id is the one
  // the goal cycle selects, so approval binds to the thread's open objective.
  // An opportunity whose approved execution is still open is not proposed again.
  const strategyThreadId = selectedAction?.workThreadId;
  const strategyInFlight = strategyThreadId ? await workThreadInFlight(identity, strategyThreadId) : false;
  if (strategyInFlight && strategyDate)
    limitations.push(`${strategyDate}: "${selectedAction!.title}" is already approved and still open on the Day Line`);
  const strategyItem =
    selectedAction && strategyDate && !diagnosis.quality.structuralErrors.length && !strategyInFlight
      ? {
          id: `${strategyDate}:${diagnosis.id}:${selectedAction.id}`,
          businessDate: strategyDate,
          title: selectedAction.title,
          objective: selectedAction.completionCondition,
          executionType: "challenge" as const,
          candidateId: strategyThreadId
            ? workThreadCandidateId(strategyThreadId)
            : `${diagnosis.id}:${selectedAction.id}`,
          missionType: selectedAction.motion,
          planId: `strategic_diagnosis:${diagnosis.id}`,
          planRevision: 0,
          evidenceRefs: [`strategic_diagnosis:${diagnosis.id}`, ...diagnosis.supportingEvidence],
          ...(strategyThreadId ? { workThreadId: strategyThreadId } : {}),
          ...(selectedAction.targets?.length ? { customerTargets: selectedAction.targets } : {}),
          ...(selectedAction.observationWindowDays ? { observationWindowDays: selectedAction.observationWindowDays } : {}),
        }
      : null;
  if (strategyItem) {
    items.push(strategyItem);
    seen.add(strategyItem.candidateId);
  }
  for (const date of planDates) {
    if (strategyItem && date === strategyItem.businessDate) continue;
    const plan = await planForDate({
      tenantId: identity.tenantId,
      operatorId: identity.dayDirectorActorId,
      operatorIds: identity.dayDirectorActorIds,
      operatorUserId: identity.canonicalOpenId,
      operatorUserIds: operatorIds,
      businessDate: date,
      timeZone: input.timeZone,
    });
    const work = plan.outcome.workPlan;
    if (work?.status !== "ranked") {
      limitations.push(`${date}: ${work?.status ?? "ranking unavailable"}`);
      continue;
    }
    // Take only Mission Director's winner. Repeating the same work on each
    // weekday does not create five independent recommendations.
    if (seen.has(work.primary.workId)) continue;
    seen.add(work.primary.workId);
    if (
      work.primary.executionType !== "mission" &&
      work.primary.executionType !== "challenge"
    )
      continue;
    const workThreadId = await rankedWorkThreadId(identity, work.primary, now);
    items.push({
      id: `${date}:${work.primary.workId}`,
      businessDate: date,
      title: work.primary.title,
      objective: work.primary.completionCondition || work.primary.objective,
      executionType: work.primary.executionType,
      candidateId: work.primary.workId,
      missionType: work.primary.motion ?? work.primary.sourceKind,
      planId: plan.id,
      planRevision: plan.revision,
      evidenceRefs: [
        `mission_director_plan:${plan.id}:revision:${plan.revision}`,
        ...diagnosis.supportingEvidence,
      ],
      ...(workThreadId ? { workThreadId } : {}),
    });
  }
  // Daphne's consented, operator-wide timing preference shapes proposed timing.
  const presentations = await loadMissionPresentations({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
  }).catch(() => new Map());
  for (const item of items) {
    const p = presentationFor(presentations, item.missionType ?? "growth") as
      | { adjustment: { kind: string; window?: "morning" | "afternoon" | "evening" }; note: string; sourceObservationId: string }
      | undefined;
    if (p?.adjustment.kind === "timing" && p.adjustment.window)
      item.timeWindow = { window: p.adjustment.window, reason: p.note, sourceObservationId: p.sourceObservationId };
  }
  const constraints = facts
    .filter(
      f =>
        f.scheduleLabel ||
        [
          "day_director_commitment",
          "external_promise",
          "recurrence_rule",
        ].includes(f.class)
    )
    .map(
      f =>
        `${f.businessDate ?? f.weekday ?? ""}: ${f.title}${f.scheduleLabel ? ` ${f.scheduleLabel}` : ""} [${f.id}]`
    );
  const weeklyPlan = buildWeeklyProductionPlan({
    diagnosis,
    items,
    planDates,
    constraints,
    adaptations: [...presentations.values()].map((p: { note: string }) => p.note),
  });
  const current = await latestStrategicProposal(identity, horizon.weekStart);
  const decisions = current ? await strategicResponses(identity, current.id) : [];
  const closedGeneration = decisions.some(r => ["reject", "defer", "revise"].includes(r.action))
    ? [current!.id, ...decisions.map(r => r.id).sort()] : null;
  // The hourly re-diagnosis mints a new diagnosis id even when the recommendation is
  // the same, and approval requires the exact revision. Keep the open proposal while
  // what the operator would decide on is unchanged, so an approval never races it.
  if (
    current &&
    !closedGeneration &&
    proposalDecisionUnchanged(current, { businessDate, items, constraints, limitations }, now)
  )
    return current;
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        identity: identity.canonicalOperatorId,
        businessDate,
        weekStart: horizon.weekStart,
        diagnosisId: diagnosis.id,
        items,
        constraints,
        limitations,
        closedGeneration,
      })
    )
    .digest("hex");
  const p: StrategicPlanningProposal = {
    id: `proposal_${revision.slice(0, 40)}`,
    schemaVersion: 1,
    revision,
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    operatorUserId: identity.canonicalOpenId,
    dayDirectorActorId: identity.dayDirectorActorId,
    weekStart: horizon.weekStart,
    businessDate,
    timeZone: input.timeZone,
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 3600000).toISOString(),
    diagnosis,
    items,
    constraints,
    uncertainty: [
      ...diagnosis.uncertainty,
      `Strategic quality review: ${diagnosis.quality.judgment}. ${diagnosis.quality.reasons.join(" ")} Financial impact is unproven.`,
      ...limitations,
    ],
    approvalState: "pending",
    weeklyPlan,
    opening: [
      diagnosis.currentCondition,
      diagnosis.diagnosis,
      `This is a strategic hypothesis. Quality review: ${diagnosis.quality.judgment}; financial impact is unproven.`,
      `I recommend: ${diagnosis.selectedApproach}.`,
      `I also considered: ${diagnosis.options[1]?.approach}.`,
      items.length
        ? `I prepared ${items.length} proposed item${items.length === 1 ? "" : "s"}: ${items.map(i => `${i.businessDate}${i.timeWindow ? ` (${i.timeWindow.window})` : ""}, ${i.title}`).join("; ")}.${
            items.some(i => i.timeWindow) ? ` I proposed the ${items.find(i => i.timeWindow)!.timeWindow!.window} because of what you told me about your timing.` : ""
          }`
        : "No eligible work was selected within the operating constraints.",
      "These are pending recommendations. Approve selected items, revise, reject, defer, or ask why.",
    ].join(" "),
  };
  return persistStrategicProposal(p);
}

/** Pure: the week's throughline, sequence, preparation and contingency, from the plan inputs only. */
export function buildWeeklyProductionPlan(input: {
  diagnosis: StrategicPlanningProposal["diagnosis"];
  items: StrategicPlanningProposal["items"];
  planDates: string[];
  constraints: string[];
  adaptations: string[];
}): WeeklyProductionPlan {
  const d = input.diagnosis;
  const selected = d.options.find(o => o.id === d.selectedOptionId);
  const action = d.actions[0];
  const motion = action?.motion;
  const preparation =
    motion === "retention"
      ? ["Decide the return offer you'll make before contacting anyone.", "Keep the named customer list from the mission at hand."]
      : motion === "account_acquisition"
        ? ["Choose the building or account and note its address before going out."]
        : [];
  const used = new Set(input.items.map(i => i.businessDate));
  const buffer = input.planDates.filter(date => !used.has(date));
  return {
    // A remark from conversation shapes where the work happens; it is never
    // presented as the operator's objective in place of their confirmed goal.
    objective:
      d.objective && d.objective.confirmation !== "inferred"
        ? d.objective.statement
        : d.objective
          ? `${d.goal.statement} (starting in ${d.objective.area})`
          : d.goal.statement,
    outcomes: [action?.leadingIndicator, ...d.successMeasures].filter((x): x is string => Boolean(x)).slice(0, 3),
    evidence: selected?.observedBasis ?? d.currentCondition,
    sequence: input.items.map(i => ({
      date: i.businessDate,
      itemId: i.id,
      title: i.title,
      window: i.timeWindow?.window ?? null,
      why: i.planId.startsWith("strategic_diagnosis:")
        ? (selected?.reason ?? d.diagnosis).replace(/^(Preferred|Not preferred[^:]*):\s*/i, "")
        : "Existing work ranked by Mission Director.",
      status: "draft",
    })),
    preparation,
    commitments: input.constraints.slice(0, 10),
    contingency: buffer.length
      ? `Kept ${buffer.join(", ")} open as buffer for whatever comes up.`
      : "No buffer day this week; if something comes up, I'll move the lowest-priority item and tell you.",
    adaptations: input.adaptations,
    uncertainty: d.uncertainty.filter(u => /Profitability|Why these customers|payment|Return rate/i.test(u)).slice(0, 4),
    changes: [],
  };
}
