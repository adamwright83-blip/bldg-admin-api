/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { legacyLegacyDayforgeAuditEvents } from "../../drizzle/schema";
import {
  getCommercialMissionByIdempotencyKey,
} from "../commercialMissions/commercialMissionStore";
import { getCustomerRecoveryProfile } from "../churnRadar/customerChurnService";
import {
  DEMO_MISSION_IDEMPOTENCY_KEY,
  demoTenantId,
  demoTenantSlug,
  seedDemoTenant,
} from "./demoTenantSeed";
import {
  DemoResetDisabledError,
  DemoResetForbiddenError,
  resetDemoTenant,
} from "./demoTenantReset";
import { getLegacyDayforgeProviderStatus } from "./providerStatus";

async function recentDemoAuditEvents(tenantId: string, limit: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: legacyLegacyDayforgeAuditEvents.id,
      eventName: legacyLegacyDayforgeAuditEvents.eventName,
      entityType: legacyLegacyDayforgeAuditEvents.entityType,
      entityId: legacyLegacyDayforgeAuditEvents.entityId,
      occurredAt: legacyLegacyDayforgeAuditEvents.createdAt,
    })
    .from(legacyLegacyDayforgeAuditEvents)
    .where(and(eq(legacyLegacyDayforgeAuditEvents.tenantId, tenantId)))
    .orderBy(desc(legacyLegacyDayforgeAuditEvents.createdAt), desc(legacyLegacyDayforgeAuditEvents.id))
    .limit(limit);
}

export const legacyLegacyDayforgeDemoRouter = router({
  // Named `getStatus` (not `status`) to match the demo control page contract.
  getStatus: adminProcedure.query(async () => {
    const tenantId = demoTenantId();
    const mission = await getCommercialMissionByIdempotencyKey({
      tenantId,
      idempotencyKey: DEMO_MISSION_IDEMPOTENCY_KEY,
    });
    const churnProfile = ENV.legacyLegacyDayforgeDemoEnabled
      ? await getCustomerRecoveryProfile(tenantId).catch(() => null)
      : null;
    const auditEvents = ENV.legacyLegacyDayforgeDemoEnabled
      ? await recentDemoAuditEvents(tenantId, 20)
      : [];
    const providerStatus = getLegacyDayforgeProviderStatus();
    const anyProviderLive = Object.values(providerStatus).some(
      value => value === "LIVE" || value === "TEST" || value === "BROWSER_PDF_FALLBACK"
    );

    return {
      demoEnabled: ENV.legacyLegacyDayforgeDemoEnabled,
      tenantId,
      tenantSlug: demoTenantSlug(),
      mission: mission
        ? {
            id: String(mission.id),
            name: mission.code,
            status: mission.status,
            assignedTo: mission.assignedTo,
            accountName: mission.account.name,
            decisionMakerName: mission.account.decisionMaker.name,
            estimatedAnnualValueCents: mission.opportunity.estimatedAnnualValueCents,
          }
        : null,
      pipelineStage: mission?.status ?? null,
      proposalStatus: null,
      fieldAssignment: mission?.assignedTo ?? null,
      revenueState: mission?.status === "won" ? "attributed" : "pending",
      churnState: churnProfile ? "configured" : "not_configured",
      churnRecoveryConfigured: Boolean(churnProfile),
      providerStatus,
      recentEvents: auditEvents.map(event => ({
        id: String(event.id),
        label: `${event.eventName} (${event.entityType}:${event.entityId})`,
        occurredAt: event.occurredAt?.toISOString?.() ?? String(event.occurredAt),
      })),
      recentAuditEvents: auditEvents.map(event => ({
        id: event.id,
        eventName: event.eventName,
        entityType: event.entityType,
        entityId: event.entityId,
        occurredAt: event.occurredAt?.toISOString?.() ?? String(event.occurredAt),
      })),
      releaseGateHealthy: ENV.legacyLegacyDayforgeDemoEnabled ? anyProviderLive : null,
    };
  }),

  reset: adminProcedure
    .input(z.object({ confirm: z.boolean().optional() }).optional())
    .mutation(async ({ ctx }) => {
      // The demo control page requires an explicit two-click confirmation in
      // the UI before calling this mutation; the server independently
      // enforces DAYFORGE_DEMO_ENABLED + admin role regardless of what the
      // client sends.
      try {
        const result = await resetDemoTenant({
          role: ctx.user?.role ?? null,
          id: ctx.user ? String(ctx.user.id) : null,
        });
        const seed = await seedDemoTenant();
        return { ...result, reseeded: true, missionId: seed.mission.id };
      } catch (error) {
        if (error instanceof DemoResetDisabledError) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        if (error instanceof DemoResetForbiddenError) {
          throw new TRPCError({ code: "FORBIDDEN", message: error.message });
        }
        throw error;
      }
    }),
});
