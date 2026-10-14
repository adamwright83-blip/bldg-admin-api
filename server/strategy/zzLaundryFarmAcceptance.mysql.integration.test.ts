import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { resolveCanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { prepareStrategicProposal } from "./strategicPreparation";
import { respondToStrategicProposal } from "./strategicApproval";
import { assembleClaireDriveContext } from "../claire/contextAssembler";
import { claireConversationStateStore } from "../claire/turn/conversationStateStore";
import { issueClaireToken } from "../claire/claireToken";
import { runAuthoritativeClaireVoiceTurn } from "../claire/claireTwilio";
import { newWeeklySession, saveWeeklySession } from "../claire/weeklyMission/session";
import { emptyDraft, remainingWeekHorizon } from "../../shared/weeklyMissionReadiness";
import { getDayDirectorState } from "../planning/dayDirector/dayDirectorService";
import { answerMissionFollowUp, syncMissionFollowUp } from "../agents/daphne/missionFollowUp";
import { buildDayPlanProjection } from "../../client/src/pages/driver/goldlineDayPlanModel";
import { addDaysYmd } from "../analytics/businessPeriods";
import { getDashboardTimeZone } from "../dashboardZoned";
import { getDb } from "../db";
import { daphneObservations } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";

it("Laundry Farm production-copy acceptance (objective loop)", async () => {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { out[name] = await fn(); } catch (e) { out[name] = { ERROR: e instanceof Error ? `${e.message}\n${e.stack?.split("\n").slice(1, 4).join("\n")}` : String(e) }; }
  };
  const tenantId = "default", operator = "adam-admin", zone = getDashboardTimeZone();
  const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operator }, subsystem: "lf_acceptance" });
  if (!resolved.ok) throw new Error("identity");
  const identity = resolved.identity;
  const now = new Date();
  const today = formatInTimeZone(now, zone, "yyyy-MM-dd");
  const stateFor = (businessDate: string) => getDayDirectorState({ tenantId, actorId: identity.dayDirectorActorId, actorIds: identity.dayDirectorActorIds, canonicalOperatorId: identity.canonicalOperatorId, businessDate });

  // 1–3. Objective-aware diagnosis and proposal from real data.
  const proposal = await prepareStrategicProposal({ identity, timeZone: zone, now });
  const d = proposal.diagnosis;
  out.diagnosis = { objective: d.objective, constraint: d.primaryConstraint, condition: d.currentCondition, diagnosis: d.diagnosis, selected: d.selectedApproach,
    options: d.options.map(o => ({ approach: o.approach, reason: o.reason, benefit: o.expectedBenefit, next: o.nextMeasurableAction })), uncertainty: d.uncertainty };
  out.proposal = { opening: proposal.opening, items: proposal.items.map(i => ({ date: i.businessDate, title: i.title, objective: i.objective, missionType: i.missionType, timeWindow: i.timeWindow ?? null })) };

  // Real Claire conversation (real model).
  await step("conversation", async () => {
    const context = await assembleClaireDriveContext({ tenantId, actorId: operator, phase: "pre_drive", timeZone: zone });
    const draft = emptyDraft(remainingWeekHorizon({ businessDate: today, localTime: formatInTimeZone(now, zone, "HH:mm") }), []);
    draft.pendingRecommendation = { proposalId: proposal.id, revision: proposal.revision, opening: proposal.opening };
    const session = newWeeklySession({ tenantId, operatorId: operator, dayDirectorActorId: identity.dayDirectorActorId, weekStart: proposal.weekStart, draft });
    session.phase = "awaiting_confirmation";
    await saveWeeklySession(session);
    const conversationId = randomUUID();
    let conversation: any = { tenantId, actorId: operator, dayDirectorActorId: identity.dayDirectorActorId, brief: proposal.opening, context, turns: 0, touchedAt: Date.now(),
      sessionKind: "weekly_planning", weeklyPlanningWeekStart: proposal.weekStart, strategicProposalId: proposal.id, appointmentTimeZone: zone, inboundContextReady: true,
      history: [{ speaker: "claire", text: proposal.opening, at: Date.now() }] };
    await claireConversationStateStore().save(`claire-call:${conversationId}`, { tenantId, operatorUserId: operator, surface: "voice" }, conversation, 3600000);
    const token = issueClaireToken({ kind: "pre_drive_conversation", tenantId, userId: operator, conversationId });
    const turns: Array<{ operator: string; claire: string }> = [];
    for (const utterance of [
      "My objective is to increase profitable Laundry Farm sales in Silver Lake. What's happening there and what should I do this week?",
      "How many dormant customers are in Silver Lake?",
      "Why that, and not just going after new customers?",
    ]) {
      const result: any = await runAuthoritativeClaireVoiceTurn({ conversationId, conversation, utterance, rawTranscript: utterance, allowFragmentWait: false, token,
        sourceConfirmed: true, sourceEventId: `lf-${randomUUID()}`, webhookReceivedAtMs: Date.now() });
      const raw = typeof result === "string" ? result : JSON.stringify(result);
      const speak = /"speak":"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1]?.replace(/\\n/g, " ").replace(/\\"/g, '"') ?? raw.slice(0, 700);
      turns.push({ operator: utterance, claire: speak });
      const stored = await claireConversationStateStore().load<any>(`claire-call:${conversationId}`);
      conversation = stored?.state ?? conversation;
    }
    return turns;
  });

  // 4. Approval of Claire's recommendation → Day Line / Driver.
  const item = proposal.items[0]!;
  let commitmentId = "";
  await step("approval", async () => {
    const r = await respondToStrategicProposal({ identity, proposalId: proposal.id, revision: proposal.revision, action: "approve", itemIds: [item.id], source: "authenticated_app" });
    commitmentId = r.actionIds[0] ?? "";
    return r.speech;
  });
  await step("dayLine", async () => (await stateFor(item.businessDate)).commitments.filter(c => c.id === commitmentId).map(c => ({ title: c.title, sourceText: c.sourceText, missionType: c.missionType, presentation: c.presentation })));

  // 5–6. Next day: follow-up about this mission; natural-language explanation; durable observation.
  const nextDay = addDaysYmd(item.businessDate, 1);
  const scope = { tenantId, canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: identity.canonicalOpenId, actorIds: identity.dayDirectorActorIds };
  let followUp: any = null;
  await step("followUp", async () => (followUp = await syncMissionFollowUp({ ...scope, today: nextDay })));
  await step("explanation", async () => answerMissionFollowUp({ ...scope, commitmentId: followUp.commitmentId, answer: "I ran out of time; afternoons are too busy." }));
  await step("durableObservations", async () => {
    const db = (await getDb())!;
    const rows = await db.select().from(daphneObservations).where(and(eq(daphneObservations.tenantId, tenantId), eq(daphneObservations.sourceType, "daphne_mission_presentation")));
    return rows.map(r => ({ id: r.id, kind: r.observationKind, channel: r.evidenceChannel, payload: r.payloadJson }));
  });

  // 7. Next missions adapt across sources: next proposal timing + a different-source mission + Driver presentation.
  await step("nextProposal", async () => {
    const next = await prepareStrategicProposal({ identity, timeZone: zone, now: new Date() });
    const other = next.items.find(i => i.missionType !== item.missionType) ?? next.items[next.items.length - 1]!;
    const r = await respondToStrategicProposal({ identity, proposalId: next.id, revision: next.revision, action: "approve", itemIds: [other.id], source: "authenticated_app" });
    const s = await stateFor(other.businessDate);
    const c = s.commitments.find(x => x.id === r.actionIds[0]);
    const driver = buildDayPlanProjection({ businessDate: other.businessDate, commitments: c ? [c] : [], now: new Date() } as never);
    const stop = driver.stops.find(st => st.id === `commitment-${c?.id}`);
    return { opening: next.opening, items: next.items.map(i => ({ date: i.businessDate, title: i.title, missionType: i.missionType, timeWindow: i.timeWindow?.window ?? null })),
      approvedOtherSource: { title: other.title, missionType: other.missionType, dayLinePresentation: c?.presentation ?? null },
      driverStop: stop ? { title: stop.title, timeLabel: stop.timeLabel, detail: stop.displayDetail } : null };
  });
  await step("explainedItemCarried", async () => (await stateFor(item.businessDate)).commitments.filter(c => c.id === commitmentId).map(c => c.presentation));
  await writeFile(process.env.OUT!, JSON.stringify(out, null, 2));
}, 600000);
