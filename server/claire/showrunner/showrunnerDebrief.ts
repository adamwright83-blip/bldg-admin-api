import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { recordDaphneObservation } from "../../agents/daphne/observationStore";
import { loadMissionPresentations, presentationFor, recordMissionExplanation } from "../../agents/daphne/missionFollowUp";
import { latestStrategicProposal, persistStrategicProposal, strategicResponses } from "../../strategy/strategicStore";
import { respondToStrategicProposal } from "../../strategy/strategicApproval";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { actionableDates, remainingWeekHorizon, weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import type { StrategicPlanningProposal, StrategicProposalItem } from "../../../shared/strategicIntelligence";
import { DESK_PREPARATION_SOURCE, SHOWRUNNER_DEVELOPMENT_SOURCE } from "./showrunnerBriefing";
import { addDaysYmd } from "../../analytics/businessPeriods";
import type { ShowrunnerCallState } from "./showrunnerTurn";

export type DebriefMissionUpdate = {
  itemId: string;
  outcome: "done" | "partial" | "not_done";
  operatorWords: string;
  reportedAt: string;
};

export type DebriefDevelopment = {
  kind: "meeting" | "opportunity" | "commitment" | "availability" | "other";
  who: string;
  what: string;
  date: string;
  time: string;
  window: "morning" | "afternoon" | "evening" | "none";
  place: string;
  operatorWords: string;
  reportedAt: string;
  /** Already on the Day Line as the operator's own commitment (reportedWork.ts); never re-proposed. */
  landed?: boolean;
};

const short = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 16);

async function identityFor(state: ShowrunnerCallState) {
  const r = await resolveCanonicalOperatorIdentity({
    tenantId: state.tenantId,
    source: { type: "open_id", value: state.operatorUserId },
    subsystem: "claire.showrunner",
  });
  if (!r.ok || r.identity.canonicalOperatorId !== state.canonicalOperatorId)
    throw new Error("Showrunner operator identity unavailable");
  return r.identity;
}

/**
 * Persists one turn as operator-reported evidence: the raw words, each mission
 * update, and each development. Unfinished-work explanations take the same
 * consent-bound Daphne path as Day Line follow-ups.
 */
export async function recordShowrunnerTurn(input: {
  state: ShowrunnerCallState;
  utterance: string;
  updates: DebriefMissionUpdate[];
  developments: DebriefDevelopment[];
  /** Things the operator asked to be reminded to bring or prepare (desk planning). */
  preparation?: string[];
  sourceEventId: string;
  conversationKey: string;
  now: Date;
}) {
  const s = input.state;
  const base = {
    tenantId: s.tenantId,
    canonicalOperatorId: s.canonicalOperatorId,
    operatorUserId: s.operatorUserId,
    actorType: "user" as const,
    actorId: s.operatorUserId,
    evidenceChannel: "stated" as const,
    verificationStatus: "attested" as const,
    occurredAt: input.now,
  };
  await recordDaphneObservation({
    ...base,
    observationKind: "user_statement",
    sourceType: `claire_${s.purpose}`,
    sourceReference: input.conversationKey,
    payload: { utterance: input.utterance, businessDate: s.businessDate },
    idempotencyKey: `showrunner_turn:${input.sourceEventId}`,
  });
  const items = [...s.briefing.today, ...s.briefing.tomorrow];
  const driverStops = s.briefing.driverDayLine?.stops ?? [];
  for (const u of input.updates) {
    const item = items.find(i => i.id === u.itemId);
    const driverStop = driverStops.find(stop => stop.id === u.itemId);
    if (u.outcome !== "done" && u.operatorWords.trim()) {
      await recordMissionExplanation({
        tenantId: s.tenantId,
        canonicalOperatorId: s.canonicalOperatorId,
        operatorUserId: s.operatorUserId,
        missionType: "growth",
        answer: u.operatorWords,
        sourceType: "claire_debrief_mission_outcome",
        sourceReference: item ? `day_director_commitments:${u.itemId}` : `driver_day_line:${u.itemId}`,
        idempotencyKey: `showrunner_outcome:${input.sourceEventId}:${u.itemId}`,
        extraPayload: { outcome: u.outcome, title: item?.title ?? driverStop?.title ?? null, businessDate: s.businessDate, reported: true },
        now: input.now,
      });
    } else {
      await recordDaphneObservation({
        ...base,
        observationKind: "user_statement",
        sourceType: "claire_debrief_mission_outcome",
        sourceReference: item ? `day_director_commitments:${u.itemId}` : `driver_day_line:${u.itemId}`,
        payload: { outcome: u.outcome, operatorWords: u.operatorWords, title: item?.title ?? driverStop?.title ?? null, businessDate: s.businessDate, reported: true },
        idempotencyKey: `showrunner_outcome:${input.sourceEventId}:${u.itemId}`,
      });
    }
  }
  for (const need of input.preparation ?? []) {
    await recordDaphneObservation({
      ...base,
      observationKind: "user_statement",
      sourceType: DESK_PREPARATION_SOURCE,
      sourceReference: input.conversationKey,
      payload: { need, forDate: addDaysYmd(s.businessDate, 1), businessDate: s.businessDate, reported: true },
      idempotencyKey: `desk_preparation:${input.sourceEventId}:${short(need)}`,
    });
  }
  for (const d of input.developments) {
    await recordDaphneObservation({
      ...base,
      observationKind: "user_statement",
      sourceType: SHOWRUNNER_DEVELOPMENT_SOURCE,
      sourceReference: input.conversationKey,
      payload: { ...d, businessDate: s.businessDate, reported: true },
      idempotencyKey: `showrunner_development:${input.sourceEventId}:${short(JSON.stringify(d))}`,
    });
  }
}

