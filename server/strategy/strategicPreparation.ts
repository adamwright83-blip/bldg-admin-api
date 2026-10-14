import { loadMissionPresentations, presentationFor } from "../agents/daphne/missionFollowUp";
import { createHash } from "node:crypto";
import { canonicalJsonStringify } from "./snapshotBuilder";
import { formatInTimeZone } from "date-fns-tz";
import {
  remainingWeekHorizon,
  targetWeekHorizon,
  addDaysYmd,
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
  const diagnosis = assembleStrategicDiagnosis(facts, registry);
  const content = (d: typeof diagnosis) =>
    canonicalJsonStringify({
      verticalKey: d.verticalKey,
      doctrineVersion: d.doctrineVersion,
      goal: d.goal,
      evidence: d.evidence.map(({ id, capturedAt, ...e }) => e),
      market: d.market,
      constraint: d.primaryConstraint,
      diagnosis: d.diagnosis,
      outcomes: d.outcomeRefs,
      uncertainty: d.uncertainty,
    });
  if (
    prior &&
    now.getTime() >= Date.parse(prior.generatedAt) &&
    now.getTime() - Date.parse(prior.generatedAt) < 3600000 &&
    content(prior) === content(diagnosis)
  )
    return prior;
  diagnosis.quality = await reviewStrategicQuality(diagnosis);
  return persistStrategicDiagnosis(diagnosis);
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
    : Number(formatInTimeZone(now, input.timeZone, "i")) >= 6
      ? targetWeekHorizon({
          businessDate,
          localTime,
          weekStart: addDaysYmd(
            businessDate,
            8 - Number(formatInTimeZone(now, input.timeZone, "i"))
          ),
        })
      : remainingWeekHorizon({ businessDate, localTime });
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
    dates: horizon.remainingDates,
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
  const strategyDate = horizon.remainingDates[0];
  const strategyItem =
    selectedAction && strategyDate && !diagnosis.quality.structuralErrors.length
      ? {
          id: `${strategyDate}:${diagnosis.id}:${selectedAction.id}`,
          businessDate: strategyDate,
          title: selectedAction.title,
          objective: selectedAction.completionCondition,
          executionType: "challenge" as const,
          candidateId: `${diagnosis.id}:${selectedAction.id}`,
          missionType: selectedAction.motion,
          planId: `strategic_diagnosis:${diagnosis.id}`,
          planRevision: 0,
          evidenceRefs: [`strategic_diagnosis:${diagnosis.id}`, ...diagnosis.supportingEvidence],
        }
      : null;
  if (strategyItem) {
    items.push(strategyItem);
    seen.add(strategyItem.candidateId);
  }
  for (const date of horizon.remainingDates) {
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
  const current = await latestStrategicProposal(identity, horizon.weekStart);
  const decisions = current ? await strategicResponses(identity, current.id) : [];
  const closedGeneration = decisions.some(r => ["reject", "defer", "revise"].includes(r.action))
    ? [current!.id, ...decisions.map(r => r.id).sort()] : null;
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
