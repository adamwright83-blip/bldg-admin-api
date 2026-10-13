/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyDayforgeTenantMemberProcedure, legacyDayforgeTenantOperatorProcedure, router } from "../../_core/trpc";
import { remainingWeekHorizon } from "../../../shared/weeklyMissionReadiness";
import { requireCanonicalOperatorIdentityForUser } from "../../agents/persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../../agents/persistentOperator/observability";
import { grantStrategicCallAuthorization, revokeStrategicCallAuthorization } from "../../agents/persistentOperator/strategicCallAuthorization";
import { dayDirectorCommitments, legacyDayforgeSaasTenants, tenantStandingAuthorizations } from "../../../drizzle/schema";
import { defaultVerticalRegistry } from "../../strategy/verticalTemplates/defaultRegistry";
import { resolveTenantVerticalKey } from "../../strategy/marketContext";
import { getDb } from "../../db";
import { and, eq, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { WEEKDAY_STRATEGIC_PLANNING_ACTION } from "../../../shared/strategicCallAuthorization";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { latestStrategicProposal, strategicResponses } from "../../strategy/strategicStore";
import { respondToStrategicProposal, reviseStrategicProposal } from "../../strategy/strategicApproval";
import { resolveOperatorTimeZone } from "../../agents/persistentOperator/operatorAppointmentPolicy";
import { formatInTimeZone } from "date-fns-tz";
import { weekStartMonday, addDaysYmd } from "../../../shared/weeklyMissionReadiness";
import { loadDailyCommandWithWeeklyIntent } from "./dailyCommandIntent";
import {
  adjustWeeklyMission,
  beginWeeklyMission,
  declineWeeklyMission,
  loadWeeklyMissionPicture,
  replyWeeklyMission,
  type WeeklyDriverScope,
} from "./driver";

const timeZone = z.string().trim().min(1).max(80);

function assertTimeZone(zone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone }).format();
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown time zone" });
  }
}

async function scope(
  ctx: {
    tenantId: string;
    user: {
      openId: string;
      id?: unknown;
      role: "admin" | "driver" | "user";
    };
  },
  zone: string
): Promise<WeeklyDriverScope> {
  assertTimeZone(zone);
  const identity = await requireCanonicalOperatorIdentityForUser({
    tenantId: ctx.tenantId,
    user: ctx.user,
    subsystem: "weekly_mission",
  });
  return {
    tenantId: identity.tenantId,
    operatorId: identity.weeklyOperatorId,
    operatorIdentities: identity.aliases.map(alias => ({
      operatorId: alias.openId,
      dayDirectorActorId: String(alias.userId),
    })),
    dayDirectorActorId: identity.dayDirectorActorId,
    dayDirectorActorIds: identity.dayDirectorActorIds,
    timeZone: zone,
  };
}