type Slot = "morning" | "afternoon" | "evening";

/** Pure: place items into (date, window) slots without double-booking. */
export function scheduleSlots(input: {
  dates: string[];
  fixed: Array<{ key: string; date: string; window: Slot }>;
  flexible: Array<{ key: string; earliest: string }>;
  preferred: Slot | null;
  avoid: Slot[];
}): Map<string, { date: string; window: Slot }> {
  const taken = new Set(input.fixed.map(f => `${f.date}|${f.window}`));
  const out = new Map(input.fixed.map(f => [f.key, { date: f.date, window: f.window }]));
  const order: Slot[] = [input.preferred ?? "morning", "morning", "afternoon"].filter(
    (w, i, a): w is Slot => a.indexOf(w) === i && !input.avoid.includes(w as Slot)
  ) as Slot[];
  for (const item of input.flexible) {
    for (const date of input.dates.filter(d => d >= item.earliest)) {
      const w = order.find(win => !taken.has(`${date}|${win}`));
      if (w) {
        taken.add(`${date}|${w}`);
        out.set(item.key, { date, window: w });
        break;
      }
    }
  }
  return out;
}

const describeDay = (date: string, timeZone: string) =>
  formatInTimeZone(new Date(`${date}T12:00:00Z`), timeZone, "EEEE");

/**
 * Revises the remaining week from what the operator reported: new meetings take
 * their stated slot, unfinished work moves to the next free slot that respects
 * Daphne's timing preference, remaining draft work shifts around them. Real
 * commitments are never moved; the revision is a pending proposal.
 */
