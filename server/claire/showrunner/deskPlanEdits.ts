import { parseSpokenNumber } from "../../analytics/businessPeriods";
import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import { latestStrategicProposal, persistStrategicProposal, strategicResponses } from "../../strategy/strategicStore";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import type { StrategicPlanningProposal, StrategicProposalItem } from "../../../shared/strategicIntelligence";
import { dateFromOperatorWords, identityForShowrunner } from "./showrunnerDebrief";
import type { ShowrunnerCallState } from "./showrunnerTurn";

/** One explicit change the operator asked for on OPEN COMMS. */
export type DeskPlanEdit = {
  itemId: string;
  action: "retime" | "hold" | "analysis_contact";
  /** YYYY-MM-DD the operator named, or "" to keep the item's own day. */
  date: string;
  time: string;
  window: "morning" | "afternoon" | "evening" | "none";
  operatorWords: string;
};

type Window = "morning" | "afternoon" | "evening";

export function windowForTime(time: string, stated: DeskPlanEdit["window"]): Window {
  if (stated !== "none") return stated;
  return time < "12:00" ? "morning" : time < "17:00" ? "afternoon" : "evening";
}

/** Pure: "10:00" → "10 AM", "14:30" → "2:30 PM". */
export function spokenTime(time: string): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Applies desk edits as a new pending proposal revision. Draft items are retimed
 * or held in place; an approved Day Line commitment is retimed only through a
 * replacement item that supersedes it on approval. Nothing here commits work:
 * returned itemIds are the exact scope an unambiguous yes may approve.
 */