export const weeklyMissionRouter = router({
  configureStrategicIndustry: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ verticalKey: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.industry_configuration" });
      if (input.verticalKey !== "generic") defaultVerticalRegistry.get(input.verticalKey);
      const db = await getDb(); if (!db) throw new Error("Database unavailable");
      await db.update(legacyDayforgeSaasTenants).set({ strategyVerticalKey: input.verticalKey }).where(eq(legacyDayforgeSaasTenants.id, ctx.tenantId));
      if (await resolveTenantVerticalKey(ctx.tenantId) !== input.verticalKey) throw new Error("Industry configuration readback failed");
      return { verticalKey: input.verticalKey };
    }),
  strategicCallConsent: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.consent_status" });
    const db = await getDb(); if (!db) throw new Error("Database unavailable");
    const [authorization] = await db.select().from(tenantStandingAuthorizations).where(and(eq(tenantStandingAuthorizations.tenantId, ctx.tenantId), eq(tenantStandingAuthorizations.canonicalOperatorId, identity.canonicalOperatorId), eq(tenantStandingAuthorizations.exactAction, WEEKDAY_STRATEGIC_PLANNING_ACTION), isNull(tenantStandingAuthorizations.revokedAt))).limit(1);
    return { authorization: authorization ?? null, timeZone: await resolveOperatorTimeZone(ctx.tenantId) };
  }),
  grantStrategicCalls: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ weekdays: z.array(z.number().int().min(1).max(5)).min(1).max(5), localStart: z.string().regex(/^\d{2}:\d{2}$/), localEnd: z.string().regex(/^\d{2}:\d{2}$/), timeZone: z.string().min(1), dailyLimit: z.number().int().min(1).max(3), consent: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.consent_grant" });
      return grantStrategicCallAuthorization({ ...input, identity, sourceReference: `authenticated_app:${randomUUID()}` });
    }),
  revokeStrategicCalls: legacyDayforgeTenantOperatorProcedure.mutation(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.consent_revoke" });
    return revokeStrategicCallAuthorization(identity);
  }),
  preparedProposal: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.app_proposal" });
    const zone = await resolveOperatorTimeZone(ctx.tenantId);
    if (!zone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the business timezone before planning" });
    const now = new Date();
    const date = formatInTimeZone(now, zone, "yyyy-MM-dd");
    const weekday = Number(formatInTimeZone(now, zone, "i"));
    const start = weekday >= 6 ? addDaysYmd(date, 8 - weekday) : weekStartMonday(date);
    const proposal = await latestStrategicProposal(identity, start);
    const responses = proposal ? await strategicResponses(identity, proposal.id) : [];
    const db = await getDb(); if (!db) throw new Error("Database unavailable");
    const stored = proposal ? await db.select().from(dayDirectorCommitments).where(and(eq(dayDirectorCommitments.tenantId, ctx.tenantId), eq(dayDirectorCommitments.actorId, identity.dayDirectorActorId))) : [];
    const approvedItemIds = proposal?.items.filter(item => stored.some(row => {
      const approval = (row.metadataJson as { strategicApproval?: { proposalId: string; revision: string; itemId: string; responseId: string; canonicalOperatorId: string } } | null)?.strategicApproval;
      return approval?.proposalId === proposal.id && approval.revision === proposal.revision && approval.itemId === item.id && approval.canonicalOperatorId === identity.canonicalOperatorId && responses.some(r => r.id === approval.responseId && r.action === "approve" && r.itemIds.includes(item.id)) && row.title === item.title && row.sourceText === item.objective && row.businessDate === item.businessDate;
    })).map(item => item.id) ?? [];
    return { proposal, approvedItemIds, verticalKey: await resolveTenantVerticalKey(ctx.tenantId), responses, stale: proposal ? Date.parse(proposal.expiresAt) <= now.getTime() : false };
  }),
  refreshPreparedProposal: legacyDayforgeTenantOperatorProcedure.mutation(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.app_prepare" });
    const zone = await resolveOperatorTimeZone(ctx.tenantId);
    if (!zone) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configure the business timezone" });
    return prepareStrategicProposal({ identity, timeZone: zone });
  }),
  respondToPreparedProposal: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ proposalId: z.string().min(1), revision: z.string().length(64), action: z.enum(["approve", "reject", "defer"]), itemIds: z.array(z.string()).optional(), note: z.string().max(2000).optional() }))
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.app_approval" });
      return respondToStrategicProposal({ ...input, identity, source: "authenticated_app" });
    }),
  revisePreparedProposal: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ proposalId: z.string().min(1), revision: z.string().length(64), itemId: z.string().min(1), title: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "strategy.app_revision" });
      return reviseStrategicProposal({ ...input, identity });
    }),
  dailyReadiness: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timeZone,
      })
    )
    .query(async ({ ctx, input }) => {
      assertTimeZone(input.timeZone);
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "weekly_mission.readiness",
      });
      const horizon = remainingWeekHorizon({
        businessDate: input.businessDate,
        localTime: "12:00",
      });
      const command = await loadDailyCommandWithWeeklyIntent({
        tenantId: identity.tenantId,
        actorId: identity.weeklyOperatorId,
        operatorUserId: identity.weeklyOperatorId,
        operatorUserIds: identity.aliases.map(alias => alias.openId),
        dayDirectorActorId: identity.dayDirectorActorId,
        dayDirectorActorIds: identity.dayDirectorActorIds,
        businessDate: input.businessDate,
        timeZone: input.timeZone,
        weekStart: horizon.weekStart,
      });
      const readiness = command.weeklyIntentReadiness ?? [];
      await recordPersistentOperatorDiagnosticEvent({
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        operatorUserId: identity.canonicalOpenId,
        subsystem: "weekly_mission.readiness",
        eventKind: "selection_attempt",
        reason: readiness.length === 0 ? "legitimate_no_work" : null,
      }).catch(() => undefined);
      return readiness;
    }),
  picture: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .query(async ({ ctx, input }) =>
      loadWeeklyMissionPicture(await scope(ctx, input.timeZone))
    ),
  begin: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      beginWeeklyMission(await scope(ctx, input.timeZone))
    ),
  decline: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      declineWeeklyMission(await scope(ctx, input.timeZone))
    ),
  adjust: legacyDayforgeTenantMemberProcedure
    .input(z.object({ timeZone }))
    .mutation(async ({ ctx, input }) =>
      adjustWeeklyMission(await scope(ctx, input.timeZone))
    ),
  reply: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        timeZone,
        utterance: z.string().trim().min(1).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) =>
      replyWeeklyMission(
        await scope(ctx, input.timeZone),
        input.utterance
      )
    ),
});
