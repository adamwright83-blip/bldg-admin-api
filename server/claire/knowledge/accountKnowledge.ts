import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccounts,
  commercialFollowUps,
  commercialMissionEvents,
  commercialMissionFieldStates,
  commercialMissions,
  commercialOpportunities,
  commercialPipelineRecords,
  commercialVisitOutcomes,
  dayDirectorCommitments,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { addDaysYmd, daysInclusive, formatBusinessDate } from "../../analytics/businessPeriods";
import { zonedYmd } from "../../dashboardZoned";
import { searchOperatorConversation, type RememberedTurn } from "./conversationMemory";
import { isOperatorVisibleAccount, isOperatorVisibleMissionSnapshot } from "./sourceVisibility";

/**
 * Everything Goldline recorded about a commercial account (The Louise,
 * Maybourne, KITH…): missions, field states and notes, visit outcomes,
 * follow-ups, pipeline stage, contacts, Day Line items that mention it, and
 * what Adam said about it on calls. Each fact keeps its provenance: a
 * mission event is a system record, a field note is operator-attested, a
 * call quote is only what Adam said.
 */

export type AccountRef = { id: number; name: string; accountType: string; contacts?: Array<{ name: string | null; title: string | null }> };

export type AccountHistory = {
  account: AccountRef;
  missions: Array<{ id: number; code: string; status: string; createdAt: string; updatedAt: string }>;
  events: Array<{ at: string; missionId: number; eventName: string; toStatus: string | null; actorType: string }>;
  fieldVisits: Array<{ missionId: number; arrivedAt: string | null; departedAt: string | null; notes: string | null }>;
  outcomes: Array<{
    missionId: number;
    outcome: string;
    notes: string | null;
    followUpAt: string | null;
    createdAt: string;
    decisionMakerStatus: string;
    collateralDelivered: boolean;
  }>;
  followUps: Array<{ id: string; pipelineId: number; status: string; dueAt: string; note: string; completedAt: string | null }>;
  pipelineStage: string | null;
  pipelineId: number | null;
  contacts: Array<{ name: string | null; title: string | null; relationshipType: string }>;
  dayLineMentions: Array<{ title: string; businessDate: string; status: string }>;
  conversationMentions: RememberedTurn[];
};

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(token => token.length >= 3 && !["the", "and", "llc", "inc", "apartments", "hotel", "property", "management"].includes(token));
}

export async function listAccountRefs(tenantId: string): Promise<AccountRef[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      id: commercialAccounts.id,
      name: commercialAccounts.name,
      accountType: commercialAccounts.accountType,
      providerName: commercialAccounts.providerName,
      identityKey: commercialAccounts.identityKey,
    })
    .from(commercialAccounts)
    .where(eq(commercialAccounts.tenantId, tenantId))
    .orderBy(asc(commercialAccounts.name))
    .limit(500);
  const visible = rows.filter(row => isOperatorVisibleAccount(row));
  if (!visible.length) return [];
  const contacts = await db
    .select({
      accountId: commercialAccountContacts.accountId,
      name: commercialAccountContacts.name,
      title: commercialAccountContacts.title,
    })
    .from(commercialAccountContacts)
    .where(and(eq(commercialAccountContacts.tenantId, tenantId), inArray(commercialAccountContacts.accountId, visible.map(row => row.id))));
  return visible.map(row => ({
    id: row.id,
    name: row.name,
    accountType: row.accountType,
    contacts: contacts.filter(contact => contact.accountId === row.id).map(contact => ({ name: contact.name, title: contact.title })),
  }));
}

/** Accounts whose distinctive name words appear in what Adam said. */
export function matchAccounts(lower: string, accounts: AccountRef[]): AccountRef[] {
  const scored = accounts
    .map(account => {
      const words = tokens(account.name);
      const hits = words.filter(word => new RegExp(`\\b${word}\\b`).test(lower)).length;
      return { account, hits, words: words.length };
    })
    .filter(entry => entry.hits > 0 && entry.hits >= Math.min(1, entry.words));
  if (!scored.length) return [];
  const best = Math.max(...scored.map(entry => entry.hits));
  return scored.filter(entry => entry.hits === best).map(entry => entry.account);
}

export type AccountAspect = "summary" | "last_contact" | "said" | "follow_up" | "visit";