export async function replanFromDeskEdits(
  state: ShowrunnerCallState,
  edits: DeskPlanEdit[],
  now: Date
): Promise<{ proposalId: string; revision: string; summary: string; itemIds: string[] } | null> {
  const identity = await identityForShowrunner(state);
  const tz = state.timeZone;
  const tomorrow = addDaysYmd(state.businessDate, 1);
  const base: StrategicPlanningProposal =
    (await latestStrategicProposal(identity, weekStartMonday(tomorrow))) ??
    (await latestStrategicProposal(identity, weekStartMonday(state.businessDate))) ??
    (await prepareStrategicProposal({ identity, timeZone: tz, now }));
  const decisions = await strategicResponses(identity, base.id).catch(() => []);
  const approvedIds = new Set(decisions.flatMap(r => (r.action === "approve" ? r.itemIds : [])));
  const commitments = new Map([
    ...state.briefing.today.map(i => [i.id, { item: i, date: state.businessDate }] as const),
    ...state.briefing.tomorrow.map(i => [i.id, { item: i, date: tomorrow }] as const),
  ]);

  let items = base.items.filter(i => !approvedIds.has(i.id));
  const changed: string[] = [];
  const lines: string[] = [];
  for (const edit of edits) {
    if (edit.action === "analysis_contact") {
      const analysis = state.businessAnalysis;
      const index = analysis?.customerIds.indexOf(edit.itemId) ?? -1;
      const customer = index >= 0 ? analysis!.customers[index] : null;
      const date = dateFromOperatorWords(
        edit.operatorWords,
        state.businessDate
      );
      if (
        !customer ||
        !customer.identityKeys.length ||
        analysis!.tenantId !== state.tenantId ||
        now.getTime() - analysis!.touchedAt > 20 * 60000 ||
        !date ||
        date < state.businessDate
      )
        continue;
      const id = `${date}:analysis_contact:${edit.itemId}`;
      if (!items.some(i => i.id === id))
        items.push({
          id,
          businessDate: date,
          title: `Contact ${customer.displayName}`,
          objective:
            "Operator-requested customer follow-up; decide consent, offer and channel before contact.",
          executionType: "mission",
          candidateId: `analysis_contact:${edit.itemId}`,
          missionType: "retention",
          planId: `claire_desk:${state.businessDate}`,
          planRevision: 0,
          evidenceRefs: analysis!.results.map(
            r => `analysis_receipt:${r.receipt.id}`
          ),
        });
      changed.push(id);
      lines.push(`Proposed contacting ${customer.displayName} on ${date}.`);
      continue;
    }
    const draft = items.find(i => i.id === edit.itemId);
    const committed = commitments.get(edit.itemId);
    const day = (date: string) => (date === tomorrow ? "tomorrow" : formatInTimeZone(new Date(`${date}T12:00:00Z`), tz, "EEEE"));
    if (edit.action === "hold") {
      if (draft) {
        items = items.filter(i => i.id !== draft.id);
        lines.push(`${draft.title} is on hold and out of the plan you'd approve.`);
      } else if (committed) {
        lines.push(`${committed.item.title} is already on your Day Line, so it stays there for now.`);
      }
      continue;
    }
    // The operator's own words win ("tomorrow"), then the model's resolved date, then the item's day.
    const named = dateFromOperatorWords(edit.operatorWords, state.businessDate) ?? (/^\d{4}-\d{2}-\d{2}$/.test(edit.date) ? edit.date : null);
    const target = (own: string) => (named && named >= state.businessDate ? named : own);
    const timeWindow = {
      window: windowForTime(edit.time, edit.window),
      time: edit.time,
      reason: "Time you set on OPEN COMMS.",
      sourceObservationId: `desk_comms:${state.businessDate}`,
    };
    if (draft) {
      const date = target(draft.businessDate);
      const id = `${date}:${draft.id.replace(/^\d{4}-\d{2}-\d{2}:/, "")}@${edit.time}`;
      items = items.map(i => (i.id === draft.id ? { ...i, id, businessDate: date, timeWindow } : i));
      changed.push(id);
      lines.push(`${draft.title} moves to ${day(date)} at ${spokenTime(edit.time)}.`);
    } else if (committed) {
      const date = target(committed.date);
      const key = `retime:${committed.item.id}:${date}:${edit.time}`;
      const id = `${date}:${key}`;
      const replacement: StrategicProposalItem = {
        id,
        businessDate: date,
        title: committed.item.title,
        objective: committed.item.objective ?? committed.item.title,
        executionType: "mission",
        candidateId: key,
        planId: `claire_desk:${state.businessDate}`,
        planRevision: 0,
        evidenceRefs: [`day_director_commitments:${committed.item.id}`],
        timeWindow,
        supersedesCommitmentIds: [committed.item.id],
      };
      items = [...items.filter(i => i.id !== id), replacement];
      changed.push(id);
      lines.push(`${committed.item.title} moves to ${day(date)} at ${spokenTime(edit.time)}; the earlier slot comes off your Day Line once you approve.`);
    }
  }
  if (!lines.length) return null;
  const summary = lines.join(" ");
  const revision = createHash("sha256")
    .update(JSON.stringify({ base: base.revision, items, at: now.toISOString() }))
    .digest("hex");
  const revised: StrategicPlanningProposal = {
    ...base,
    id: `proposal_${revision.slice(0, 40)}`,
    revision,
    businessDate: state.businessDate,
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 3600000).toISOString(),
    items,
    approvalState: "pending",
    opening: `${summary} Approve it, or tell me what to change.`,
    weeklyPlan: base.weeklyPlan
      ? { ...base.weeklyPlan, changes: [...base.weeklyPlan.changes, { at: now.toISOString(), summary }] }
      : undefined,
  };
  const stored = await persistStrategicProposal(revised);
  return { proposalId: stored.id, revision: stored.revision, summary, itemIds: changed.filter(id => stored.items.some(i => i.id === id)) };
}
/** Resolve an explicit operator-selected population into existing proposal edits. No ranking or execution. */
export function contactEditsForAnalysisSelection(
  state: ShowrunnerCallState,
  utterance: string,
  now: Date
): DeskPlanEdit[] | null {
  const selection = state.businessAnalysis;
  if (
    !selection ||
    selection.tenantId !== state.tenantId ||
    now.getTime() - selection.touchedAt > 20 * 60000 ||
    !selection.customerIds.length ||
    selection.customerIds.length > 10
  )
    return null;
  const request =
    /^(?:please\s+)?(?:put|add)\s+(?:those|these|them)(?:\s+(all|\d+|one|two|three|four|five|six|seven|eight|nine|ten))?\s+(?:on|to|onto)\s+(?:the\s+)?(?:today(?:'s)?|tomorrow(?:'s)?|monday(?:'s)?|tuesday(?:'s)?|wednesday(?:'s)?|thursday(?:'s)?|friday(?:'s)?|saturday(?:'s)?|sunday(?:'s)?)\s+day\s*line[.!]?$/i.exec(
      utterance.trim()
    );
  const date = dateFromOperatorWords(utterance, state.businessDate);
  if (
    !request ||
    !date ||
    (request[1] &&
      request[1].toLowerCase() !== "all" &&
      parseSpokenNumber(request[1]) !== selection.customerIds.length)
  )
    return null;
  return selection.customerIds.map(itemId => ({
    itemId,
    action: "analysis_contact",
    date,
    time: "",
    window: "none",
    operatorWords: utterance,
  }));
}
