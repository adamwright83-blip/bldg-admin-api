import { and, eq } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccounts,
  commercialCampaignLinks,
  commercialMissions,
  commercialOpportunities,
  commercialPipelineRecords,
  dayforgeSaasMemberships,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type {
  CommercialCampaignLinkRecord,
  CommercialCampaignLinkRepository,
} from "./commercialCampaignLinkService";

function recordFromRow(
  row: typeof commercialCampaignLinks.$inferSelect
): CommercialCampaignLinkRecord {
  return {
    ...row,
    pipelineId: row.pipelineId ?? null,
    referringContactId: row.referringContactId ?? null,
    buildingSlug: row.buildingSlug ?? null,
    offerKey: row.offerKey ?? null,
    expiresAt: row.expiresAt ?? null,
    revokedAt: row.revokedAt ?? null,
  };
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export function legacyRoleCanOwnCommercialCampaignSalespersonScope(
  role: typeof users.$inferSelect.role
): boolean {
  return role === "admin" || role === "driver";
}

export const commercialCampaignLinkRepository: CommercialCampaignLinkRepository =
  {
    async ownsScope(input) {
      const db = await database();
      const [account] = await db
        .select({ id: commercialAccounts.id })
        .from(commercialAccounts)
        .where(
          and(
            eq(commercialAccounts.tenantId, input.tenantId),
            eq(commercialAccounts.id, input.accountId)
          )
        )
        .limit(1);
      if (!account) return false;

      const [mission] = await db
        .select({
          opportunityId: commercialMissions.opportunityId,
          assignedTo: commercialMissions.assignedTo,
        })
        .from(commercialMissions)
        .where(
          and(
            eq(commercialMissions.tenantId, input.tenantId),
            eq(commercialMissions.id, input.missionId)
          )
        )
        .limit(1);
      if (!mission?.opportunityId) return false;
      if (mission.assignedTo && mission.assignedTo !== input.salespersonId) {
        return false;
      }

      const [membership] = await db
        .select({ id: dayforgeSaasMemberships.id })
        .from(dayforgeSaasMemberships)
        .where(
          and(
            eq(dayforgeSaasMemberships.tenantId, input.tenantId),
            eq(dayforgeSaasMemberships.userOpenId, input.salespersonId),
            eq(dayforgeSaasMemberships.active, true)
          )
        )
        .limit(1);
      if (!membership) {
        const [legacyOperator] = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(
            and(
              eq(users.tenantId, input.tenantId),
              eq(users.openId, input.salespersonId)
            )
          )
          .limit(1);
        if (
          !legacyOperator ||
          !legacyRoleCanOwnCommercialCampaignSalespersonScope(
            legacyOperator.role
          )
        ) {
          return false;
        }
      }

      const [opportunity] = await db
        .select({ accountId: commercialOpportunities.accountId })
        .from(commercialOpportunities)
        .where(
          and(
            eq(commercialOpportunities.tenantId, input.tenantId),
            eq(commercialOpportunities.id, mission.opportunityId),
            eq(commercialOpportunities.accountId, input.accountId)
          )
        )
        .limit(1);
      if (!opportunity) return false;

      if (input.pipelineId !== null) {
        const [pipeline] = await db
          .select({ id: commercialPipelineRecords.id })
          .from(commercialPipelineRecords)
          .where(
            and(
              eq(commercialPipelineRecords.tenantId, input.tenantId),
              eq(commercialPipelineRecords.id, input.pipelineId),
              eq(commercialPipelineRecords.accountId, input.accountId),
              eq(commercialPipelineRecords.missionId, input.missionId)
            )
          )
          .limit(1);
        if (!pipeline) return false;
      }

      if (input.referringContactId !== null) {
        const [contact] = await db
          .select({ id: commercialAccountContacts.id })
          .from(commercialAccountContacts)
          .where(
            and(
              eq(commercialAccountContacts.tenantId, input.tenantId),
              eq(commercialAccountContacts.id, input.referringContactId),
              eq(commercialAccountContacts.accountId, input.accountId)
            )
          )
          .limit(1);
        if (!contact) return false;
      }

      return true;
    },

    async findByRequestId(input) {
      const db = await database();
      const [row] = await db
        .select()
        .from(commercialCampaignLinks)
        .where(
          and(
            eq(commercialCampaignLinks.tenantId, input.tenantId),
            eq(commercialCampaignLinks.requestId, input.requestId)
          )
        )
        .limit(1);
      return row ? recordFromRow(row) : null;
    },

    async findByTokenHash(input) {
      const db = await database();
      const [row] = await db
        .select()
        .from(commercialCampaignLinks)
        .where(
          and(
            eq(commercialCampaignLinks.tenantId, input.tenantId),
            eq(commercialCampaignLinks.tokenHash, input.tokenHash)
          )
        )
        .limit(1);
      return row ? recordFromRow(row) : null;
    },

    async insert(input) {
      const db = await database();
      try {
        await db.insert(commercialCampaignLinks).values(input);
        return "inserted";
      } catch (error) {
        if (isMysqlDuplicateKeyError(error)) return "duplicate";
        throw error;
      }
    },
  };
