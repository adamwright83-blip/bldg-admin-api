import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialCustomerContacts,
  commercialCustomerLocations,
  commercialCustomers,
  commercialFollowUps,
  commercialMissionEvents,
  commercialMissionFieldChecklistItems,
  commercialMissionFieldStates,
  commercialMissionFinalRewards,
  commercialMissionGameAttempts,
  commercialMissionGameResults,
  commercialMissionGameRewards,
  commercialMissionPhoneHandoffs,
  commercialMissions,
  commercialMissionSteps,
  commercialOpportunities,
  commercialOrderAttributions,
  commercialPipelineEvents,
  commercialPipelineRecords,
  commercialProposalEvents,
  commercialProposals,
  commercialRouteAssignments,
  commercialVisitOutcomes,
  customerChurnScans,
  customerChurnSnapshots,
  customerContactPermissions,
  customerRecoveryDrafts,
  customerRecoveryEvents,
  customerRecoveryInterventions,
  orders,
  tenantCustomerRecoveryProfiles,
} from "../../drizzle/schema";
import { writeDayforgeEventWith } from "../dayforgeEvents/dayforgeEventStore";
import { demoTenantId } from "./demoTenantSeed";

export type DemoResetActor = {
  role: string | null | undefined;
  id: string | null;
};

export class DemoResetForbiddenError extends Error {}
export class DemoResetDisabledError extends Error {}

function assertAdmin(actor: DemoResetActor) {
  if (actor.role !== "admin") {
    throw new DemoResetForbiddenError(
      "Only an admin actor may reset the DayForge demo tenant"
    );
  }
}

function assertDemoEnabled() {
  if (!ENV.dayforgeDemoEnabled) {
    throw new DemoResetDisabledError(
      "DAYFORGE_DEMO_ENABLED is not true; refusing to reset the demo tenant"
    );
  }
}

/**
 * Deletes ONLY the demo tenant's mutable operational state — every query is
 * scoped by tenantId to the demo tenant, and the demo tenant itself (and its
 * store/user/onboarding rows) is left in place so seeding can rebuild the
 * starting point on top of it.
 */
async function purgeDemoTenantMutableState(
  tx: Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0],
  tenantId: string
) {
  // Child-of-mission tables first (FK-safe ordering), then mission/account/
  // opportunity rows, then pipeline/proposal/churn/order rows.
  await tx.delete(commercialMissionFieldChecklistItems).where(eq(commercialMissionFieldChecklistItems.tenantId, tenantId));
  await tx.delete(commercialMissionFieldStates).where(eq(commercialMissionFieldStates.tenantId, tenantId));
  await tx.delete(commercialMissionPhoneHandoffs).where(eq(commercialMissionPhoneHandoffs.tenantId, tenantId));
  await tx.delete(commercialMissionGameRewards).where(eq(commercialMissionGameRewards.tenantId, tenantId));
  await tx.delete(commercialMissionGameResults).where(eq(commercialMissionGameResults.tenantId, tenantId));
  await tx.delete(commercialMissionGameAttempts).where(eq(commercialMissionGameAttempts.tenantId, tenantId));
  await tx.delete(commercialMissionFinalRewards).where(eq(commercialMissionFinalRewards.tenantId, tenantId));
  await tx.delete(commercialVisitOutcomes).where(eq(commercialVisitOutcomes.tenantId, tenantId));
  await tx.delete(commercialMissionSteps).where(eq(commercialMissionSteps.tenantId, tenantId));
  await tx.delete(commercialMissionEvents).where(eq(commercialMissionEvents.tenantId, tenantId));

  await tx.delete(commercialPipelineEvents).where(eq(commercialPipelineEvents.tenantId, tenantId));
  await tx.delete(commercialPipelineRecords).where(eq(commercialPipelineRecords.tenantId, tenantId));

  await tx.delete(commercialProposalEvents).where(eq(commercialProposalEvents.tenantId, tenantId));
  await tx.delete(commercialProposals).where(eq(commercialProposals.tenantId, tenantId));

  await tx.delete(commercialFollowUps).where(eq(commercialFollowUps.tenantId, tenantId));
  await tx.delete(commercialRouteAssignments).where(eq(commercialRouteAssignments.tenantId, tenantId));
  await tx.delete(commercialOrderAttributions).where(eq(commercialOrderAttributions.tenantId, tenantId));
  await tx.delete(commercialCustomerContacts).where(eq(commercialCustomerContacts.tenantId, tenantId));
  await tx.delete(commercialCustomerLocations).where(eq(commercialCustomerLocations.tenantId, tenantId));
  await tx.delete(commercialCustomers).where(eq(commercialCustomers.tenantId, tenantId));

  await tx.delete(commercialMissions).where(eq(commercialMissions.tenantId, tenantId));
  await tx.delete(commercialOpportunities).where(eq(commercialOpportunities.tenantId, tenantId));
  await tx.delete(commercialAccountContacts).where(eq(commercialAccountContacts.tenantId, tenantId));
  await tx.delete(commercialAccountLocations).where(eq(commercialAccountLocations.tenantId, tenantId));
  await tx.delete(commercialAccounts).where(eq(commercialAccounts.tenantId, tenantId));

  await tx.delete(customerRecoveryEvents).where(eq(customerRecoveryEvents.tenantId, tenantId));
  await tx.delete(customerRecoveryDrafts).where(eq(customerRecoveryDrafts.tenantId, tenantId));
  await tx.delete(customerRecoveryInterventions).where(eq(customerRecoveryInterventions.tenantId, tenantId));
  await tx.delete(customerContactPermissions).where(eq(customerContactPermissions.tenantId, tenantId));
  await tx.delete(customerChurnSnapshots).where(eq(customerChurnSnapshots.tenantId, tenantId));
  await tx.delete(customerChurnScans).where(eq(customerChurnScans.tenantId, tenantId));
  await tx.delete(tenantCustomerRecoveryProfiles).where(eq(tenantCustomerRecoveryProfiles.tenantId, tenantId));

  await tx.delete(orders).where(eq(orders.tenantId, tenantId));
}

export type DemoResetResult = {
  tenantId: string;
  resetAt: string;
  auditEventId: number;
};

/**
 * Resets ONLY the demo tenant's mutable state back to nothing, so the caller
 * can immediately re-seed with seedDemoTenant(). Never touches other tenants:
 * every delete is scoped by `WHERE tenantId = <demo tenant id>`.
 *
 * Throws if DAYFORGE_DEMO_ENABLED is not true, or if the actor is not admin.
 */
export async function resetDemoTenant(actor: DemoResetActor): Promise<DemoResetResult> {
  assertDemoEnabled();
  assertAdmin(actor);

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tenantId = demoTenantId();
  const resetAt = new Date();
  const correlationId = `dayforge-demo-reset:${tenantId}:${resetAt.getTime()}`;
  const idempotencyKey = randomUUID();

  const auditResult = await db.transaction(async tx => {
    await purgeDemoTenantMutableState(tx, tenantId);
    return writeDayforgeEventWith(tx, {
      tenantId,
      actor: { type: "admin", id: actor.id },
      entityType: "dayforge_demo_tenant",
      entityId: tenantId,
      eventName: "dayforge_demo.reset",
      after: { resetAt: resetAt.toISOString() },
      source: "dayforgeDemo.demoTenantReset",
      correlationId,
      idempotencyKey,
      occurredAt: resetAt,
    });
  });

  return {
    tenantId,
    resetAt: resetAt.toISOString(),
    auditEventId: auditResult.auditEventId,
  };
}