export function accountAspect(lower: string): AccountAspect {
  if (/\bwhat did i (?:say|tell you|note|report)\b|\bwhat was said\b|\bwhat did (?:i|we) (?:decide|agree)\b|\bwhat did you tell me\b/.test(lower)) return "said";
  if (/\bwhat happened\b.*\b(?:last time|visit|went|go|there)\b|\bhow did (?:the|that|my) visit go\b/.test(lower)) return "visit";
  if (/\bfollow[- ]?up\b|\bowe\b|\bstill (?:need|have) to\b|\bnext step\b/.test(lower)) return "follow_up";
  if (/\blast (?:contact|touch|time|visit)\b|\bwhen did i (?:last )?(?:go|visit|contact|see|talk|stop by|drop by|call)\b|\bwhen was (?:my|the) last\b/.test(lower)) {
    return "last_contact";
  }
  if (/\bwhat happened (?:on|at|during) (?:the|that|my) visit\b|\bhow did (?:the|that) visit go\b/.test(lower)) return "visit";
  return "summary";
}

export function isAccountQuestion(lower: string): boolean {
  return /\b(what happened|what do (?:we|i) know|tell me about|status|last (?:contact|time|visit|touch)|when did i|follow[- ]?up|owe|what did i (?:say|tell)|what did (?:we|i) decide|how did|visit|pitch|account|prospect)\b/.test(lower);
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function loadAccountHistory(input: {
  tenantId: string;
  operatorUserId: string;
  account: AccountRef;
}): Promise<AccountHistory> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { tenantId, account } = input;
  const opportunities = await db
    .select({ id: commercialOpportunities.id })
    .from(commercialOpportunities)
    .where(and(eq(commercialOpportunities.tenantId, tenantId), eq(commercialOpportunities.accountId, account.id)));
  const opportunityIds = opportunities.map(row => row.id);
  const missions = opportunityIds.length
    ? await db
        .select({
          id: commercialMissions.id,
          code: commercialMissions.code,
          status: commercialMissions.status,
          createdAt: commercialMissions.createdAt,
          updatedAt: commercialMissions.updatedAt,
          accountSnapshotJson: commercialMissions.accountSnapshotJson,
          opportunitySnapshotJson: commercialMissions.opportunitySnapshotJson,
        })
        .from(commercialMissions)
        .where(and(eq(commercialMissions.tenantId, tenantId), inArray(commercialMissions.opportunityId, opportunityIds)))
        .orderBy(desc(commercialMissions.createdAt))
    : [];
  const visibleMissions = missions.filter(row => {
    const snapshot = row.accountSnapshotJson as { name?: string; accountType?: string; providerName?: string } | null;
    const opportunity = row.opportunitySnapshotJson as { evidence?: Array<Record<string, unknown>> } | null;
    return isOperatorVisibleMissionSnapshot({
      name: snapshot?.name,
      accountType: snapshot?.accountType,
      providerName: snapshot?.providerName,
      evidence: opportunity?.evidence ?? null,
    });
  });
  const missionIds = visibleMissions.map(row => row.id);
  const nameTerms = tokens(account.name);
  const [events, fields, outcomes, followUps, pipelines, contacts, dayLine, mentions] = await Promise.all([
    missionIds.length
      ? db
          .select()
          .from(commercialMissionEvents)
          .where(and(eq(commercialMissionEvents.tenantId, tenantId), inArray(commercialMissionEvents.missionId, missionIds)))
          .orderBy(asc(commercialMissionEvents.createdAt))
      : Promise.resolve([]),
    missionIds.length
      ? db
          .select()
          .from(commercialMissionFieldStates)
          .where(and(eq(commercialMissionFieldStates.tenantId, tenantId), inArray(commercialMissionFieldStates.missionId, missionIds)))
      : Promise.resolve([]),
    missionIds.length
      ? db
          .select()
          .from(commercialVisitOutcomes)
          .where(and(eq(commercialVisitOutcomes.tenantId, tenantId), inArray(commercialVisitOutcomes.missionId, missionIds)))
          .orderBy(desc(commercialVisitOutcomes.createdAt))
      : Promise.resolve([]),
    missionIds.length
      ? db
          .select()
          .from(commercialFollowUps)
          .where(and(eq(commercialFollowUps.tenantId, tenantId), inArray(commercialFollowUps.missionId, missionIds)))
          .orderBy(desc(commercialFollowUps.dueAt))
      : Promise.resolve([]),
    missionIds.length
      ? db
          .select({ id: commercialPipelineRecords.id, stage: commercialPipelineRecords.stage, updatedAt: commercialPipelineRecords.updatedAt })
          .from(commercialPipelineRecords)
          .where(and(eq(commercialPipelineRecords.tenantId, tenantId), inArray(commercialPipelineRecords.missionId, missionIds)))
          .orderBy(desc(commercialPipelineRecords.updatedAt))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({ name: commercialAccountContacts.name, title: commercialAccountContacts.title, relationshipType: commercialAccountContacts.relationshipType })
      .from(commercialAccountContacts)
      .where(and(eq(commercialAccountContacts.tenantId, tenantId), eq(commercialAccountContacts.accountId, account.id)))
      .limit(10),
    nameTerms.length
      ? db
          .select({
            title: dayDirectorCommitments.title,
            businessDate: dayDirectorCommitments.businessDate,
            status: dayDirectorCommitments.status,
          })
          .from(dayDirectorCommitments)
          .where(
            and(
              eq(dayDirectorCommitments.tenantId, tenantId),
              sql`LOWER(${dayDirectorCommitments.title}) LIKE ${`%${nameTerms[0]}%`}`
            )
          )
          .orderBy(desc(dayDirectorCommitments.createdAt))
          .limit(8)
      : Promise.resolve([]),
    searchOperatorConversation({ tenantId, operatorUserId: input.operatorUserId, terms: nameTerms.slice(0, 1), speaker: "OPERATOR", limit: 5 }).catch(() => []),
  ]);
  return {
    account,
    missions: visibleMissions.map(row => ({
      id: row.id,
      code: row.code,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    events: events.map(row => ({
      at: row.createdAt.toISOString(),
      missionId: row.missionId,
      eventName: row.eventName,
      toStatus: row.toStatus,
      actorType: row.actorType,
    })),
    fieldVisits: fields.map(row => ({
      missionId: row.missionId,
      arrivedAt: iso(row.arrivedAt),
      departedAt: iso(row.departedAt),
      notes: row.notes ?? null,
    })),
    outcomes: outcomes.map(row => ({
      missionId: row.missionId,
      outcome: row.outcome,
      notes: row.notes,
      followUpAt: iso(row.followUpAt),
      createdAt: row.createdAt.toISOString(),
      decisionMakerStatus: row.decisionMakerStatus,
      collateralDelivered: Boolean(row.collateralDelivered),
    })),
    followUps: followUps.map(row => ({
      id: row.id,
      pipelineId: row.pipelineId,
      status: row.status,
      dueAt: row.dueAt.toISOString(),
      note: row.note,
      completedAt: iso(row.completedAt),
    })),
    pipelineStage: pipelines[0]?.stage ?? null,
    pipelineId: pipelines[0]?.id ?? null,
    contacts: contacts.map(row => ({ name: row.name, title: row.title, relationshipType: row.relationshipType })),
    dayLineMentions: dayLine
      .filter(row => isOperatorVisibleAccount({ name: row.title }))
      .map(row => ({ title: row.title, businessDate: row.businessDate, status: row.status })),
    conversationMentions: mentions,
  };
}

// ── Speaking ─────────────────────────────────────────────────────────────────

const OUTCOME_LABEL: Record<string, string> = {
  follow_up: "follow up",
  won: "won",
  lost: "lost",
  no_contact: "no contact",
  no_decision: "no decision",
};

const STATUS_LABEL: Record<string, string> = {
  candidate: "a candidate",
  selected: "selected",
  game_ready: "ready to prep",
  game_active: "in prep",
  game_completed: "prepped",
  phone_ready: "ready for the field",
  preparing: "being prepared",
  en_route: "en route",
  arrived: "arrived",
  visit_completed: "visited",
  follow_up: "in follow-up",
  won: "won",
  lost: "lost",
};

function dayOf(iso: string, timeZone: string): string {
  return zonedYmd(new Date(iso), timeZone);
}

function spokenDate(iso: string, timeZone: string, today: string): string {
  const day = dayOf(iso, timeZone);
  if (day === today) return "today";
  if (day === addDaysYmd(today, -1)) return "yesterday";
  return formatBusinessDate(day, day.slice(0, 4) !== today.slice(0, 4));
}

function quote(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 160 ? `${trimmed.slice(0, 157).replace(/\s+\S*$/, "")}…` : trimmed;
}

/** The latest moment Goldline recorded a real touch with the account (not just planning). */
export function lastContact(history: AccountHistory): { at: string; what: string } | null {
  const touches: Array<{ at: string; what: string }> = [];
  for (const visit of history.fieldVisits) if (visit.arrivedAt) touches.push({ at: visit.arrivedAt, what: "you checked in on site" });
  for (const outcome of history.outcomes) touches.push({ at: outcome.createdAt, what: `you recorded a visit outcome of ${OUTCOME_LABEL[outcome.outcome] ?? outcome.outcome}` });
  for (const followUp of history.followUps) if (followUp.completedAt) touches.push({ at: followUp.completedAt, what: "you completed a follow-up" });
  touches.sort((a, b) => b.at.localeCompare(a.at));
  return touches[0] ?? null;
}

export function speakAccountHistory(history: AccountHistory, aspect: AccountAspect, options: { timeZone: string; today: string }): string {
  const { timeZone, today } = options;
  const name = history.account.name;
  const sentences: string[] = [];
  const openFollowUps = history.followUps.filter(followUp => followUp.status === "open");
  const overdue = (dueAt: string) => {
    const due = dayOf(dueAt, timeZone);
    return due < today ? daysInclusive(due, today) - 1 : 0;
  };
  const mission = history.missions[0] ?? null;
  const latestOutcome = history.outcomes[0] ?? null;
  const notes = [
    ...history.fieldVisits.filter(visit => visit.notes?.trim()).map(visit => ({ at: visit.arrivedAt ?? visit.departedAt ?? mission?.updatedAt ?? "", text: visit.notes!, kind: "field notes" as const })),
    ...history.outcomes.filter(outcome => outcome.notes?.trim()).map(outcome => ({ at: outcome.createdAt, text: outcome.notes!, kind: "outcome notes" as const })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const followUpSentence = () => {
    if (!openFollowUps.length) {
      return history.followUps.length ? `No follow-up is open for ${name}.` : `There's no follow-up on record for ${name}.`;
    }
    const next = [...openFollowUps].sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0]!;
    const late = overdue(next.dueAt);
    return late > 0
      ? `Yes. A follow-up was due ${spokenDate(next.dueAt, timeZone, today)} and is still open, so it's ${late} ${late === 1 ? "day" : "days"} overdue.`
      : `Yes. A follow-up is due ${spokenDate(next.dueAt, timeZone, today)}.`;
  };

  switch (aspect) {
    case "follow_up":
      sentences.push(followUpSentence());
      break;
    case "last_contact": {
      const touch = lastContact(history);
      sentences.push(
        touch
          ? `The last recorded contact with ${name} was ${spokenDate(touch.at, timeZone, today)}, when ${touch.what}.`
          : mission
            ? `I don't have a recorded visit or contact with ${name}, only the mission set up ${spokenDate(mission.createdAt, timeZone, today)}.`
            : `I don't have any recorded contact with ${name}.`
      );
      const said = history.conversationMentions[0];
      if (said) sentences.push(`You did mention it on a call ${spokenDate(said.at, timeZone, today)}.`);
      break;
    }
    case "said": {
      if (notes.length) {
        sentences.push(`Your ${notes[0]!.kind} for ${name} say: "${quote(notes[0]!.text)}"`);
      }
      const said = history.conversationMentions.slice(0, 2);
      for (const turn of said) sentences.push(`On a call ${spokenDate(turn.at, timeZone, today)} you said: "${quote(turn.text)}"`);
      if (!notes.length && !said.length) sentences.push(`I don't have anything you said or noted about ${name}.`);
      else sentences.push("That's what you told me, not something I've confirmed.");
      break;
    }
    case "visit":
    case "summary": {
      if (!mission) {
        sentences.push(`${name} is on file as an account, but there's no mission or visit recorded for it.`);
      } else {
        const count = history.missions.length;
        sentences.push(
          `${name} has ${count === 1 ? "one mission" : `${count} missions`} on file, set up ${spokenDate(mission.createdAt, timeZone, today)}, currently ${STATUS_LABEL[mission.status] ?? mission.status}.`
        );
      }
      const arrived = history.fieldVisits.find(visit => visit.arrivedAt);
      if (latestOutcome) {
        const decisionMaker =
          latestOutcome.decisionMakerStatus === "met" ? " You met the decision maker." : latestOutcome.decisionMakerStatus === "unavailable" ? " The decision maker wasn't available." : "";
        sentences.push(
          `The last visit outcome was ${OUTCOME_LABEL[latestOutcome.outcome] ?? latestOutcome.outcome}, recorded ${spokenDate(latestOutcome.createdAt, timeZone, today)}.${decisionMaker}`
        );
        if (latestOutcome.notes?.trim()) sentences.push(`Your notes: "${quote(latestOutcome.notes)}"`);
      } else if (arrived) {
        sentences.push(`You checked in there ${spokenDate(arrived.arrivedAt!, timeZone, today)}, but no visit outcome was recorded.`);
        if (arrived.notes?.trim()) sentences.push(`Your field notes: "${quote(arrived.notes)}"`);
      } else if (mission) {
        sentences.push("No visit has been recorded yet.");
      }
      if (history.pipelineStage) sentences.push(`Pipeline stage: ${history.pipelineStage.replace(/_/g, " ")}.`);
      if (openFollowUps.length) sentences.push(followUpSentence().replace(/^Yes\. /, ""));
      const mention = history.conversationMentions[0];
      if (mention) sentences.push(`On a call ${spokenDate(mention.at, timeZone, today)} you said: "${quote(mention.text)}"`);
      break;
    }
  }
  return sentences.join(" ");
}
