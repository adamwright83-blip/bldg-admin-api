import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { dayforgeAuditEvents } from "../../drizzle/schema";
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
import { getDayforgeProviderStatus } from "./providerStatus";

async function recentDemoAuditEvents(tenantId: string, limit: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: dayforgeAuditEvents.id,
      eventName: dayforgeAuditEvents.eventName,
      entityType: dayforgeAuditEvents.entityType,
      entityId: dayforgeAuditEvents.entityId,
      occurredAt: dayforgeAuditEvents.createdAt,
    })
    .from(dayforgeAuditEvents)
    .where(and(eq(dayforgeAuditEvents.tenantId, tenantId)))
    .orderBy(desc(dayforgeAuditEvents.createdAt), desc(dayforgeAuditEvents.id))
    .limit(limit);
}

export const dayforgeDemoRouter = router({
  // Named `getStatus` (not `status`) to match the demo control page contract.
  getStatus: adminProcedure.query(async () => {
    const tenantId = demoTenantId();
    const mission = await getCommercialMissionByIdempotencyKey({
      tenantId,
      idempotencyKey: DEMO_MISSION_IDEMPOTENCY_KEY,
    });
    const churnProfile = ENV.dayforgeDemoEnabled
      ? await getCustomerRecoveryProfile(tenantId).catch(() => null)
      : null;
    const auditEvents = ENV.dayforgeDemoEnabled
      ? await recentDemoAuditEvents(tenantId, 20)
      : [];
    const providerStatus = getDayforgeProviderStatus();
    const anyProviderLive = Object.values(providerStatus).some(
      value => value === "LIVE" || value === "TEST" || value === "BROWSER_PDF_FALLBACK"
    );

    return {
      demoEnabled: ENV.dayforgeDemoEnabled,
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
      releaseGateHealthy: ENV.dayforgeDemoEnabled ? anyProviderLive : null,
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