export async function replanFromShowrunnerCall(state: ShowrunnerCallState, now: Date) {
  const identity = await identityFor(state);
  const tz = state.timeZone;
  const horizonNow = remainingWeekHorizon({
    businessDate: formatInTimeZone(now, tz, "yyyy-MM-dd"),
    localTime: formatInTimeZone(now, tz, "HH:mm"),
  });
  const dates = actionableDates(horizonNow);
  if (!dates.length) return null;
  const weekStart = weekStartMonday(dates[0]!);
  const base: StrategicPlanningProposal =
    (await latestStrategicProposal(identity, weekStart)) ?? (await prepareStrategicProposal({ identity, timeZone: tz, now }));
  const decisions = await strategicResponses(identity, base.id).catch(() => []);
  const approvedIds = new Set(decisions.flatMap(r => (r.action === "approve" ? r.itemIds : [])));
  const presentations = await loadMissionPresentations({ tenantId: identity.tenantId, canonicalOperatorId: identity.canonicalOperatorId }).catch(() => new Map());
  const timing = presentationFor(presentations, "growth") as { adjustment: { kind: string; window?: Slot } } | undefined;
  const preferred: Slot | null = timing?.adjustment.kind === "timing" ? (timing.adjustment.window ?? null) : null;
  const avoid: Slot[] = preferred === "morning" ? ["afternoon"] : [];

  // Existing approved commitments occupy their slots and are never moved.
  const committed: Array<{ key: string; date: string; window: Slot; id: string; title: string }> = [];
  for (const date of dates) {
    const day = await getDayDirectorState({
      tenantId: identity.tenantId,
      actorId: identity.dayDirectorActorId,
      actorIds: identity.dayDirectorActorIds,
      canonicalOperatorId: identity.canonicalOperatorId,
      businessDate: date,
    });
    for (const c of day.commitments.filter(c => c.status === "open")) {
      const w = (c.presentation?.adjustment.kind === "timing" ? c.presentation.adjustment.window : "morning") as Slot;
      committed.push({ key: `commitment:${c.id}`, date, window: w, id: c.id, title: c.title });
    }
  }
  // The latest report about the same contact supersedes earlier ones in this call.
  const latestByContact = new Map<string, DebriefDevelopment>();
  for (const d of state.captured.developments.filter(d => !d.landed && ["meeting", "opportunity", "commitment"].includes(d.kind)))
    latestByContact.set((d.who || d.what).toLowerCase(), d);
  const developmentItems = [...latestByContact.values()]
    .map(d => {
      const spoken = dateFromOperatorWords(d.operatorWords, state.businessDate);
      const resolvedDate = spoken ?? d.date;
      const date = resolvedDate && dates.includes(resolvedDate) ? resolvedDate : dates[0]!;
      const window: Slot =
        d.window !== "none" ? (d.window as Slot) : d.time ? (d.time < "12:00" ? "morning" : d.time < "17:00" ? "afternoon" : "evening") : (preferred ?? "morning");
      const key = `development:${short(JSON.stringify([d.who, d.what, d.date, d.time]))}`;
      // The operator is never their own follow-up target ("Follow up: operator", 2026-10-16 replay).
      const who = /^(?:the\s+)?(?:operator|me|myself|i|you|owner|self)$/i.test(d.who.trim()) ? "" : d.who.trim();
      const title = d.kind === "meeting" ? `Meet ${who || "the contact"}${d.place ? ` at ${d.place}` : ""}` : `Follow up: ${who || d.what}`;
      return {
        key,
        date,
        window,
        item: {
          id: `${date}:${key}`,
          businessDate: date,
          title: title.slice(0, 200),
          objective: `${d.what}${d.time ? ` at ${d.time}` : ""}. You reported this on ${state.businessDate}; confirm the time and address and bring what the meeting needs.`,
          executionType: "mission" as const,
          candidateId: key,
          missionType: "account_acquisition",
          planId: `claire_showrunner:${state.businessDate}`,
          planRevision: 0,
          evidenceRefs: [`operator_report:${state.businessDate}`],
          timeWindow: { window: window === "evening" ? "evening" : window, ...(d.time ? { time: d.time } : {}), reason: "Time you reported.", sourceObservationId: `operator_report:${state.businessDate}` },
        } as StrategicProposalItem,
      };
    });
  // A rescheduled meeting replaces its approved earlier slot, but only once approved.
  for (const d of developmentItems) {
    const earlier = committed.filter(c => c.title === d.item.title && c.date !== d.date);
    if (earlier.length) {
      d.item.supersedesCommitmentIds = earlier.map(c => c.id);
      for (const c of earlier) committed.splice(committed.indexOf(c), 1);
    }
  }
  const allItems = [...state.briefing.today, ...state.briefing.tomorrow];
  const carried = state.captured.missionUpdates
    .filter(u => u.outcome !== "done")
    .map(u => allItems.find(i => i.id === u.itemId))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .filter((i, idx, arr) => arr.findIndex(x => x.id === i.id) === idx)
    .map(i => {
      const words = state.captured.missionUpdates.find(u => u.itemId === i.id)?.operatorWords ?? "";
      const key = `carried:${i.id}`;
      return {
        key,
        item: {
          id: key,
          businessDate: dates[0]!,
          title: i.title,
          objective: `${i.objective ?? i.title} (Carried from ${state.businessDate}${words ? `: you said "${words.slice(0, 120)}"` : ""}.)`,
          executionType: "challenge" as const,
          candidateId: key,
          missionType: "retention",
          planId: `claire_showrunner:${state.businessDate}`,
          planRevision: 0,
          evidenceRefs: [`day_director_commitments:${i.id}`],
        } as StrategicProposalItem,
      };
    });
  // A meeting reported earlier keeps its stated time; only a newer report of the same contact replaces it.
  const reportedWho = new Set(developmentItems.map(d => d.item.title));
  const keptMeetings = base.items
    .filter(i => !approvedIds.has(i.id) && i.candidateId.startsWith("development:") && i.businessDate >= dates[0]! && !reportedWho.has(i.title))
    .map(i => ({ key: `kept:${i.id}`, date: i.businessDate, window: (i.timeWindow?.window ?? "morning") as Slot, item: i }));
  const remaining = base.items
    .filter(i => !approvedIds.has(i.id) && i.businessDate >= dates[0]! && !i.candidateId.startsWith("development:") && !carried.some(c => c.item.title === i.title))
    .map(i => ({ key: `existing:${i.id}`, item: i }));
  const slots = scheduleSlots({
    dates,
    fixed: [
      ...committed,
      ...developmentItems.map(d => ({ key: d.key, date: d.date, window: d.window })),
      ...keptMeetings.map(k => ({ key: k.key, date: k.date, window: k.window })),
    ],
    flexible: [...carried.map(c => ({ key: c.key, earliest: dates[0]! })), ...remaining.map(r => ({ key: r.key, earliest: r.item.businessDate }))],
    preferred,
    avoid,
  });
  const placed = (key: string, item: StrategicProposalItem): StrategicProposalItem | null => {
    const slot = slots.get(key);
    if (!slot) return null;
    return {
      ...item,
      id: item.id.includes(":") && item.id.startsWith(item.businessDate) ? item.id.replace(item.businessDate, slot.date) : `${slot.date}:${item.id}`,
      businessDate: slot.date,
      timeWindow: item.timeWindow ?? { window: slot.window === "evening" ? "evening" : slot.window, reason: preferred ? "Your timing preference." : "Next free slot.", sourceObservationId: "showrunner_replan" },
    };
  };
  const items = [
    ...developmentItems.map(d => placed(d.key, d.item)),
    ...keptMeetings.map(k => placed(k.key, k.item)),
    ...carried.map(c => placed(c.key, c.item)),
    ...remaining.map(r => placed(r.key, r.item)),
  ].filter((i): i is StrategicProposalItem => Boolean(i));
  if (!items.length) return null;

  const changes: string[] = [];
  for (const d of developmentItems) {
    const s = slots.get(d.key)!;
    changes.push(
      d.item.supersedesCommitmentIds?.length
        ? `${d.item.title} moves to ${describeDay(s.date, tz)} ${s.window}; I'll take the earlier slot off your Day Line once you approve.`
        : `${describeDay(s.date, tz)} ${s.window}: ${d.item.title} (new — you reported it).`
    );
  }
  for (const c of carried) {
    const s = slots.get(c.key);
    changes.push(
      s
        ? `${c.item.title} moved to ${describeDay(s.date, tz)} ${s.window}${preferred ? ` because you work best in the ${preferred}` : ""}.`
        : `${c.item.title} has no free slot left this week; it stays open on your Day Line.`
    );
  }
  for (const r of remaining) {
    const s = slots.get(r.key);
    if (s && s.date !== r.item.businessDate) changes.push(`${r.item.title} shifted to ${describeDay(s.date, tz)} to make room.`);
  }
  const summary = `Here's the revised plan: ${changes.join(" ")}`;
  const revision = createHash("sha256")
    .update(JSON.stringify({ base: base.revision, items, at: now.toISOString() }))
    .digest("hex");
  const revised: StrategicPlanningProposal = {
    ...base,
    id: `proposal_${revision.slice(0, 40)}`,
    revision,
    weekStart,
    businessDate: formatInTimeZone(now, tz, "yyyy-MM-dd"),
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 3600000).toISOString(),
    items,
    approvalState: "pending",
    opening: `${summary} Approve it, or tell me what to change.`,
    weeklyPlan: base.weeklyPlan
      ? {
          ...base.weeklyPlan,
          sequence: items.map(i => ({ date: i.businessDate, itemId: i.id, title: i.title, window: i.timeWindow?.window ?? null, why: i.planId.startsWith("claire_showrunner") ? "Revised from your report." : "Unchanged strategic sequence.", status: "draft" as const })),
          changes: [...base.weeklyPlan.changes, { at: now.toISOString(), summary }],
        }
      : undefined,
  };
  const stored = await persistStrategicProposal(revised);
  return { proposalId: stored.id, revision: stored.revision, summary };
}

