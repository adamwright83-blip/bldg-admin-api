import { and, asc, desc, eq, inArray } from "drizzle-orm";
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
} from "../../../drizzle/schema";
import { getDb } from "../../db";

export type CommercialAccountRef = {
  id: number;
  name: string;
  accountType: string;
  identityKey?: string | null;
  providerName?: string | null;
  providerAccountId?: string | null;
};

export type CommercialAccountContactRef = {
  accountId: number;
  accountName: string;
  accountType: string;
  contactName: string;
  title: string | null;
  relationshipType: string;
  identityKey?: string | null;
  providerName?: string | null;
  providerAccountId?: string | null;
};

export type CommercialAccountHistoryCore = {
  account: CommercialAccountRef;
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
};

const TEST_ACCOUNT = /\bSAFE TO ARCHIVE\b|\bE2E\b|\bCODEX\b/i;

function assertTenant(tenantId: string): string {
  const scoped = tenantId.trim();
  if (!scoped) throw new Error("Commercial account read requires tenant authority");
  return scoped;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export async function listCommercialAccountRefs(
  tenantId: string
): Promise<CommercialAccountRef[]> {
  const scopedTenantId = assertTenant(tenantId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      id: commercialAccounts.id,
      name: commercialAccounts.name,
      accountType: commercialAccounts.accountType,
      identityKey: commercialAccounts.identityKey,
      providerName: commercialAccounts.providerName,
      providerAccountId: commercialAccounts.providerAccountId,
    })
    .from(commercialAccounts)
    .where(eq(commercialAccounts.tenantId, scopedTenantId))
    .orderBy(asc(commercialAccounts.name))
    .limit(500);
  return rows.filter(row => !TEST_ACCOUNT.test(row.name));
}

export async function listCommercialAccountContacts(
  tenantId: string
): Promise<CommercialAccountContactRef[]> {
  const scopedTenantId = assertTenant(tenantId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      accountId: commercialAccounts.id,
      accountName: commercialAccounts.name,
      accountType: commercialAccounts.accountType,
      identityKey: commercialAccounts.identityKey,
      providerName: commercialAccounts.providerName,
      providerAccountId: commercialAccounts.providerAccountId,
      contactName: commercialAccountContacts.name,
      title: commercialAccountContacts.title,
      relationshipType: commercialAccountContacts.relationshipType,
    })
    .from(commercialAccountContacts)
    .innerJoin(commercialAccounts, eq(commercialAccounts.id, commercialAccountContacts.accountId))
    .where(eq(commercialAccountContacts.tenantId, scopedTenantId))
    .limit(1000);
  return rows
    .filter(row => row.contactName != null && row.contactName.trim().length > 0)
    .filter(row => !TEST_ACCOUNT.test(row.accountName))
    .map(row => ({
      accountId: row.accountId,
      accountName: row.accountName,
      accountType: row.accountType,
      identityKey: row.identityKey,
      providerName: row.providerName,
      providerAccountId: row.providerAccountId,
      contactName: row.contactName as string,
      title: row.title ?? null,
      relationshipType: row.relationshipType,
    }));
}

export async function loadCommercialAccountHistoryCore(input: {
  tenantId: string;
  account: CommercialAccountRef;
}): Promise<CommercialAccountHistoryCore> {
  const tenantId = assertTenant(input.tenantId);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const account = input.account;
  const opportunities = await db
    .select({ id: commercialOpportunities.id })
    .from(commercialOpportunities)
    .where(
      and(
        eq(commercialOpportunities.tenantId, tenantId),
        eq(commercialOpportunities.accountId, account.id)
      )
    );
  const opportunityIds = opportunities.map(row => row.id);
  const missions = opportunityIds.length
    ? await db
        .select({
          id: commercialMissions.id,
          code: commercialMissions.code,
          status: commercialMissions.status,
          createdAt: commercialMissions.createdAt,
          updatedAt: commercialMissions.updatedAt,
        })
        .from(commercialMissions)
        .where(
          and(
            eq(commercialMissions.tenantId, tenantId),
            inArray(commercialMissions.opportunityId, opportunityIds)
          )
        )
        .orderBy(desc(commercialMissions.createdAt))
    : [];
  const missionIds = missions.map(row => row.id);
  const [events, fields, outcomes, followUps, pipelines, contacts] = await Promise.all([
    missionIds.length
      ? db.select().from(commercialMissionEvents)
          .where(and(eq(commercialMissionEvents.tenantId, tenantId), inArray(commercialMissionEvents.missionId, missionIds)))
          .orderBy(asc(commercialMissionEvents.createdAt))
      : Promise.resolve([]),
    missionIds.length
      ? db.select().from(commercialMissionFieldStates)
          .where(and(eq(commercialMissionFieldStates.tenantId, tenantId), inArray(commercialMissionFieldStates.missionId, missionIds)))
      : Promise.resolve([]),
    missionIds.length
      ? db.select().from(commercialVisitOutcomes)
          .where(and(eq(commercialVisitOutcomes.tenantId, tenantId), inArray(commercialVisitOutcomes.missionId, missionIds)))
          .orderBy(desc(commercialVisitOutcomes.createdAt))
      : Promise.resolve([]),
    missionIds.length
      ? db.select().from(commercialFollowUps)
          .where(and(eq(commercialFollowUps.tenantId, tenantId), inArray(commercialFollowUps.missionId, missionIds)))
          .orderBy(desc(commercialFollowUps.dueAt))
      : Promise.resolve([]),
    missionIds.length
      ? db.select({
          id: commercialPipelineRecords.id,
          stage: commercialPipelineRecords.stage,
          updatedAt: commercialPipelineRecords.updatedAt,
        }).from(commercialPipelineRecords)
          .where(and(eq(commercialPipelineRecords.tenantId, tenantId), inArray(commercialPipelineRecords.missionId, missionIds)))
          .orderBy(desc(commercialPipelineRecords.updatedAt))
          .limit(1)
      : Promise.resolve([]),
    db.select({
      name: commercialAccountContacts.name,
      title: commercialAccountContacts.title,
      relationshipType: commercialAccountContacts.relationshipType,
    }).from(commercialAccountContacts)
      .where(and(eq(commercialAccountContacts.tenantId, tenantId), eq(commercialAccountContacts.accountId, account.id)))
      .limit(10),
  ]);

  return {
    account,
    missions: missions.map(row => ({
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
    contacts: contacts.map(row => ({
      name: row.name,
      title: row.title,
      relationshipType: row.relationshipType,
    })),
  };
}