/** Voice approval of the revised plan Claire proposed in this call. */
export async function identityForShowrunner(state: ShowrunnerCallState) {
  return identityFor(state);
}

export async function approveShowrunnerReplan(state: ShowrunnerCallState): Promise<string | null> {
  if (!state.replan) return null;
  const identity = await identityFor(state);
  const { loadStrategicProposal } = await import("../../strategy/strategicStore");
  const p = await loadStrategicProposal(identity, state.replan.proposalId);
  if (!p || p.revision !== state.replan.revision) return null;
  const r = await respondToStrategicProposal({
    identity,
    proposalId: p.id,
    revision: p.revision,
    action: "approve",
    itemIds: state.replan.itemIds ?? p.items.map(i => i.id),
    source: state.purpose === "desk_planning" ? "authenticated_app" : "authenticated_voice",
  });
  return r.failedItems.length ? null : r.speech;
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

/** Pure: a date the operator named in words ("Thursday", "tomorrow"), resolved against the call's business date. */
export function dateFromOperatorWords(words: string, businessDate: string): string | null {
  const t = words.toLowerCase();
  const base = new Date(`${businessDate}T12:00:00Z`);
  const add = (n: number) => new Date(base.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  if (/\btomorrow\b/.test(t)) return add(1);
  if (/\btoday\b|\bthis (?:morning|afternoon|evening)\b/.test(t)) return add(0);
  const named = WEEKDAYS.findIndex(d => new RegExp(`\\b${d}\\b`).test(t));
  if (named < 0) return null;
  const todayIdx = (base.getUTCDay() + 6) % 7; // Monday = 0
  let delta = named - todayIdx;
  if (delta <= 0) delta += 7;
  return add(delta);
}
